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
const FIRST_FRAGMENT = /^https?:\/\/\S+$/i;

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
  columns: number,
): MultilineWebLink | undefined {
  const firstLine = source.getLine(startY);
  if (!firstLine || firstLine.isWrapped) return undefined;

  const first = firstLine.translateToString(false, 0, columns);
  if (
    first.length !== columns ||
    !FIRST_FRAGMENT.test(first) ||
    /\s/.test(first)
  ) {
    return undefined;
  }

  let text = first;
  let endY = startY;
  let endX = columns;
  let fragments = 1;
  let complete = false;

  for (let y = startY + 1; y < startY + MAX_ROWS; y++) {
    const line = source.getLine(y);
    if (!line) break;
    if (line.isWrapped) return undefined;

    const value = line.translateToString(false, 0, columns);
    const fragment = value.trimEnd();
    if (
      !fragment ||
      fragment.length > columns ||
      /\s/.test(fragment)
    ) {
      return undefined;
    }
    if (text.length + fragment.length > MAX_URL_LENGTH) return undefined;

    text += fragment;
    fragments++;
    endY = y;
    endX = fragment.length;
    if (fragment.length < columns) {
      complete = true;
      break;
    }
  }

  if (
    fragments < 2 ||
    !complete ||
    queriedY < startY ||
    queriedY > endY ||
    !isHttpUrl(text)
  ) {
    return undefined;
  }

  return {
    text,
    range: {
      start: {x: 1, y: startY + 1},
      end: {x: endX, y: endY + 1},
    },
  };
}

export function findMultilineWebLink(
  source: LineSource,
  bufferLineNumber: number,
  columns: number,
): MultilineWebLink | undefined {
  const queriedY = bufferLineNumber - 1;
  const firstPossibleY = Math.max(0, queriedY - MAX_ROWS + 1);

  // Start at the hovered row, then scan upward so all fragments resolve to
  // the exact same reconstructed link and range.
  for (let startY = queriedY; startY >= firstPossibleY; startY--) {
    const link = reconstructFrom(source, startY, queriedY, columns);
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
      this.terminal.cols,
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
