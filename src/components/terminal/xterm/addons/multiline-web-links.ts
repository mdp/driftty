import type {
  IBufferLine,
  IBufferRange,
  IDisposable,
  ILink,
  ILinkProvider,
  ITerminalAddon,
  Terminal,
} from '@xterm/xterm';

const MAX_ROWS = 16;
const MAX_URL_LENGTH = 2048;
const FIRST_FRAGMENT = /^(\s*)(https?:\/\/\S+)\s*$/i;
const CONTINUATION = /^(\s*)(\S+)/;

export interface MultilineWebLink {
  range: IBufferRange;
  text: string;
}

interface LineSource {
  getLine(y: number): Pick<IBufferLine, 'isWrapped' | 'translateToString'> | undefined;
}

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      text.toLocaleLowerCase().startsWith(
        `${url.protocol}//${url.host}`.toLocaleLowerCase(),
      )
    );
  } catch {
    return false;
  }
}

function reconstructFrom(
  source: LineSource,
  startY: number,
  queriedY: number,
): MultilineWebLink | undefined {
  const firstLine = source.getLine(startY);
  if (!firstLine || firstLine.isWrapped) return undefined;

  const first = FIRST_FRAGMENT.exec(firstLine.translateToString(true));
  if (!first) return undefined;

  const left = first[1].length;
  const firstEnd = left + first[2].length;
  let right = firstEnd;
  let text = first[2];
  let previousReachedRight = true;
  let endY = startY;
  let endX = firstEnd;
  let fragments = 1;

  for (let y = startY + 1; y < startY + MAX_ROWS; y++) {
    if (!previousReachedRight) break;
    const line = source.getLine(y);
    if (!line) break;
    if (line.isWrapped) return undefined;

    const value = line.translateToString(true);
    const continuation = CONTINUATION.exec(value);
    if (!continuation || continuation[1].length !== left) break;

    const fragment = continuation[2];
    if (text.length + fragment.length > MAX_URL_LENGTH) return undefined;

    text += fragment;
    fragments++;
    endY = y;
    endX = left + fragment.length;

    if (fragments === 2 && endX >= firstEnd) {
      // A CLI can put the URL prefix on a short first row (for example,
      // "https://github.com/search?") before wrapping the query at its real
      // content margin. The first continuation reveals that margin.
      right = endX;
    }
    previousReachedRight = endX === right;

    // Anything after the first token is a delimiter/description, so this row
    // is necessarily the end even when its token fills the content margin.
    if (value.slice(endX).trim().length > 0) break;
  }

  if (
    fragments < 2 ||
    queriedY < startY ||
    queriedY > endY ||
    !isHttpUrl(text)
  ) {
    return undefined;
  }

  return {
    text,
    range: {
      start: { x: left + 1, y: startY + 1 },
      end: { x: endX, y: endY + 1 },
    },
  };
}

export function findMultilineWebLink(
  source: LineSource,
  bufferLineNumber: number,
): MultilineWebLink | undefined {
  const queriedY = bufferLineNumber - 1;
  const firstPossibleY = Math.max(0, queriedY - MAX_ROWS + 1);

  // Start at the hovered row, then scan upward so all fragments resolve to
  // the exact same reconstructed link and range.
  for (let startY = queriedY; startY >= firstPossibleY; startY--) {
    const link = reconstructFrom(source, startY, queriedY);
    if (link) return link;
  }
  return undefined;
}

function openInSafeNewWindow(_event: MouseEvent, uri: string): void {
  const newWindow = window.open();
  if (newWindow) {
    try {
      newWindow.opener = null;
    } catch {
      // Some browsers expose opener as read-only.
    }
    newWindow.location.href = uri;
  } else {
    console.warn('Opening link blocked as opener could not be cleared');
  }
}

class MultilineWebLinkProvider implements ILinkProvider {
  constructor(
    private readonly terminal: Terminal,
    private readonly handler = openInSafeNewWindow,
  ) {}

  provideLinks(
    bufferLineNumber: number,
    callback: (links: ILink[] | undefined) => void,
  ): void {
    const link = findMultilineWebLink(
      this.terminal.buffer.active,
      bufferLineNumber,
    );
    callback(
      link
        ? [{ ...link, activate: this.handler }]
        : undefined,
    );
  }
}

export class MultilineWebLinksAddon implements ITerminalAddon {
  private provider?: IDisposable;

  constructor(
    private readonly handler = openInSafeNewWindow,
  ) {}

  activate(terminal: Terminal): void {
    this.provider = terminal.registerLinkProvider(
      new MultilineWebLinkProvider(terminal, this.handler),
    );
  }

  dispose(): void {
    this.provider?.dispose();
  }
}
