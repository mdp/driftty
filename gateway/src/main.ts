import {readFile, mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {
  parseGatewayPlan,
  type RemoteShellRegistryPlan,
} from './gateway-plan';
import {
  pickerResponse,
  sessionsResponse,
  unavailableResponse,
} from './picker';
import {
  RemoteShellRegistry,
  type RemoteShell,
  type RemoteShellSnapshot,
} from './remote-shell-registry';
import {sshCommand, SshConnection} from './ssh';
import {authResponse, isAuthenticated, loginResponse, logoutResponse} from './auth';
import {WatchHub, watchPage} from './watch';
import {randomSessionName} from './names';
import {
  TerminalRoutes,
  type RemoteTerminalTarget,
} from './terminal-routes';

const configPath = process.env.PROFILES_FILE ?? '/config/profiles.yaml';
const knownHosts = process.env.KNOWN_HOSTS_FILE ?? '/known-hosts/known_hosts';
const ttydStartPort = 7800;
const pickerPort = 7799;

await mkdir(dirname(knownHosts), {recursive: true});
const plan = await parseGatewayPlan(await readFile(configPath, 'utf8'));
const registries = new Map(
  plan.registries.map((instruction) => [
    instruction.view.slug,
    new RemoteShellRegistry(
      instruction,
      new SshConnection(instruction.target, knownHosts),
    ),
  ]),
);
let stopping = false;
const terminalRoutes = new TerminalRoutes({
  pickerPort,
  startPort: ttydStartPort,
  onFatal: stop,
});
const watchHub = new WatchHub();

function terminalTarget(
  instruction: RemoteShellRegistryPlan,
  registry: RemoteShellRegistry,
  shell: RemoteShell,
): RemoteTerminalTarget {
  return {
    hostSlug: instruction.view.slug,
    hostLabel: instruction.view.label,
    shell,
    command: registry.terminalCommand(shell),
  };
}

async function discover(
  instruction: RemoteShellRegistryPlan,
  registry: RemoteShellRegistry,
): Promise<RemoteShellSnapshot> {
  const snapshot = await registry.discover();
  await terminalRoutes.reconcile(
    instruction.view.slug,
    snapshot.active.map((shell) =>
      terminalTarget(instruction, registry, shell)
    ),
  );
  return snapshot;
}

function stop(exitCode: number): void {
  if (stopping) return;
  stopping = true;
  terminalRoutes.stop();
  setTimeout(() => process.exit(exitCode), 250);
}

process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));

for (const instruction of plan.direct) {
  await terminalRoutes.startDirect({
    slug: instruction.view.slug,
    label: instruction.view.label,
    command: sshCommand(instruction.target, knownHosts, {
      autorun: instruction.autorun,
    }),
  });
}
for (const instruction of plan.registries) {
  try {
    await discover(instruction, registries.get(instruction.view.slug)!);
  } catch (error) {
    console.error(
      `could not discover tmux sessions for ${instruction.view.slug}:`,
      error,
    );
  }
}

const picker = Bun.serve({
  hostname: '127.0.0.1',
  port: pickerPort,
  websocket: {
    open: watchHub.open.bind(watchHub),
    message: watchHub.message.bind(watchHub),
    close: watchHub.close.bind(watchHub),
  },
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/_auth') {
      return authResponse(request, plan.auth);
    }
    if (url.pathname === '/login') return loginResponse(request, plan.auth);
    if (url.pathname === '/logout') return logoutResponse();
    if (url.pathname === '/_health') return new Response('ok');

    if (url.pathname.startsWith('/watch/')) {
      const parts = url.pathname.split('/').filter(Boolean);
      const route = parts.slice(1, 3).join('/');
      const instruction = plan.get(parts[1]!);
      if (!instruction || instruction.kind !== 'registry' ||
        !instruction.view.publicWatch) {
        return new Response('Not found', {status: 404});
      }
      if (parts[3] === 'stream' || parts[3] === 'publish') {
        const kind = parts[3] === 'publish' ? 'writer' : 'viewer';
        return watchHub.upgrade(request, route, kind, plan.auth, picker);
      }
      return watchPage(route);
    }
    if (url.pathname === '/') {
      if (request.method !== 'GET') {
        return new Response('Method not allowed', {status: 405});
      }
      const sessionsByProfile = new Map<string, RemoteShell[]>();
      await Promise.all(plan.registries.map(async (instruction) => {
        try {
          const snapshot = await discover(
            instruction,
            registries.get(instruction.view.slug)!,
          );
          sessionsByProfile.set(instruction.view.slug, snapshot.visible);
        } catch (error) {
          console.error(
            `could not discover tmux sessions for ${instruction.view.slug}:`,
            error,
          );
          const registry = registries.get(instruction.view.slug)!;
          sessionsByProfile.set(instruction.view.slug, registry.unavailable());
        }
      }));
      const authenticated = isAuthenticated(request, plan.auth);
      const views = authenticated
        ? plan.views
        : plan.views.filter((view) => view.publicWatch);
      return pickerResponse(views, sessionsByProfile, randomSessionName, !authenticated);
    }

    const parts = url.pathname.split('/').filter(Boolean);
    const instruction = parts[0] ? plan.get(parts[0]) : undefined;
    if (!instruction || instruction.kind !== 'registry' ||
      (!isAuthenticated(request, plan.auth) && !instruction.view.publicWatch)) {
      return new Response('Not found', {status: 404});
    }
    const registry = registries.get(instruction.view.slug)!;

    if (
      request.method === 'POST' &&
      parts.length === 2 &&
      parts[1] === 'sessions'
    ) {
      try {
        const form = await request.formData();
        const name = form.get('name');
        const shell = await registry.create({
          name: typeof name === 'string' ? name : undefined,
        });
        await terminalRoutes.ensureSession(
          terminalTarget(instruction, registry, shell),
        );
        return Response.redirect(
          new URL(`/${instruction.view.slug}/${shell.slug}/`, url),
          303,
        );
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : 'Could not create session';
        return unavailableResponse(instruction.view, detail);
      }
    }

    if (request.method !== 'GET') {
      return new Response('Method not allowed', {status: 405});
    }
    try {
      const snapshot = await discover(instruction, registry);
      if (parts.length === 1) {
        return sessionsResponse(
          instruction.view,
          snapshot.visible,
          url.searchParams.get('ended') ?? undefined,
        );
      }

      if (parts.length === 2) {
        const shell =
          snapshot.active.find((candidate) => candidate.slug === parts[1]) ??
          await registry.ensure(parts[1]!);
        if (shell) {
          await terminalRoutes.ensureSession(
            terminalTarget(instruction, registry, shell),
          );
          if (!isAuthenticated(request, plan.auth)) {
            return watchPage(`${instruction.view.slug}/${parts[1]}`);
          }
          return terminalRoutes.clientResponse();
        }
        return Response.redirect(
          new URL(
            `/${instruction.view.slug}/?ended=${
              encodeURIComponent(parts[1]!)
            }`,
            url,
          ),
          302,
        );
      }
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Could not reach host';
      return unavailableResponse(instruction.view, detail);
    }
    return new Response('Not found', {status: 404});
  },
});

await terminalRoutes.startCaddy();

console.log(
  `driftty gateway listening on :7681 with ${plan.views.length} profile(s)`,
);
await terminalRoutes.waitForCaddyExit();
picker.stop();
