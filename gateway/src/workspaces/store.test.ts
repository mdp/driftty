import {describe, expect, test} from 'bun:test';
import {WorkspaceStore, type WorkspaceRecord} from './store';

describe('workspace state store', () => {
  test('persists records and enforces unique names', async () => {
    const store = new WorkspaceStore(':memory:');
    const record: WorkspaceRecord = {
      id: 'id-1', name: 'driftty-fix-283', project: 'driftty', provider: 'vercel',
      providerName: 'driftty-fix-283', state: 'provisioning', operation: null, terminalUrl: null,
      terminalAuth: null, branch: 'fix/283', error: null,
      statusCheckedAt: null, statusError: null,
      createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z',
    };
    await store.insert(record);
    expect(await store.get(record.name)).toEqual(record);
    expect(await store.list()).toEqual([record]);
    await expect(store.insert({...record, id: 'id-2'})).rejects.toThrow();
    await store.delete(record.name);
    expect(await store.get(record.name)).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });
});
