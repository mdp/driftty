import {access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {basename, join} from 'node:path';
import {parse} from 'yaml';

export interface Profile {
  slug: string;
  label: string;
  host: string;
  port: number;
  user: string;
  key: string;
  keyPath: string;
  autorun?: string;
  sessions: FixedSession[];
  newSessions?: NewSessions;
  sessionRouting: boolean;
}

export interface FixedSession {
  slug: string;
  name: string;
  label: string;
  directory?: string;
  command?: string;
}

export interface NewSessions {
  directory?: string;
  command?: string;
  prefix: string;
  max?: number;
}

interface LoadOptions {
  keysDir?: string;
  checkKeys?: boolean;
}

function required(value: unknown, field: string, index: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`profile ${index + 1}: ${field} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string, context: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${context}: ${field} is required`);
  }
  return value.trim();
}

function sessionSlug(value: string, context: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`${context}: invalid slug "${value}"`);
  }
  return value;
}

function parseSessions(value: unknown, profileIndex: number): FixedSession[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`profile ${profileIndex + 1}: sessions must be a list`);
  }
  const seen = new Set<string>();
  const seenNames = new Set<string>();
  return value.map((raw, sessionIndex) => {
    const context = `profile ${profileIndex + 1} session ${sessionIndex + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`${context}: must be a mapping`);
    }
    const session = raw as Record<string, unknown>;
    const name = optionalString(session.name, 'name', context);
    if (!name || /[:\s]/.test(name)) {
      throw new Error(`${context}: invalid tmux session name`);
    }
    const slug = sessionSlug(
      optionalString(session.slug, 'slug', context) ?? name,
      context,
    );
    if (seen.has(slug)) throw new Error(`${context}: duplicate slug "${slug}"`);
    if (seenNames.has(name)) throw new Error(`${context}: duplicate tmux session name "${name}"`);
    seen.add(slug);
    seenNames.add(name);
    return {
      slug,
      name,
      label: optionalString(session.label, 'label', context) ?? name,
      directory: optionalString(session.directory, 'directory', context),
      command: optionalString(session.command, 'command', context),
    };
  });
}

function parseNewSessions(value: unknown, profileIndex: number): NewSessions | undefined {
  if (value === undefined || value === false) return undefined;
  const context = `profile ${profileIndex + 1} new_sessions`;
  if (value === true) return {prefix: 'ttyd-'};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context}: must be true, false, or a mapping`);
  }
  const settings = value as Record<string, unknown>;
  const enabled = settings.enabled === undefined ? true : settings.enabled;
  if (typeof enabled !== 'boolean') throw new Error(`${context}: enabled must be boolean`);
  if (!enabled) return undefined;
  const prefix = optionalString(settings.prefix, 'prefix', context) ?? 'ttyd-';
  if (/[:\s/]/.test(prefix)) throw new Error(`${context}: invalid prefix`);
  const max = settings.max === undefined ? undefined : Number(settings.max);
  if (max !== undefined && (!Number.isInteger(max) || max < 1)) {
    throw new Error(`${context}: max must be a positive integer`);
  }
  return {
    prefix,
    max,
    directory: optionalString(settings.directory, 'directory', context),
    command: optionalString(settings.command, 'command', context),
  };
}

export async function parseProfiles(
  source: string,
  {keysDir = '/keys', checkKeys = true}: LoadOptions = {},
): Promise<Profile[]> {
  const document = parse(source) as {profiles?: unknown};
  if (!document || !Array.isArray(document.profiles) || document.profiles.length === 0) {
    throw new Error('profiles must contain at least one profile');
  }

  const seen = new Set<string>();
  const profiles = document.profiles.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`profile ${index + 1}: must be a mapping`);
    }
    const value = raw as Record<string, unknown>;
    const slug = required(value.slug, 'slug', index);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new Error(`profile ${index + 1}: invalid slug "${slug}"`);
    }
    if (seen.has(slug)) throw new Error(`duplicate profile slug: ${slug}`);
    seen.add(slug);

    const key = required(value.key, 'key', index);
    if (key !== basename(key) || key === '.' || key === '..') {
      throw new Error(`profile ${index + 1}: key must be a filename under /keys`);
    }
    const port = value.port === undefined ? 22 : Number(value.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`profile ${index + 1}: invalid port`);
    }
    const autorun = value.autorun === undefined
      ? undefined
      : required(value.autorun, 'autorun', index);
    const sessions = parseSessions(value.sessions, index);
    const newSessions = parseNewSessions(value.new_sessions, index);
    const sessionRouting = value.sessions !== undefined || value.new_sessions !== undefined;
    if (sessionRouting && autorun) {
      throw new Error(`profile ${index + 1}: autorun cannot be combined with session routing`);
    }
    if (newSessions && sessions.some((session) => session.name.startsWith(newSessions.prefix))) {
      throw new Error(
        `profile ${index + 1}: fixed session names cannot start with managed prefix "${newSessions.prefix}"`,
      );
    }

    return {
      slug,
      label: required(value.label, 'label', index),
      host: required(value.host, 'host', index),
      port,
      user: required(value.user, 'user', index),
      key,
      keyPath: join(keysDir, key),
      autorun,
      sessions,
      newSessions,
      sessionRouting,
    };
  });

  if (checkKeys) {
    for (const profile of profiles) {
      try {
        await access(profile.keyPath, constants.R_OK);
      } catch {
        throw new Error(`profile ${profile.slug}: key is not readable: ${profile.keyPath}`);
      }
    }
  }
  return profiles;
}
