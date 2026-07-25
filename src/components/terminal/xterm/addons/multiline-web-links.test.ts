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

  it('requires aligned continuation margins', () => {
    expect(
      findMultilineWebLink(
        buffer([
          '  https://example.com/abcd',
          '   efgh',
        ]),
        1,
      ),
    ).toBeUndefined();
  });

  it('does not cross unrelated intervening content', () => {
    expect(
      findMultilineWebLink(
        buffer([
          '  https://example.com/abcd',
          'unrelated',
          '  efgh',
        ]),
        3,
      ),
    ).toBeUndefined();
  });

  it('rejects unsupported protocols and invalid reconstructed URLs', () => {
    expect(
      findMultilineWebLink(
        buffer(['  ftp://example.com/abcd', '  efgh']),
        1,
      ),
    ).toBeUndefined();
    expect(
      findMultilineWebLink(
        buffer(['  https://exa mple.com', '  continuation']),
        1,
      ),
    ).toBeUndefined();
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
});
