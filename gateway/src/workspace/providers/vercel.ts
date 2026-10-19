import {Sandbox} from '@vercel/sandbox';
import type {
  ExecCommand,
  ExecResult,
  WorkspaceHandle,
  WorkspaceProvider,
  WorkspaceStatus,
} from '../types.ts';

type VercelCredentials = {
  token: string;
  teamId: string;
  projectId: string;
};

type VercelWorkspaceEnvironment = {
  VERCEL_TOKEN?: string;
  VERCEL_TEAM_ID?: string;
  VERCEL_PROJECT_ID?: string;
};

export function vercelCredentials(
  env: VercelWorkspaceEnvironment = {
    VERCEL_TOKEN: process.env.VERCEL_TOKEN,
    VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID,
    VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
  },
): VercelCredentials {
  const {VERCEL_TOKEN: token, VERCEL_TEAM_ID: teamId, VERCEL_PROJECT_ID: projectId} = env;
  const missing = [
    !token && 'VERCEL_TOKEN',
    !teamId && 'VERCEL_TEAM_ID',
    !projectId && 'VERCEL_PROJECT_ID',
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`Missing Vercel Sandbox configuration: ${missing.join(', ')}`);
  }
  return {token: token!, teamId: teamId!, projectId: projectId!};
}

function sdkCredentials(env?: VercelWorkspaceEnvironment): VercelCredentials {
  return vercelCredentials(env);
}

function assertName(name: string): void {
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(name)) {
    throw new Error('Workspace name must be 3–63 lowercase letters, numbers, or hyphens');
  }
}

export class VercelWorkspaceProvider implements WorkspaceProvider {
  constructor(private readonly env: VercelWorkspaceEnvironment = {
    VERCEL_TOKEN: process.env.VERCEL_TOKEN,
    VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID,
    VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
  }) {}

  async create(spec: {name: string; ports?: number[]}): Promise<WorkspaceHandle> {
    assertName(spec.name);
    const sandbox = await Sandbox.create({
      ...sdkCredentials(this.env),
      name: spec.name,
      ports: spec.ports,
      persistent: true,
      timeout: 45 * 60 * 1000,
      tags: {managedBy: 'driftty'},
    });
    return {id: sandbox.name, name: sandbox.name};
  }

  async terminalDomain(handle: WorkspaceHandle, port: number): Promise<string> {
    const sandbox = await Sandbox.get({
      ...sdkCredentials(this.env),
      name: handle.name,
    });
    return sandbox.domain(port);
  }

  async exec(
    handle: WorkspaceHandle,
    command: ExecCommand,
  ): Promise<ExecResult> {
    const sandbox = await Sandbox.get({
      ...sdkCredentials(this.env),
      name: handle.name,
    });
    const result = await sandbox.runCommand({
      cmd: command.cmd,
      args: command.args,
      cwd: command.cwd,
      env: command.env,
      timeoutMs: command.timeoutMs,
    });
    const [stdout, stderr] = await Promise.all([
      result.stdout(),
      result.stderr(),
    ]);
    return {exitCode: result.exitCode ?? 1, stdout, stderr};
  }

  async status(handle: WorkspaceHandle): Promise<WorkspaceStatus> {
    const credentials = sdkCredentials(this.env);
    // Listing metadata is intentionally used instead of Sandbox.get(): get()
    // resumes stopped sandboxes, while status checks must not wake compute.
    const sandboxes = await Sandbox.list({
      ...credentials,
      namePrefix: handle.name,
      sortBy: 'name',
    });
    for await (const sandbox of sandboxes) {
      if (sandbox.name === handle.name) return sandbox.status;
    }
    return 'destroyed';
  }

  async stop(handle: WorkspaceHandle): Promise<void> {
    const sandbox = await Sandbox.get({
      ...sdkCredentials(this.env),
      name: handle.name,
    });
    await sandbox.stop();
  }

  async resume(handle: WorkspaceHandle): Promise<WorkspaceHandle> {
    // Sandbox.get resumes an existing persistent sandbox.
    const sandbox = await Sandbox.get({
      ...sdkCredentials(this.env),
      name: handle.name,
    });
    return {id: sandbox.name, name: sandbox.name};
  }

  async destroy(handle: WorkspaceHandle): Promise<void> {
    const sandbox = await Sandbox.get({
      ...sdkCredentials(this.env),
      name: handle.name,
    });
    await sandbox.delete({deleteOrphanSnapshots: true});
  }
}
