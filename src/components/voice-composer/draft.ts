const DRAFT_PREFIX = 'ttyd-mobile:composer-draft:';

export function composerDraftKey(pathname: string): string {
  const route = pathname.replace(/\/+$/, '') || '/';
  return `${DRAFT_PREFIX}${route}`;
}

export function loadComposerDraft(
  storage: Pick<Storage, 'getItem'>,
  pathname: string
): string {
  try {
    return storage.getItem(composerDraftKey(pathname)) ?? '';
  } catch {
    return '';
  }
}

export function saveComposerDraft(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  pathname: string,
  value: string
) {
  try {
    if (value) storage.setItem(composerDraftKey(pathname), value);
    else storage.removeItem(composerDraftKey(pathname));
  } catch {
    // Private browsing and storage policies may make sessionStorage unavailable.
  }
}
