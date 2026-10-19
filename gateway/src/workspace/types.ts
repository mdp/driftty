export interface WorkspaceHandle {
  /** Stable provider identity. Vercel sandboxes are addressed by name. */
  id: string;
  name: string;
}

export type WorkspaceStatus =
  | 'pending'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'aborted'
  | 'snapshotting'
  | 'destroyed'
  | 'unknown';

export interface ExecCommand {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface WorkspaceProvider {
  create(spec: {name: string; ports?: number[]}): Promise<WorkspaceHandle>;
  exec(handle: WorkspaceHandle, command: ExecCommand): Promise<ExecResult>;
  status(handle: WorkspaceHandle): Promise<WorkspaceStatus>;
  stop(handle: WorkspaceHandle): Promise<void>;
  resume(handle: WorkspaceHandle): Promise<WorkspaceHandle>;
  destroy(handle: WorkspaceHandle): Promise<void>;
}
