import { describe, expect, it } from 'vitest';
import { findMultilineWebLink } from './multiline-web-links';

function buffer(
  values: Array<string | { text: string; isWrapped: boolean }>,
) {
  return {
    getLine(y: number) {
      const value = values[y];
      if (value === undefined) return undefined;
      const line =
        typeof value === 'string'
          ? { text: value, isWrapped: false }
          : value;
      return {
        isWrapped: line.isWrapped,
        translateToString: () => line.text,
      };
    },
  };
}

describe('findMultilineWebLink', () => {
  it('reconstructs a URL and excludes a trailing description', () => {
    const source = buffer([
      '    https://example.com/long-pa',
      '    th/to/a/resource?query=one&',
      '    other=two - this is your link',
    ]);
    const expected = {
      text: 'https://example.com/long-path/to/a/resource?query=one&other=two',
      range: {
        start: { x: 5, y: 1 },
        end: { x: 13, y: 3 },
      },
    };

    expect(findMultilineWebLink(source, 1)).toEqual(expected);
    expect(findMultilineWebLink(source, 2)).toEqual(expected);
    expect(findMultilineWebLink(source, 3)).toEqual(expected);
  });

  it('derives the right margin from a continuation when the URL prefix is short', () => {
    const middle = 'q=repo%3Atorvalds%2Flinux+OR+repo%3A';
    const source = buffer([
      '    https://github.com/search?',
      `    ${middle}`,
      `    ${'python'.padEnd(middle.length, 'x')}`,
      `    ${'language%3AC'.padEnd(middle.length, 'y')}`,
      '    o=desc',
      '    prose after the link',
    ]);
    const expectedText =
      `https://github.com/search?${middle}` +
      'python'.padEnd(middle.length, 'x') +
      'language%3AC'.padEnd(middle.length, 'y') +
      'o=desc';

    for (let row = 1; row <= 5; row++) {
      expect(findMultilineWebLink(source, row)?.text).toBe(expectedText);
    }
    expect(findMultilineWebLink(source, 6)).toBeUndefined();
  });

  it.each([
    {
      name: 'less indentation',
      rows: ['    https://example.com/abcd', '   efghijklmnopqrstuvwx'],
    },
    {
      name: 'more indentation',
      rows: ['    https://example.com/abcd', '     efghijklmnopqrstuvwx'],
    },
    {
      name: 'no indentation',
      rows: ['    https://example.com/abcd', 'efghijklmnopqrstuvwx'],
    },
  ])('rejects a continuation with $name', ({ rows }) => {
    expect(findMultilineWebLink(buffer(rows), 1)).toBeUndefined();
    expect(findMultilineWebLink(buffer(rows), 2)).toBeUndefined();
  });

  it.each([
    {
      name: 'unindented content',
      middle: 'unrelated',
    },
    {
      name: 'a blank row',
      middle: '',
    },
    {
      name: 'whitespace-only content',
      middle: '    ',
    },
  ])('does not cross $name', ({ middle }) => {
    const source = buffer([
      '  https://example.com/abcd',
      middle,
      '  efghijklmnopqrstuvwx',
    ]);
    expect(findMultilineWebLink(source, 1)).toBeUndefined();
    expect(findMultilineWebLink(source, 3)).toBeUndefined();
  });

  it.each(['ftp', 'file', 'javascript'])(
    'rejects the unsupported %s protocol',
    (protocol) => {
      expect(
        findMultilineWebLink(
          buffer([`  ${protocol}://example.com/abcd`, '  efgh']),
          1,
        ),
      ).toBeUndefined();
    },
  );

  it('rejects malformed URLs after reconstruction', () => {
    expect(
      findMultilineWebLink(
        buffer(['  https://exa mple.com', '  continuation']),
        1,
      ),
    ).toBeUndefined();
    expect(
      findMultilineWebLink(
        buffer(['  https://', '  /not-a-host']),
        1,
      ),
    ).toBeUndefined();
  });

  it.each(['http', 'https', 'HTTP', 'HTTPS'])(
    'accepts a reconstructed %s URL',
    (protocol) => {
      const source = buffer([
        `  ${protocol}://example.com/abcdefgh`,
        '  ijklmnopqrst',
      ]);
      expect(findMultilineWebLink(source, 1)?.text).toBe(
        `${protocol}://example.com/abcdefghijklmnopqrst`,
      );
    },
  );

  it('uses an equal-width first row as the continuation margin', () => {
    const prefix = 'https://example.com/abcd';
    const fullContinuation = 'efgh'.padEnd(prefix.length, 'x');
    const source = buffer([
      `  ${prefix}`,
      `  ${fullContinuation}`,
      '  yz',
      '  ignored prose',
    ]);

    expect(findMultilineWebLink(source, 1)?.text).toBe(
      `${prefix}${fullContinuation}yz`,
    );
    expect(findMultilineWebLink(source, 3)?.range.end.y).toBe(3);
    expect(findMultilineWebLink(source, 4)).toBeUndefined();
  });

  it('stops after a short final fragment and ignores following prose', () => {
    const source = buffer([
      '  https://example.com/abcdef',
      '  /last',
      '  this prose must not join',
    ]);
    const link = findMultilineWebLink(source, 2);

    expect(link?.text).toBe('https://example.com/abcdef/last');
    expect(link?.range.end.y).toBe(2);
    expect(findMultilineWebLink(source, 3)).toBeUndefined();
  });

  it('treats a first continuation shorter than the URL prefix as final', () => {
    const source = buffer([
      '  https://example.com/a/very/long/prefix',
      '  end',
      '  prose-that-is-long-enough-to-look-like-a-fragment',
    ]);

    expect(findMultilineWebLink(source, 1)?.text).toBe(
      'https://example.com/a/very/long/prefixend',
    );
    expect(findMultilineWebLink(source, 2)?.range.end.y).toBe(2);
    expect(findMultilineWebLink(source, 3)).toBeUndefined();
  });

  it.each([
    ' - this is a description',
    ' description',
    '\tmetadata',
  ])('stops at trailing delimiter text "%s"', (suffix) => {
    const source = buffer([
      '  https://example.com/abcd',
      `  efghijklmnopqrstuvwx${suffix}`,
      '  must-not-be-appended',
    ]);

    expect(findMultilineWebLink(source, 1)?.text).toBe(
      'https://example.com/abcdefghijklmnopqrstuvwx',
    );
    expect(findMultilineWebLink(source, 3)).toBeUndefined();
  });

  it('allows harmless trailing whitespace without ending a full row', () => {
    const prefix = 'https://example.com/abcd';
    const fullContinuation = 'efgh'.padEnd(prefix.length, 'x');
    const source = buffer([
      `  ${prefix}`,
      `  ${fullContinuation}   `,
      '  yz',
    ]);

    expect(findMultilineWebLink(source, 3)?.text).toBe(
      `${prefix}${fullContinuation}yz`,
    );
  });

  it('leaves single-line and soft-wrapped URLs to the stock addon', () => {
    expect(
      findMultilineWebLink(buffer(['https://example.com/ordinary']), 1),
    ).toBeUndefined();
    expect(
      findMultilineWebLink(
        buffer([
          'https://example.com/long',
          { text: 'soft-wrap', isWrapped: true },
        ]),
        1,
      ),
    ).toBeUndefined();
  });

  it.each([0, 1, 2])(
    'rejects the entire reconstruction when row %i is soft-wrapped',
    (wrappedRow) => {
      const prefix = 'https://example.com/abcd';
      const rows = [
        { text: `  ${prefix}`, isWrapped: false },
        { text: `  ${'efgh'.padEnd(prefix.length, 'x')}`, isWrapped: false },
        { text: '  yz', isWrapped: false },
      ];
      rows[wrappedRow].isWrapped = true;
      const source = buffer(rows);

      for (let row = 1; row <= rows.length; row++) {
        expect(findMultilineWebLink(source, row)).toBeUndefined();
      }
    },
  );

  it('caps reconstruction at 16 rows and 2048 characters', () => {
    const rows = [' https://example.com/'];
    const width = rows[0].length - 1;
    while (rows.length < 17) rows.push(` ${'a'.repeat(width)}`);
    expect(findMultilineWebLink(buffer(rows), 16)).toBeDefined();
    expect(findMultilineWebLink(buffer(rows), 17)).toBeUndefined();

    const first = ` https://example.com/${'a'.repeat(2020)}`;
    expect(
      findMultilineWebLink(
        buffer([first, ` ${'b'.repeat(first.length - 1)}`]),
        1,
      ),
    ).toBeUndefined();
  });

  it('returns no partial URL when adding a fragment crosses 2048 characters', () => {
    const first = ` https://example.com/${'a'.repeat(1000)}`;
    const continuation = ` ${'b'.repeat(first.length - 1)}`;
    const source = buffer([first, continuation, continuation]);

    expect(findMultilineWebLink(source, 1)).toBeUndefined();
    expect(findMultilineWebLink(source, 2)).toBeUndefined();
    expect(findMultilineWebLink(source, 3)).toBeUndefined();
  });
});
