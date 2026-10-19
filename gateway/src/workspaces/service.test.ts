import {describe, expect, test} from 'bun:test';
import type {VercelWorkspaceProvider} from '../workspace/providers/vercel';
import type {TerminalRoutes} from '../terminal-routes';
import {WorkspaceService} from './service';
import {WorkspaceStore, type WorkspaceRecord} from './store';

describe('workspace service controls', () => {
  test('installs generic project secrets before clone and setup without persisting output', async () => {
    const sourceSecret = 'test-local-api-key-should-never-be-logged';
    const calls: Array<{args?: string[]; env?: Record<string, string>}> = [];
    const provider = {
      async create({name}: {name: string}) { return {id: name, name}; },
      async exec(_handle: unknown, command: {args?: string[]; env?: Record<string, string>}) {
        calls.push(command);
        return {exitCode: 0, stdout: '', stderr: ''};
      },
      async terminalDomain() { return 'https://terminal.example'; },
    } as unknown as VercelWorkspaceProvider;
    const terminals = {
      async startRemote() {},
    } as unknown as TerminalRoutes;
    const project = {
      id: 'demo', label: 'Demo', provider: 'vercel' as const,
      repository: {url: 'https://example.test/demo.git', directory: '/workspace/demo'},
      secrets: {env: {GH_TOKEN: 'GH_TOKEN'}},
    };
    const service = new WorkspaceService(
      provider, new WorkspaceStore(':memory:'), new Map([['demo', project]]), terminals,
    );
    try {
      await service.create('demo', 'demo-secret-test', undefined, {GH_TOKEN: sourceSecret});
      let workspace = await service.get('demo-secret-test');
      for (let attempt = 0; workspace?.state === 'provisioning' && attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        workspace = await service.get('demo-secret-test');
      }

      expect(workspace?.state).toBe('ready');
      const installCall = calls.find(({env}) => env?.DRIFTTY_SYSTEM_ENVIRONMENT);
      expect(installCall?.env?.DRIFTTY_SYSTEM_ENVIRONMENT).toContain(sourceSecret);
      expect(installCall?.args?.join('\n')).not.toContain(sourceSecret);
      const scripts = calls.map(({args}) => args?.join('\n') ?? '');
      expect(scripts.findIndex((script) => script.includes('DRIFTTY_SYSTEM_ENVIRONMENT'))).toBeLessThan(scripts.findIndex((script) => script.includes('git clone')));
      expect(calls.find(({args}) => args?.join('\n').includes('git clone'))?.env).toEqual({GH_TOKEN: sourceSecret});
      const terminalStart = calls.find(({args}) => args?.join('\n').includes('respawn-pane -k -t coding'));
      expect(terminalStart?.args?.join('\n')).toContain('system.env');
      const terminalScript = terminalStart?.args?.join('\n') ?? '';
      expect(terminalScript.indexOf('new-session')).toBeLessThan(terminalScript.indexOf('set-environment'));
      expect(terminalScript).toContain("'set-environment', '-g'");
      expect(terminalScript).toContain('respawn-pane -k -t coding');
      expect(JSON.stringify(terminalStart?.args)).not.toContain(sourceSecret);
      expect(JSON.stringify(terminalStart?.env)).not.toContain(sourceSecret);
      expect(JSON.stringify(workspace)).not.toContain(sourceSecret);
    } finally {
    }
  });

  test('deletes the provider sandbox, removes its terminal route, and forgets its record', async () => {
    const store = new WorkspaceStore(':memory:');
    const record: WorkspaceRecord = {
      id: 'id-1', name: 'driftty-demo', project: 'driftty', provider: 'vercel',
      providerName: 'driftty-demo', state: 'ready', operation: null, terminalUrl: 'https://terminal.example',
      terminalAuth: 'c2VjcmV0', branch: 'main', error: null,
      statusCheckedAt: null, statusError: null,
      createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z',
    };
    await store.insert(record);
    const calls: string[] = [];
    const provider = {
      async status() { return 'running'; },
      async destroy(handle: {name: string}) { calls.push(`destroy:${handle.name}`); },
    } as unknown as VercelWorkspaceProvider;
    const terminals = {
      async stopRemote(slug: string) { calls.push(`route:${slug}`); },
    } as unknown as TerminalRoutes;
    const service = new WorkspaceService(provider, store, new Map(), terminals);

    await service.delete(record.name);

    expect(calls).toEqual(['destroy:driftty-demo', 'route:workspace-driftty-demo']);
    expect(await store.get(record.name)).toBeUndefined();
  });

  test('syncs the complete declared set and records only safe generation metadata', async () => {
    const store = new WorkspaceStore(':memory:');
    const record: WorkspaceRecord = {
      id: 'id-sync', name: 'demo-sync-test', project: 'demo', provider: 'vercel',
      providerName: 'demo-sync-test', state: 'ready', operation: null, terminalUrl: 'https://terminal.example',
      terminalAuth: 'c2VjcmV0', branch: null, error: null,
      statusCheckedAt: null, statusError: null,
      createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z',
    };
    await store.insert(record);
    const secretValue = 'private-sync-fixture';
    let delivered = '';
    const provider = {
      async resume(handle: {name: string}) { return {id: handle.name, name: handle.name}; },
      async exec(_handle: unknown, command: {env?: Record<string, string>}) {
        if (command.env?.DRIFTTY_SYSTEM_ENVIRONMENT) delivered = command.env.DRIFTTY_SYSTEM_ENVIRONMENT;
        return {exitCode: 0, stdout: '', stderr: ''};
      },
    } as unknown as VercelWorkspaceProvider;
    const project = {
      id: 'demo', label: 'Demo', provider: 'vercel' as const,
      repository: {url: 'https://example.test/demo.git', directory: '/workspace/demo'},
      secrets: {env: {TOKEN: 'TOKEN'}},
    };
    const service = new WorkspaceService(
      provider, store, new Map([['demo', project]]), {} as TerminalRoutes,
    );
    const result = await service.syncSecrets(record.name, {TOKEN: secretValue});
    expect(result.secretSync?.bindings).toEqual(['TOKEN']);
    expect(JSON.stringify(result)).not.toContain(secretValue);
    expect(delivered).toContain(secretValue);
    expect(result.secretSync?.syncedAt).toBeTruthy();
  });
});
