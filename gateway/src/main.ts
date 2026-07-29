import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {parseProfiles, type Profile} from './profiles';
import {
  caddyConfig, type LegacyRoute, type SessionRoute,
} from './caddy';
import {
  pickerResponse, sessionsResponse, unavailableResponse,
} from './picker';
import {sshCommand} from './ssh';
import {
  createManagedSession, ensureFixedSession, listTmuxSessions,
  tmuxAttachCommand, type TmuxSession,
} from './sessions';

const configPath = process.env.PROFILES_FILE ?? '/config/profiles.yaml';
const knownHosts = process.env.KNOWN_HOSTS_FILE ?? '/known-hosts/known_hosts';
const ttydStartPort = 7800;
const pickerPort = 7799;

await mkdir(dirname(knownHosts), {recursive: true});
const profiles = await parseProfiles(await readFile(configPath, 'utf8'));
const profileBySlug = new Map(profiles.map((profile) => [profile.slug, profile]));
const legacyProfiles = profiles.filter((profile) => !profile.sessionRouting);
const routedProfiles = profiles.filter((profile) => profile.sessionRouting);
const legacyRoutes: LegacyRoute[] = legacyProfiles.map((profile, index) => ({
  ...profile,
  ttydPort: ttydStartPort + index,
}));
let nextPort = ttydStartPort + legacyRoutes.length;

const caddyfile = '/tmp/ttyd-mobile.Caddyfile';
const children = new Set<Bun.Subprocess>();
const sessionChildren = new Map<string, Bun.Subprocess>();
const sessionRoutes = new Map<string, SessionRoute>();
let stopping = false;
let caddyStarted = false;
let reloadQueue = Promise.resolve();

function routeKey(hostSlug: string, sessionSlug: string): string {
  return `${hostSlug}/${sessionSlug}`;
}

function sessionOrigin(hostSlug: string, sessionSlug: string): string | undefined {
  const route = sessionRoutes.get(routeKey(hostSlug, sessionSlug));
  return route
    ? `http://127.0.0.1:${route.ttydPort}/${hostSlug}/${sessionSlug}/`
    : undefined;
}

function currentCaddyConfig(): string {
  return caddyConfig(legacyRoutes, [...sessionRoutes.values()], pickerPort);
}

async function reloadCaddy(): Promise<void> {
  await writeFile(caddyfile, currentCaddyConfig());
  if (!caddyStarted || stopping) return;
  reloadQueue = reloadQueue.then(async () => {
    const reload = Bun.spawn(
      ['caddy', 'reload', '--config', caddyfile, '--adapter', 'caddyfile'],
      {stdout: 'inherit', stderr: 'inherit'},
    );
    const code = await reload.exited;
    if (code !== 0) console.error(`caddy reload exited with status ${code}`);
  });
  await reloadQueue;
}

function trackChild(child: Bun.Subprocess): void {
  children.add(child);
  child.exited.finally(() => children.delete(child));
}

function spawnLegacyTtyd(profile: LegacyRoute): void {
  const child = Bun.spawn([
    'ttyd',
    '--interface', '127.0.0.1',
    '--port', String(profile.ttydPort),
    '--writable',
    '--index', '/usr/share/ttyd/index.html',
    '--base-path', `/${profile.slug}`,
    '--client-option', `titleFixed=${profile.label}`,
    ...sshCommand(profile, knownHosts),
  ], {stdout: 'inherit', stderr: 'inherit'});
  trackChild(child);
  child.exited.then((code) => {
    if (!stopping) {
      console.error(`ttyd profile ${profile.slug} exited with status ${code}`);
      stop(code || 1);
    }
  });
}

async function spawnSessionTtyd(profile: Profile, session: TmuxSession): Promise<void> {
  const key = routeKey(profile.slug, session.slug);
  if (sessionChildren.has(key)) return;
  const ttydPort = nextPort++;
  const child = Bun.spawn([
    'ttyd',
    '--interface', '127.0.0.1',
    '--port', String(ttydPort),
    '--writable',
    '--index', '/usr/share/ttyd/index.html',
    '--base-path', `/${profile.slug}/${session.slug}`,
    '--client-option', `titleFixed=${profile.label} · ${session.label}`,
    ...sshCommand(profile, knownHosts, tmuxAttachCommand(session.name)),
  ], {stdout: 'inherit', stderr: 'inherit'});
  trackChild(child);
  sessionChildren.set(key, child);
  sessionRoutes.set(key, {
    hostSlug: profile.slug,
    sessionSlug: session.slug,
    ttydPort,
  });
  child.exited.then(async (code) => {
    if (sessionChildren.get(key) !== child) return;
    sessionChildren.delete(key);
    sessionRoutes.delete(key);
    if (!stopping) {
      console.log(`ttyd session ${key} exited with status ${code}`);
      await reloadCaddy();
    }
  });
}

async function discover(profile: Profile): Promise<TmuxSession[]> {
  const sessions = await listTmuxSessions(profile, knownHosts);
  const live = new Set(sessions.map((session) => routeKey(profile.slug, session.slug)));
  let routesChanged = false;
  for (const [key, route] of sessionRoutes) {
    if (route.hostSlug !== profile.slug || live.has(key)) continue;
    sessionRoutes.delete(key);
    const child = sessionChildren.get(key);
    sessionChildren.delete(key);
    child?.kill('SIGTERM');
    routesChanged = true;
  }
  for (const session of sessions) await spawnSessionTtyd(profile, session);
  if (routesChanged) await reloadCaddy();
  return sessions;
}

function withMissingFixed(profile: Profile, sessions: TmuxSession[]): TmuxSession[] {
  const existing = new Set(sessions.map((session) => session.name));
  return [
    ...profile.sessions.filter((fixed) => !existing.has(fixed.name)).map((fixed) => ({
      slug: fixed.slug,
      name: fixed.name,
      label: fixed.label,
      created: 0,
      attached: 0,
      managed: false,
      fixed,
    })),
    ...sessions,
  ];
}

function stop(exitCode: number): void {
  if (!stopping) {
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(exitCode), 250);
}

process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));

for (const profile of legacyRoutes) spawnLegacyTtyd(profile);
for (const profile of routedProfiles) {
  try {
    await discover(profile);
  } catch (error) {
    console.error(`could not discover tmux sessions for ${profile.slug}:`, error);
  }
}
await reloadCaddy();

const picker = Bun.serve({
  hostname: '127.0.0.1',
  port: pickerPort,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      if (request.method !== 'GET') return new Response('Method not allowed', {status: 405});
      const sessionsByProfile = new Map<string, TmuxSession[]>();
      await Promise.all(routedProfiles.map(async (profile) => {
        try {
          sessionsByProfile.set(profile.slug, withMissingFixed(profile, await discover(profile)));
        } catch (error) {
          console.error(`could not discover tmux sessions for ${profile.slug}:`, error);
          sessionsByProfile.set(profile.slug, withMissingFixed(profile, []));
        }
      }));
      await reloadCaddy();
      return pickerResponse(profiles, sessionsByProfile);
    }
    const parts = url.pathname.split('/').filter(Boolean);
    const profile = parts[0] ? profileBySlug.get(parts[0]) : undefined;
    if (!profile || !profile.sessionRouting) return new Response('Not found', {status: 404});

    if (request.method === 'POST' && parts.length === 2 && parts[1] === 'sessions') {
      try {
        const form = await request.formData();
        const name = form.get('name');
        const session = await createManagedSession(profile, knownHosts, {
          name: typeof name === 'string' ? name : undefined,
        });
        await spawnSessionTtyd(profile, session);
        await reloadCaddy();
        return Response.redirect(new URL(`/${profile.slug}/${session.slug}/`, url), 303);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Could not create session';
        return unavailableResponse(profile, detail);
      }
    }

    if (request.method !== 'GET') return new Response('Method not allowed', {status: 405});
    try {
      const sessions = await discover(profile);
      if (parts.length === 1) {
        await reloadCaddy();
        return sessionsResponse(
          profile,
          withMissingFixed(profile, sessions),
          url.searchParams.get('ended') ?? undefined,
        );
      }

      if (parts.length === 2) {
        let session = sessions.find((candidate) => candidate.slug === parts[1]);
        if (!session) {
          const fixed = profile.sessions.find((candidate) => candidate.slug === parts[1]);
          if (fixed) {
            await ensureFixedSession(profile, fixed, knownHosts);
            session = (await discover(profile)).find((candidate) => candidate.name === fixed.name);
          }
        }
        if (session) {
          await spawnSessionTtyd(profile, session);
          await reloadCaddy();
          const origin = sessionOrigin(profile.slug, session.slug);
          if (!origin) throw new Error('Session route did not start');
          const terminal = await fetch(origin);
          return new Response(terminal.body, {
            status: terminal.status,
            headers: terminal.headers,
          });
        }
        return Response.redirect(new URL(`/${profile.slug}/?ended=${encodeURIComponent(parts[1])}`, url), 302);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Could not reach host';
      return unavailableResponse(profile, detail);
    }
    return new Response('Not found', {status: 404});
  },
});

const caddy = Bun.spawn(
  ['caddy', 'run', '--config', caddyfile, '--adapter', 'caddyfile'],
  {stdout: 'inherit', stderr: 'inherit'},
);
caddyStarted = true;
trackChild(caddy);
caddy.exited.then((code) => {
  if (!stopping) {
    console.error(`caddy exited with status ${code}`);
    stop(code || 1);
  }
});

console.log(
  `ttyd-mobile gateway listening on :7681 with ${profiles.length} profile(s)`,
);
await Promise.all([...children].map((child) => child.exited));
picker.stop();
