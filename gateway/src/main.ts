import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {parseProfiles} from './profiles';
import {caddyConfig, type RouteProfile} from './caddy';
import {pickerResponse} from './picker';
import {sshCommand} from './ssh';

const configPath = process.env.PROFILES_FILE ?? '/config/profiles.yaml';
const knownHosts = process.env.KNOWN_HOSTS_FILE ?? '/known-hosts/known_hosts';
const ttydStartPort = 7800;
const pickerPort = 7799;

await mkdir(dirname(knownHosts), {recursive: true});
const profiles = await parseProfiles(await readFile(configPath, 'utf8'));
const routes: RouteProfile[] = profiles.map((profile, index) => ({
  ...profile,
  ttydPort: ttydStartPort + index,
}));

const caddyfile = '/tmp/ttyd-mobile.Caddyfile';
await writeFile(caddyfile, caddyConfig(routes, pickerPort));

const children: Bun.Subprocess[] = [];
let stopping = false;
function stop(exitCode: number): void {
  if (!stopping) {
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(exitCode), 250);
}

process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));

const picker = Bun.serve({
  hostname: '127.0.0.1',
  port: pickerPort,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/') return new Response('Not found', {status: 404});
    return pickerResponse(profiles);
  },
});

for (const profile of routes) {
  const ssh = sshCommand(profile, knownHosts);
  const child = Bun.spawn([
    'ttyd',
    '--interface', '127.0.0.1',
    '--port', String(profile.ttydPort),
    '--writable',
    '--index', '/usr/share/ttyd/index.html',
    '--base-path', `/${profile.slug}`,
    '--client-option', `titleFixed=${profile.label}`,
    ...ssh,
  ], {stdout: 'inherit', stderr: 'inherit'});
  children.push(child);
  child.exited.then((code) => {
    if (!stopping) {
      console.error(`ttyd profile ${profile.slug} exited with status ${code}`);
      stop(code || 1);
    }
  });
}

const caddy = Bun.spawn(
  ['caddy', 'run', '--config', caddyfile, '--adapter', 'caddyfile'],
  {stdout: 'inherit', stderr: 'inherit'},
);
children.push(caddy);
caddy.exited.then((code) => {
  if (!stopping) {
    console.error(`caddy exited with status ${code}`);
    stop(code || 1);
  }
});

console.log(`ttyd-mobile gateway listening on :7681 with ${profiles.length} profile(s)`);
await Promise.all(children.map((child) => child.exited));
picker.stop();
