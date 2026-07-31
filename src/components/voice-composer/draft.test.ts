import {describe, expect, test, vi} from 'vitest';
import {
  composerDraftKey,
  loadComposerDraft,
  saveComposerDraft,
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
});
