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

    return {
      slug,
      label: required(value.label, 'label', index),
      host: required(value.host, 'host', index),
      port,
      user: required(value.user, 'user', index),
      key,
      keyPath: join(keysDir, key),
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
