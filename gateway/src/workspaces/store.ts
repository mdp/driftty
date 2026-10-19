import {randomUUID} from 'node:crypto';
import {chmod, mkdir, open, readFile, rename, unlink} from 'node:fs/promises';
import {dirname} from 'node:path';

export type WorkspaceState = 'provisioning' | 'ready' | 'stopped' | 'failed';
export type WorkspaceOperation = 'provisioning' | 'suspending' | 'resuming' | 'deleting' | 'retrying' | 'syncing';

export interface WorkspaceRecord {
  id: string;
  name: string;
  project: string;
  provider: 'vercel';
  providerName: string;
  state: WorkspaceState;
  operation: WorkspaceOperation | null;
  terminalUrl: string | null;
  terminalAuth: string | null;
  branch: string | null;
  error: string | null;
  statusCheckedAt: string | null;
  statusError: string | null;
  createdAt: string;
  updatedAt: string;
  secretSync?: {syncedAt: string; bindings: string[]};
}

interface WorkspaceFile {
  version: 1;
  workspaces: WorkspaceRecord[];
}

export class WorkspaceStore {
  private records?: WorkspaceRecord[];
  private loading?: Promise<WorkspaceRecord[]>;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly path = process.env.DRIFTTY_STATE_FILE ?? '/state/workspaces.json') {}

  async list(): Promise<WorkspaceRecord[]> {
    await this.writes;
    return cloneRecords(await this.load());
  }

  async get(name: string): Promise<WorkspaceRecord | undefined> {
    await this.writes;
    const record = (await this.load()).find((item) => item.name === name);
    return record && structuredClone(record);
  }

  insert(record: WorkspaceRecord): Promise<void> {
    return this.mutate((records) => {
      if (records.some((item) => item.name === record.name || item.providerName === record.providerName)) {
        throw new Error(`workspace already exists: ${record.name}`);
      }
      records.push(structuredClone(record));
    });
  }

  update(record: WorkspaceRecord): Promise<void> {
    return this.mutate((records) => {
      const index = records.findIndex((item) => item.id === record.id);
      if (index < 0) throw new Error(`workspace record not found: ${record.name}`);
      records[index] = structuredClone(record);
    });
  }

  delete(name: string): Promise<void> {
    return this.mutate((records) => {
      const index = records.findIndex((item) => item.name === name);
      if (index >= 0) records.splice(index, 1);
    });
  }

  private mutate(change: (records: WorkspaceRecord[]) => void): Promise<void> {
    const write = this.writes.then(async () => {
      const records = cloneRecords(await this.load());
      change(records);
      await this.persist(records);
      this.records = records;
    });
    this.writes = write.catch(() => undefined);
    return write;
  }

  private load(): Promise<WorkspaceRecord[]> {
    if (this.records) return Promise.resolve(this.records);
    return this.loading ??= this.readFile();
  }

  private async readFile(): Promise<WorkspaceRecord[]> {
    if (this.path === ':memory:') {
      this.records = [];
      return this.records;
    }
    let source: string;
    try {
      source = await readFile(this.path, 'utf8');
    } catch (error) {
      if (isMissingFile(error)) {
        this.records = [];
        return this.records;
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new Error(`workspace state file is not valid JSON: ${this.path}`);
    }
    this.records = validateWorkspaceFile(parsed, this.path);
    return this.records;
  }

  private async persist(records: WorkspaceRecord[]): Promise<void> {
    if (this.path === ':memory:') return;
    const directory = dirname(this.path);
    await mkdir(directory, {recursive: true, mode: 0o700});
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    const contents = `${JSON.stringify({version: 1, workspaces: records}, null, 2)}\n`;
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      file = await open(temporaryPath, 'wx', 0o600);
      await file.writeFile(contents, 'utf8');
      await file.sync();
      await file.close();
      file = undefined;
      await rename(temporaryPath, this.path);
      await chmod(this.path, 0o600);
      try {
        const directoryHandle = await open(directory, 'r');
        await directoryHandle.sync();
        await directoryHandle.close();
      } catch {
        // Directory fsync is unsupported by some platforms; the file itself is synced.
      }
    } catch (error) {
      await file?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}

function validateWorkspaceFile(value: unknown, path: string): WorkspaceRecord[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`workspace state file has an invalid document: ${path}`);
  }
  const file = value as Partial<WorkspaceFile>;
  if (file.version !== 1 || !Array.isArray(file.workspaces)) {
    throw new Error(`workspace state file must have version 1 and a workspaces array: ${path}`);
  }
  const names = new Set<string>();
  const providerNames = new Set<string>();
  for (const [index, raw] of file.workspaces.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`workspace state record ${index + 1} is invalid: ${path}`);
    }
    const record = raw as WorkspaceRecord;
    const requiredStrings: Array<keyof WorkspaceRecord> = [
      'id', 'name', 'project', 'providerName', 'createdAt', 'updatedAt',
    ];
    if (record.provider !== 'vercel' || requiredStrings.some((key) => typeof record[key] !== 'string')) {
      throw new Error(`workspace state record ${index + 1} has invalid identity fields: ${path}`);
    }
    if (!['provisioning', 'ready', 'stopped', 'failed'].includes(record.state)) {
      throw new Error(`workspace state record ${index + 1} has an invalid state: ${path}`);
    }
    if (record.operation !== null && !['provisioning', 'suspending', 'resuming', 'deleting', 'retrying', 'syncing'].includes(record.operation)) {
      throw new Error(`workspace state record ${index + 1} has an invalid operation: ${path}`);
    }
    if (record.secretSync !== undefined && (!record.secretSync || typeof record.secretSync.syncedAt !== 'string' || !Array.isArray(record.secretSync.bindings) ||
      record.secretSync.bindings.some((name) => typeof name !== 'string'))) {
      throw new Error(`workspace state record ${index + 1} has invalid system-secret metadata: ${path}`);
    }
    for (const key of ['terminalUrl', 'terminalAuth', 'branch', 'error', 'statusCheckedAt', 'statusError'] as const) {
      if (record[key] !== null && typeof record[key] !== 'string') {
        throw new Error(`workspace state record ${index + 1} has an invalid ${key}: ${path}`);
      }
    }
    if (names.has(record.name) || providerNames.has(record.providerName)) {
      throw new Error(`workspace state file contains duplicate workspace names: ${path}`);
    }
    names.add(record.name);
    providerNames.add(record.providerName);
  }
  return file.workspaces.map((record) => structuredClone(record));
}

function cloneRecords(records: WorkspaceRecord[]): WorkspaceRecord[] {
  return records.map((record) => structuredClone(record));
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
