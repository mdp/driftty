import type {FixedSession, Profile} from './profiles';
import {sshBaseCommand} from './ssh';
import {randomSessionName} from './names';

export interface TmuxSession {
  slug: string;
  name: string;
  label: string;
  created: number;
  attached: number;
  managed: boolean;
  fixed?: FixedSession;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

async function remote(
  profile: Profile,
  knownHosts: string,
  command: string,
  allowEmpty = false,
): Promise<string> {
  const process = Bun.spawn(
    [...sshBaseCommand(profile, knownHosts, false), command],
    {stdout: 'pipe', stderr: 'pipe'},
  );
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (code !== 0 && !(allowEmpty && code === 1 && stdout.trim() === '')) {
    throw new Error(`SSH command for ${profile.slug} failed: ${stderr.trim() || `status ${code}`}`);
  }
  return stdout;
}

export async function listTmuxSessions(
  profile: Profile,
  knownHosts: string,
): Promise<TmuxSession[]> {
  const output = await remote(
    profile,
    knownHosts,
    `tmux list-sessions -F '#{session_name}\t#{session_created}\t#{session_attached}'`,
    true,
  );
  const fixedByName = new Map(profile.sessions.map((session) => [session.name, session]));
  const fixedNames = new Set(fixedByName.keys());
  const prefix = profile.newSessions?.prefix;

  return output.trim().split('\n').filter(Boolean).flatMap((line) => {
    const [name, createdValue, attachedValue] = line.split('\t');
    if (!name) return [];
    const fixed = fixedByName.get(name);
    const managed = Boolean(prefix && name.startsWith(prefix));
    if (!fixedNames.has(name) && !managed) return [];
    const slug = fixed?.slug ?? name.slice(prefix!.length);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return [];
    return [{
      slug,
      name,
      label: fixed?.label ?? slug,
      created: Number(createdValue) || 0,
      attached: Number(attachedValue) || 0,
      managed,
      fixed,
    }];
  });
}

function createCommand(name: string, directory?: string, command?: string): string {
  const args = ['tmux', 'new-session', '-d', '-s', shellQuote(name)];
  if (directory) args.push('-c', shellQuote(directory));
  if (command) args.push(shellQuote(command));
  return args.join(' ');
}

export async function ensureFixedSession(
  profile: Profile,
  session: FixedSession,
  knownHosts: string,
): Promise<void> {
  const check = `tmux has-session -t ${shellQuote(`=${session.name}`)} 2>/dev/null || ` +
    createCommand(session.name, session.directory, session.command);
  await remote(profile, knownHosts, check);
}

export async function createManagedSession(
  profile: Profile,
  knownHosts: string,
  random = Math.random,
): Promise<TmuxSession> {
  const settings = profile.newSessions;
  if (!settings) throw new Error(`profile ${profile.slug} does not allow new sessions`);
  const existing = await listTmuxSessions(profile, knownHosts);
  const managed = existing.filter((session) => session.managed);
  if (settings.max !== undefined && managed.length >= settings.max) {
    throw new Error(`profile ${profile.slug} has reached its session limit`);
  }
  const used = new Set([
    ...existing.map((session) => session.slug),
    ...profile.sessions.map((session) => session.slug),
  ]);
  let slug = '';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = randomSessionName(random);
    if (!used.has(candidate)) {
      slug = candidate;
      break;
    }
  }
  if (!slug) throw new Error('could not generate a unique session name');
  const name = `${settings.prefix}${slug}`;
  await remote(profile, knownHosts, createCommand(name, settings.directory, settings.command));
  return {
    slug,
    name,
    label: slug,
    created: Math.floor(Date.now() / 1000),
    attached: 0,
    managed: true,
  };
}

export function tmuxAttachCommand(sessionName: string): string {
  return `TTYD_SESSION=1; export TTYD_SESSION; exec tmux attach-session -t ${shellQuote(`=${sessionName}`)}`;
}
