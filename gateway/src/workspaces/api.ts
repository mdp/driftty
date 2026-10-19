import type {WorkspaceService} from './service.ts';
import {serveFetch} from '../node-http.ts';

export function startWorkspaceApi(
  service: WorkspaceService,
  port = 7798,
  hostname = '127.0.0.1',
) {
  return serveFetch({
    hostname,
    port,
    async fetch(request) {
      const url = new URL(request.url);
      const parts = url.pathname.split('/').filter(Boolean);
      if (request.method === 'GET' && parts.length === 3 && parts[0] === 'projects' && parts[2] === 'secrets') {
        try { return json({secrets: await service.getProjectSecrets(parts[1]!)}); }
        catch (error) { return json({error: error instanceof Error ? error.message : 'could not check project secrets'}, 400); }
      }
      if (parts[0] !== 'workspaces') return json({error: 'not found'}, 404);
      try {
        if (request.method === 'GET' && parts.length === 1) {
          return json({workspaces: await service.list()});
        }
        if (request.method === 'POST' && parts.length === 1) {
          const body = await request.json() as {project?: unknown; name?: unknown; branch?: unknown; secrets?: unknown};
          if (typeof body.project !== 'string') return json({error: 'project is required'}, 400);
          if (body.name !== undefined && typeof body.name !== 'string') return json({error: 'name must be a string'}, 400);
          if (body.branch !== undefined && typeof body.branch !== 'string') return json({error: 'branch must be a string'}, 400);
          const name = typeof body.name === 'string'
            ? body.name
            : `${body.project}-${crypto.randomUUID().slice(0, 6)}`;
          if (body.secrets !== undefined && (!body.secrets || typeof body.secrets !== 'object' || Array.isArray(body.secrets))) return json({error: 'secrets must be an environment mapping'}, 400);
          return json({workspace: await service.create(body.project, name, body.branch as string | undefined, (body.secrets ?? {}) as Record<string, string>)}, 202);
        }
        if (parts.length === 2 && request.method === 'GET') {
          const record = await service.get(parts[1]!);
          return record ? json({workspace: record}) : json({error: 'workspace not found'}, 404);
        }
        if (parts.length === 3 && request.method === 'POST' && parts[2] === 'stop') {
          return json({workspace: await service.stop(parts[1]!)});
        }
        if (parts.length === 3 && request.method === 'POST' && parts[2] === 'resume') {
          const body = await request.json().catch(() => ({})) as {secrets?: unknown};
          if (body.secrets !== undefined && (!body.secrets || typeof body.secrets !== 'object' || Array.isArray(body.secrets))) return json({error: 'secrets must be an environment mapping'}, 400);
          return json({workspace: await service.resume(parts[1]!, (body.secrets ?? {}) as Record<string, string>)});
        }
        if (parts.length === 3 && request.method === 'POST' && parts[2] === 'retry') {
          const body = await request.json().catch(() => ({})) as {secrets?: unknown};
          if (body.secrets !== undefined && (!body.secrets || typeof body.secrets !== 'object' || Array.isArray(body.secrets))) return json({error: 'secrets must be an environment mapping'}, 400);
          return json({workspace: await service.retry(parts[1]!, (body.secrets ?? {}) as Record<string, string>)}, 202);
        }
        if (parts.length === 4 && request.method === 'POST' && parts[2] === 'secrets' && parts[3] === 'sync') {
          const body = await request.json().catch(() => ({})) as {restartTerminal?: unknown; secrets?: unknown};
          if (body.restartTerminal !== undefined && typeof body.restartTerminal !== 'boolean') return json({error: 'restartTerminal must be a boolean'}, 400);
          if (body.secrets !== undefined && (!body.secrets || typeof body.secrets !== 'object' || Array.isArray(body.secrets))) return json({error: 'secrets must be an environment mapping'}, 400);
          return json({workspace: await service.syncSecrets(parts[1]!, (body.secrets ?? {}) as Record<string, string>, body.restartTerminal === true)});
        }
        return json({error: 'method not allowed'}, 405);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'workspace operation failed';
        const status = /unknown project|already exists|not found|must be|invalid|is (?:ready|stopped|failed|provisioning)/i.test(message)
          ? 400
          : 500;
        return json({error: message}, status);
      }
    },
  });
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {status, headers: {'cache-control': 'no-store'}});
}
