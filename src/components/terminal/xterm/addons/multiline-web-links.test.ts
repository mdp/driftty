import {describe, expect, it} from 'vitest';
import {findMultilineWebLink} from './multiline-web-links';

const columns = 32;

function buffer(
  values: Array<string | {text: string; isWrapped: boolean}>,
) {
  return {
    getLine(y: number) {
      const value = values[y];
      if (value === undefined) return undefined;
      const line =
        typeof value === 'string'
          ? {text: value, isWrapped: false}
          : value;
      return {
        isWrapped: line.isWrapped,
        translateToString: (trimRight = false) =>
          trimRight ? line.text.trimEnd() : line.text.padEnd(columns, ' '),
      };
    },
  };
}

function wrap(text: string): string[] {
  const rows: string[] = [];
  for (let offset = 0; offset < text.length; offset += columns) {
    rows.push(text.slice(offset, offset + columns));
  }
  return rows;
}

describe('findMultilineWebLink', () => {
  it('reconstructs an unpadded hard-wrapped URL from every fragment', () => {
    const url =
      'https://example.com/a/long/path/to/a/resource?query=one&other=two';
    const rows = wrap(url);
    const expected = {
      text: url,
      range: {
        start: {x: 1, y: 1},
        end: {x: rows[rows.length - 1].length, y: rows.length},
      },
    };

    rows.forEach((_, index) => {
      expect(findMultilineWebLink(buffer(rows), index + 1, columns)).toEqual(
        expected,
      );
    });
  });

  it('rejects leading padding on the first fragment', () => {
    const url =
      ' https://example.com/a/long/path/to/a/resource?query=one&other=two';
    const rows = wrap(url);

    rows.forEach((_, index) => {
      expect(
        findMultilineWebLink(buffer(rows), index + 1, columns),
      ).toBeUndefined();
    });
  });

  it('rejects leading padding on a continuation fragment', () => {
    const rows = wrap(
      'https://example.com/a/long/path/to/a/resource?query=one&other=two',
    );
    rows[1] = ` ${rows[1].slice(0, -1)}`;

    rows.forEach((_, index) => {
      expect(
        findMultilineWebLink(buffer(rows), index + 1, columns),
      ).toBeUndefined();
    });
  });

  it('rejects a short first fragment with trailing terminal padding', () => {
    const rows = [
      'https://example.com/short',
      'continuation-that-must-not-join',
    ];

    expect(findMultilineWebLink(buffer(rows), 1, columns)).toBeUndefined();
    expect(findMultilineWebLink(buffer(rows), 2, columns)).toBeUndefined();
  });

  it('rejects spaces and trailing prose inside the reconstruction', () => {
    const first = 'https://example.com/'.padEnd(columns, 'a');
    const rows = [first, 'last-part description'];

    expect(findMultilineWebLink(buffer(rows), 1, columns)).toBeUndefined();
    expect(findMultilineWebLink(buffer(rows), 2, columns)).toBeUndefined();
  });

  it.each(['ftp', 'file', 'javascript'])(
    'rejects the unsupported %s protocol',
    (protocol) => {
      const rows = wrap(
        `${protocol}://example.com/a/long/path/to/a/resource?query=one`,
      );
      expect(
        findMultilineWebLink(buffer(rows), 1, columns),
      ).toBeUndefined();
    },
  );

  it.each(['http', 'https', 'HTTP', 'HTTPS'])(
    'accepts a reconstructed %s URL',
    (protocol) => {
      const url =
        `${protocol}://example.com/a/long/path/to/a/resource?query=one`;
      expect(findMultilineWebLink(buffer(wrap(url)), 1, columns)?.text).toBe(
        url,
      );
    },
  );

  it('leaves single-line and soft-wrapped URLs to the stock addon', () => {
    expect(
      findMultilineWebLink(
        buffer(['https://example.com/ordinary']),
        1,
        columns,
      ),
    ).toBeUndefined();
    expect(
      findMultilineWebLink(
        buffer([
          'https://example.com/a/long/path/',
          {text: 'soft-wrapped-fragment', isWrapped: true},
        ]),
        1,
        columns,
      ),
    ).toBeUndefined();
  });

  it('caps reconstruction at 16 rows and 2048 characters', () => {
    const tooManyRows = [
      'https://example.com/'.padEnd(columns, 'a'),
      ...Array.from({length: 15}, () => 'b'.repeat(columns)),
      'end',
    ];
    expect(
      findMultilineWebLink(buffer(tooManyRows), 1, columns),
    ).toBeUndefined();

    const tooLong = `https://example.com/${'a'.repeat(2048)}`;
    expect(
      findMultilineWebLink(buffer(wrap(tooLong)), 1, columns),
    ).toBeUndefined();
  });
});
