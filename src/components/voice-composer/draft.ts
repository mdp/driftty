const DRAFT_PREFIX = 'ttyd-mobile:composer-draft:';
const HISTORY_PREFIX = 'ttyd-mobile:composer-history:';
const HISTORY_LIMIT = 5;

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

export function composerHistoryKey(pathname: string): string {
  const route = pathname.replace(/\/+$/, '') || '/';
  return `${HISTORY_PREFIX}${route}`;
}

export function loadComposerHistory(
  storage: Pick<Storage, 'getItem'>,
  pathname: string,
): string[] {
  try {
    const value = storage.getItem(composerHistoryKey(pathname));
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.length > 0)
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function saveComposerHistory(
  storage: Pick<Storage, 'setItem'>,
  pathname: string,
  entries: string[],
) {
  try {
    storage.setItem(
      composerHistoryKey(pathname),
      JSON.stringify(entries.filter(Boolean).slice(0, HISTORY_LIMIT)),
    );
  } catch {
    // Private browsing and storage policies may make sessionStorage unavailable.
  }
}

export function recordComposerHistory(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  pathname: string,
  value: string,
): string[] {
  const entries = loadComposerHistory(storage, pathname);
  const next = [value, ...entries.filter((entry) => entry !== value)].slice(
    0,
    HISTORY_LIMIT,
  );
  saveComposerHistory(storage, pathname, next);
  return next;
}
