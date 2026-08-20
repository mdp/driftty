import {readFile, mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {
  combineGatewayPlans,
  localTmuxGatewayPlan,
  parseGatewayPlan,
  validateLocalTmuxSocket,
  type ShellRegistryPlan,
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
import {authResponse, configureAuth, loginResponse, logoutResponse} from './auth';
import {randomSessionName} from './names';
import {
  TerminalRoutes,
  type RemoteTerminalTarget,
} from './terminal-routes';
import {LocalTmuxConnection} from './local-tmux';
import {parseGatewayStartupOptions} from './startup-options';

const configPath = process.env.PROFILES_FILE ?? '/config/profiles.yaml';
const knownHosts = process.env.KNOWN_HOSTS_FILE ?? '/known-hosts/known_hosts';
const ttydStartPort = 7800;
const pickerPort = 7799;
const startup = parseGatewayStartupOptions(process.argv.slice(2));
const authStartup = configureAuth(startup.authArguments, process.env);
const auth = authStartup.auth;

if (authStartup.message) console.warn(authStartup.message);

const plans = [];
if (startup.localTmux) {
  await validateLocalTmuxSocket(startup.localTmux);
  plans.push(localTmuxGatewayPlan(startup.localTmux));
}
try {
  plans.push(await parseGatewayPlan(await readFile(configPath, 'utf8')));
} catch (error) {
  const missingConfig = error && typeof error === 'object' &&
    'code' in error && error.code === 'ENOENT';
  if (!startup.localTmux || !missingConfig) throw error;
}
const plan = combineGatewayPlans(...plans);
if (plan.instructions.some(({kind}) => kind !== 'local-registry')) {
  await mkdir(dirname(knownHosts), {recursive: true});
}
const registries = new Map(
  plan.registries.map((instruction) => [
    instruction.view.slug,
    new RemoteShellRegistry(
      instruction,
      instruction.kind === 'local-registry'
        ? new LocalTmuxConnection(instruction.socket)
        : new SshConnection(instruction.target, knownHosts),
    ),
  ]),
);
let stopping = false;
const terminalRoutes = new TerminalRoutes({
  pickerPort,
  startPort: ttydStartPort,
  authEnabled: auth.enabled,
  onFatal: stop,
});

function terminalTarget(
  instruction: ShellRegistryPlan,
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
  instruction: ShellRegistryPlan,
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
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/_auth') {
      return authResponse(request, auth);
    }
    if (url.pathname === '/login') return loginResponse(request, auth);
    if (url.pathname === '/logout') {
      return auth.enabled
        ? logoutResponse(request)
        : new Response(null, {status: 303, headers: {location: '/'}});
    }
    if (url.pathname === '/_health') return new Response('ok');
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
      return pickerResponse(
        plan.views,
        sessionsByProfile,
        randomSessionName,
        auth.enabled,
      );
    }

    const parts = url.pathname.split('/').filter(Boolean);
    const instruction = parts[0] ? plan.get(parts[0]) : undefined;
    if (
      !instruction ||
      (instruction.kind !== 'registry' && instruction.kind !== 'local-registry')
    ) {
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
        return unavailableResponse(instruction.view, detail, auth.enabled);
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
          auth.enabled,
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
      return unavailableResponse(instruction.view, detail, auth.enabled);
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
