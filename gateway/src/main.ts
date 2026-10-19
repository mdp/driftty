import {readFile, mkdir} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {homedir} from 'node:os';
import {
  combineGatewayPlans,
  localTmuxGatewayPlan,
  parseGatewayPlan,
  validateLocalTmuxSocket,
  type ShellRegistryPlan,
} from './gateway-plan.ts';
import {
  pickerResponse,
  sessionsResponse,
  unavailableResponse,
} from './picker.ts';
import {
  RemoteShellRegistry,
  type RemoteShell,
  type RemoteShellSnapshot,
} from './remote-shell-registry.ts';
import {sshCommand, SshConnection} from './ssh.ts';
import {configureAuth, isAuthenticated, loginResponse, logoutResponse} from './auth.ts';
import {randomSessionName} from './names.ts';
import {
  TerminalRoutes,
  type RemoteTerminalTarget,
} from './terminal-routes.ts';
import {LocalTmuxConnection} from './local-tmux.ts';
import {parseGatewayStartupOptions} from './startup-options.ts';
import {readProjectDefinitions} from './workspaces/config.ts';
import type {ProjectDefinition} from './workspaces/config.ts';
import {WorkspaceStore} from './workspaces/store.ts';
import {WorkspaceService} from './workspaces/service.ts';
import {startWorkspaceApi} from './workspaces/api.ts';
import {VercelWorkspaceProvider} from './workspace/providers/vercel.ts';
import {serveFetch} from './node-http.ts';
import {proxyHttpRequest, proxyWebSocketUpgrade} from './http-proxy.ts';

const configDirectory = process.env.DRIFTTY_CONFIG_DIR ?? (process.env.XDG_CONFIG_HOME
  ? join(process.env.XDG_CONFIG_HOME, 'driftty')
  : join(homedir(), '.config', 'driftty'));
const stateDirectory = process.env.DRIFTTY_CONFIG_DIR
  ? join(configDirectory, 'state')
  : process.env.XDG_STATE_HOME
  ? join(process.env.XDG_STATE_HOME, 'driftty')
  : join(homedir(), '.local', 'state', 'driftty');
const configPath = process.env.PROFILES_FILE ?? join(configDirectory, 'profiles.yaml');
const keysDirectory = process.env.DRIFTTY_KEYS_DIR ?? join(configDirectory, 'keys');
const knownHosts = process.env.KNOWN_HOSTS_FILE ?? join(stateDirectory, 'known_hosts');
const ttydStartPort = Number(process.env.DRIFTTY_TTYD_START_PORT ?? 7800);
const gatewayPort = Number(process.env.DRIFTTY_PORT ?? 7681);
const gatewayHost = process.env.DRIFTTY_HOST ?? '0.0.0.0';
const startup = parseGatewayStartupOptions(process.argv.slice(2));
const workspacesEnabled = process.env.DRIFTTY_ENABLE_WORKSPACES === '1' || Boolean(process.env.DRIFTTY_CONFIG_DIR);
const authStartup = configureAuth(startup.authArguments, {
  DRIFTTY_PASSWORD: process.env.DRIFTTY_PASSWORD,
});
const auth = authStartup.auth;

if (authStartup.message) console.warn(authStartup.message);

const plans = [];
if (startup.localTmux) {
  await validateLocalTmuxSocket(startup.localTmux);
  plans.push(localTmuxGatewayPlan(startup.localTmux));
}
try {
  plans.push(await parseGatewayPlan(await readFile(configPath, 'utf8'), {keysDir: keysDirectory}));
} catch (error) {
  const missingConfig = error && typeof error === 'object' &&
    'code' in error && error.code === 'ENOENT';
  if (process.env.PROFILES_FILE || !missingConfig) throw error;
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
  ttydPath: process.env.DRIFTTY_TTYD_PATH ?? 'ttyd',
  clientPath: process.env.DRIFTTY_TTYD_CLIENT ?? '/usr/share/ttyd/index.html',
  startPort: ttydStartPort,
  onFatal: stop,
});

let workspaceService: WorkspaceService | undefined;
let projectDefinitions = new Map<string, ProjectDefinition>();
if (workspacesEnabled) {
  const statePath = process.env.DRIFTTY_STATE_FILE ?? join(stateDirectory, 'workspaces.json');
  await mkdir(dirname(statePath), {recursive: true});
  projectDefinitions = await readProjectDefinitions(process.env.DRIFTTY_PROJECTS_FILE ?? join(configDirectory, 'workspaces.yaml'));
  workspaceService = new WorkspaceService(
    new VercelWorkspaceProvider(),
    new WorkspaceStore(statePath),
    projectDefinitions,
    terminalRoutes,
    undefined,
    () => readProjectDefinitions(process.env.DRIFTTY_PROJECTS_FILE ?? join(configDirectory, 'workspaces.yaml')),
  );
  await workspaceService.restoreRoutes();
}

const remoteTerminalAuthorization = process.env.DRIFTTY_REMOTE_TERMINAL_AUTH;
if (startup.remoteTerminal) {
  if (!remoteTerminalAuthorization) {
    throw new Error('DRIFTTY_REMOTE_TERMINAL_AUTH is required with --remote-terminal');
  }
  await terminalRoutes.startRemote({
    slug: 'sandbox',
    upstream: startup.remoteTerminal,
    authorization: `Basic ${remoteTerminalAuthorization}`,
  });
}

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
  // Listing sessions is intentionally read-only. A terminal bridge is started
  // only when its session URL is opened (or after a new session is created).
  return registry.discover();
}

let publicServer: Awaited<ReturnType<typeof serveFetch>> | undefined;
let workspaceApi: Awaited<ReturnType<typeof startWorkspaceApi>> | undefined;
function stop(exitCode: number): void {
  if (stopping) return;
  stopping = true;
  void Promise.all([terminalRoutes.stop(), publicServer?.stop({timeoutMs: 5_000}), workspaceApi?.stop()])
    .finally(() => process.exit(exitCode));
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

const publicFetch = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  if (url.pathname !== '/login' && url.pathname !== '/logout' && url.pathname !== '/_health' && !isAuthenticated(request, auth)) {
    return new Response(null, {status: 302, headers: {
      location: `/login?next=${encodeURIComponent(url.pathname + url.search)}`,
      'cache-control': 'no-store',
    }});
  }
  const routes = terminalRoutes.proxyRoutes();
  const bare = routes.find(({path}) => url.pathname === `/${path}`);
  if (bare) {
    return new Response(null, {status: 308, headers: {location: `${url.pathname}/${url.search}`}});
  }
  const proxied = await proxyHttpRequest(request, {auth, routes: () => routes});
  if (proxied) return proxied;
  return handleApplicationRequest(request);
};

const handleApplicationRequest = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
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
      const views = [
        ...plan.views,
        ...(startup.remoteTerminal ? [{
          slug: 'sandbox', label: 'Vercel Sandbox', hostLabel: 'Vercel Sandbox',
          hostGroup: 'vercel-sandbox', mode: 'direct' as const,
          canCreateSessions: false,
        }] : []),
      ];
      let workspaces: Awaited<ReturnType<WorkspaceService['list']>> = [];
      if (workspaceService) {
        try {
          workspaces = await workspaceService.list();
        } catch (error) {
          console.error('could not refresh Vercel workspaces for the picker:', error);
        }
      }
      return pickerResponse(
        views,
        sessionsByProfile,
        randomSessionName,
        auth.enabled,
        workspaces,
        [...projectDefinitions.values()].map(({id, label}) => ({id, label})),
      );
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (workspaceService && parts[0] === '_projects' && parts[1] && parts[2] === 'workspaces' && parts.length === 3) {
      if (request.method !== 'POST') return new Response('Method not allowed', {status: 405});
      try {
        const form = await request.formData();
        const name = form.get('name');
        if (typeof name !== 'string') return new Response('Workspace name is required', {status: 400});
        const workspace = await workspaceService.create(parts[1], name);
        return Response.redirect(new URL(`/sessions/${encodeURIComponent(workspace.name)}`, url), 303);
      } catch (error) {
        return new Response(error instanceof Error ? error.message : 'Could not create workspace', {status: 400});
      }
    }
    if (workspaceService && parts[0] === '_workspaces' && parts[1] && parts.length === 3) {
      if (request.method !== 'POST') return new Response('Method not allowed', {status: 405});
      const name = parts[1];
      try {
        if (parts[2] === 'delete') {
          const workspace = await workspaceService.get(name);
          if (!workspace) return new Response('Workspace not found', {status: 404});
          const form = await request.formData();
          if (form.get('confirm') !== 'delete') {
            return workspaceStatePage(workspace, auth.enabled, 'Deletion was not confirmed. Return to the gateway and confirm delete.', 400);
          }
          await workspaceService.delete(name);
          return Response.redirect(new URL('/', url), 303);
        }
        const workspace = await workspaceService.get(name);
        if (!workspace) return new Response('Workspace not found', {status: 404});
        if (parts[2] === 'stop' && workspace.state === 'ready') {
          await workspaceService.stop(name);
          return Response.redirect(new URL('/', url), 303);
        } else if (parts[2] === 'resume' && workspace.state === 'stopped') {
          await workspaceService.resume(name);
          return Response.redirect(new URL(`/sessions/${encodeURIComponent(name)}/`, url), 303);
        } else if (parts[2] === 'retry' && workspace.state === 'failed') {
          workspaceService.retry(name);
          return Response.redirect(new URL('/', url), 303);
        } else if (!['resume', 'retry'].includes(parts[2]!)) {
          return new Response('Not found', {status: 404});
        } else {
          return workspaceStatePage(workspace, auth.enabled, 'Workspace state changed. Refresh the gateway status page.', 409);
        }
      } catch (error) {
        const workspace = await workspaceService.get(name);
        const detail = error instanceof Error ? error.message : 'Could not resume workspace';
        return workspace
          ? workspaceStatePage(workspace, auth.enabled, detail, 502)
          : new Response('Workspace not found', {status: 404});
      }
    }
    if (workspaceService && parts[0] === 'sessions' && parts[1] && parts.length === 2) {
      if (request.method !== 'GET') return new Response('Method not allowed', {status: 405});
      const workspace = await workspaceService.get(parts[1]);
      return workspace
        ? workspaceStatePage(workspace, auth.enabled)
        : new Response('Workspace not found', {status: 404});
    }
    if (startup.remoteTerminal && parts[0] === 'sandbox') {
      if (request.method !== 'GET') return new Response('Method not allowed', {status: 405});
      return new Response(null, {status: 302, headers: {location: '/sandbox/'}});
    }
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
          try {
            await terminalRoutes.ensureSession(
              terminalTarget(instruction, registry, shell),
            );
            return terminalRoutes.clientResponse();
          } catch (error) {
            const detail = error instanceof Error
              ? error.message
              : 'Terminal bridge could not be started';
            return terminalUnavailableResponse(instruction.view.slug, shell.slug, detail);
          }
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
};

await terminalRoutes.prepare();
publicServer = await serveFetch({
  hostname: gatewayHost,
  port: gatewayPort,
  fetch: publicFetch,
  upgrade(request, socket, head) {
    proxyWebSocketUpgrade(request, socket, head, {
      auth,
      routes: () => terminalRoutes.proxyRoutes(),
    });
  },
});

workspaceApi = workspaceService
  ? await startWorkspaceApi(
    workspaceService,
    Number(process.env.DRIFTTY_WORKSPACE_API_PORT ?? 7798),
    process.env.DRIFTTY_WORKSPACE_API_HOST ?? '127.0.0.1',
  )
  : undefined;

console.log(
  `driftty gateway listening on ${gatewayHost}:${gatewayPort} with ${plan.views.length} profile(s)`,
);
await new Promise<void>((resolve) => {
  if (stopping) resolve();
  else {
    process.once('SIGTERM', resolve);
    process.once('SIGINT', resolve);
  }
});

function workspaceStatePage(
  workspace: NonNullable<Awaited<ReturnType<WorkspaceService['get']>>>,
  authEnabled: boolean,
  notice?: string,
  status = 200,
): Response {
  const title = workspace.state === 'stopped'
    ? 'Workspace is sleeping'
    : workspace.state === 'failed'
    ? 'Workspace needs attention'
    : workspace.state === 'provisioning'
    ? 'Workspace is starting'
    : 'Workspace is ready';
  const action = workspace.state === 'stopped'
    ? {label: 'Resume workspace', endpoint: 'resume'}
    : workspace.state === 'failed'
    ? {label: 'Retry setup', endpoint: 'retry'}
    : undefined;
  const content = workspace.state === 'ready'
    ? `<a class="action" href="/sessions/${escapeHtml(workspace.name)}/">Open terminal</a>`
    : action
    ? `<form id="workspace-action" method="post" action="/_workspaces/${encodeURIComponent(workspace.name)}/${action.endpoint}" data-wait-label="${action.endpoint === 'resume' ? 'Resuming workspace…' : 'Retrying setup…'}"><button class="action" type="submit">${action.label}</button></form><p id="workspace-progress" role="status" aria-live="polite" hidden></p>`
    : '<p>Workspace setup is in progress. Refresh this page in a moment.</p>';
  const detail = notice ?? (workspace.state === 'stopped'
    ? 'Your files are preserved. Resume the sandbox to continue.'
    : workspace.error ?? '');
  const deletion = workspaceDeleteForm(workspace.name);
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — driftty</title><style>body{margin:0;min-height:100svh;display:grid;place-items:center;background:#05080b;color:#d8f3e8;font:16px ui-monospace,monospace}.card{width:min(34rem,calc(100vw - 40px));padding:24px;border:1px solid #1d6170;background:#081116}h1{color:#73f7ff}p{line-height:1.6}.action{display:inline-block;padding:12px 16px;border:1px solid #73f7ff;background:#081116;color:#73f7ff;font:inherit;text-decoration:none;cursor:pointer}.action:disabled{opacity:.7;cursor:wait}.spinner{display:inline-block;width:1em;height:1em;margin-right:.5em;vertical-align:-.15em;border:2px solid #1d6170;border-top-color:#73f7ff;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}a.signout{color:#a8ccc0}.delete{margin-top:20px;border:1px solid #85435c;background:#081116;color:#ff9bb4;padding:10px;font:inherit;cursor:pointer}.delete[data-armed="true"]{background:#391321;color:#fff}.confirm-hint{font-size:.8rem;color:#ffb3c2}</style><main class="card"><p>driftty workspace · ${escapeHtml(workspace.name)}</p><h1>${title}</h1>${detail ? `<p role="status">${escapeHtml(detail)}</p>` : ''}${content}${deletion}<p><a class="signout" href="/">Workspace list</a>${authEnabled ? ' · <a class="signout" href="/logout">Sign out</a>' : ''}</p></main><script>const form=document.querySelector('#workspace-action');if(form){let submitted=false;form.addEventListener('submit',event=>{if(submitted){event.preventDefault();return}submitted=true;const button=form.querySelector('button');button.disabled=true;button.setAttribute('aria-disabled','true');button.innerHTML='<span class="spinner" aria-hidden="true"></span>'+form.dataset.waitLabel;const progress=document.querySelector('#workspace-progress');progress.hidden=false;progress.textContent='This can take a little while. Keep this page open; you will be redirected when the terminal is ready.'})}document.addEventListener('submit',event=>{const form=event.target.closest('form[data-confirm-delete]');if(!form||form.dataset.confirmed==='true')return;event.preventDefault();form.dataset.confirmed='true';form.querySelector('input[name="confirm"]').value='delete';const button=form.querySelector('button');button.textContent='Confirm delete';button.dataset.armed='true';form.querySelector('.confirm-hint').hidden=false});</script>`;
  return new Response(html, {
    status,
    headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'},
  });
}

function workspaceDeleteForm(name: string): string {
  return `<form method="post" action="/_workspaces/${encodeURIComponent(name)}/delete" data-confirm-delete><input type="hidden" name="confirm" value=""><button class="delete" type="submit" data-armed="false">Delete workspace</button><span class="confirm-hint" hidden>Tap again to permanently delete</span></form>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function terminalUnavailableResponse(
  hostSlug: string,
  sessionSlug: string,
  detail: string,
): Response {
  const retryPath = `/${encodeURIComponent(hostSlug)}/${encodeURIComponent(sessionSlug)}/`;
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Terminal unavailable — driftty</title><main><h1>Session created; terminal unavailable</h1><p>${escapeHtml(detail)}</p><p>The remote tmux session is still available. Retry opening it below.</p><a href="${retryPath}">Retry terminal</a> · <a href="/">Back to sessions</a></main>`,
    {
      status: 503,
      headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'},
    },
  );
}
