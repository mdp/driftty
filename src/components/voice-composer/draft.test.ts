import {describe, expect, test, vi} from 'vitest';
import {
  composerDraftKey,
  loadComposerDraft,
  saveComposerDraft,
  composerHistoryKey,
  loadComposerHistory,
  recordComposerHistory,
} from './draft';

describe('composer drafts', () => {
  test('isolates drafts by normalized terminal route', () => {
    expect(composerDraftKey('/aachen/mdp/')).toBe(
      'ttyd-mobile:composer-draft:/aachen/mdp'
    );
    expect(composerDraftKey('/aachen/shell')).not.toBe(
      composerDraftKey('/aachen/mdp')
    );
  });

  test('loads a saved draft and tolerates unavailable storage', () => {
    expect(
      loadComposerDraft({getItem: () => 'saved prompt'}, '/aachen/mdp')
    ).toBe('saved prompt');
    expect(
      loadComposerDraft(
        {
          getItem: () => {
            throw new Error('blocked');
          },
        },
        '/aachen/mdp'
      )
    ).toBe('');
  });

  test('stores non-empty drafts and removes cleared drafts', () => {
    const storage = {
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    saveComposerDraft(storage, '/aachen/mdp', 'hello');
    expect(storage.setItem).toHaveBeenCalledWith(
      'ttyd-mobile:composer-draft:/aachen/mdp',
      'hello'
    );

    saveComposerDraft(storage, '/aachen/mdp', '');
    expect(storage.removeItem).toHaveBeenCalledWith(
      'ttyd-mobile:composer-draft:/aachen/mdp'
    );
  });

  test('loads history safely and isolates it by route', () => {
    expect(composerHistoryKey('/aachen/mdp/')).toBe(
      'ttyd-mobile:composer-history:/aachen/mdp',
    );
    expect(loadComposerHistory({
      getItem: () => JSON.stringify(['five', '', 4, 'four', 'three']),
    }, '/aachen/mdp')).toEqual(['five', 'four', 'three']);
    expect(loadComposerHistory({getItem: () => '{bad'}, '/aachen/mdp')).toEqual([]);
  });

  test('records newest entries, removes duplicates, and keeps five', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    for (const value of ['one', 'two', 'three', 'four', 'five', 'six']) {
      recordComposerHistory(storage, '/aachen/mdp', value);
    }
    expect(recordComposerHistory(storage, '/aachen/mdp', 'four')).toEqual([
      'four', 'six', 'five', 'three', 'two',
    ]);
  });
});
