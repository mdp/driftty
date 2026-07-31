import {describe, expect, it} from 'vitest';
import {compile} from 'sass';
// This project intentionally has no Node runtime types in its browser build.
// @ts-expect-error Vitest runs this regression test in Node.
import {fileURLToPath} from 'node:url';

const quickbarCss = compile(
  fileURLToPath(new URL('./terminal-quickbar.scss', import.meta.url))
).css;

function declaration(selector: string, property: string): string {
  const block = quickbarCss.match(
    new RegExp(`${selector} \\{([^}]*)\\}`)
  )?.[1];
  const value = block?.match(new RegExp(`${property}:\\s*([^;]+)`))?.[1];
  if (!value) throw new Error(`Missing ${property} in ${selector}`);
  return value.trim();
}

function pixels(selector: string, property: string): number {
  const value = declaration(selector, property);
  if (!value.endsWith('px')) throw new Error(`${value} is not a pixel value`);
  return Number.parseFloat(value);
}

describe('Quickbar mobile layout', () => {
  it('keeps every Agent action visible beside fixed controls on iPhone 16', () => {
    const key = pixels('.terminal-quickbar__key', 'width');
    const compose = pixels(
      '.terminal-quickbar__key--compose',
      'width'
    );
    const agentActions = key * 6 + 5;
    const fixedActions = key + compose + 1 + 6;
    const innerIPhone16Width = 393 - 6;

    expect(declaration('.terminal-quickbar__key', 'box-sizing')).toBe(
      'border-box'
    );
    expect(
      declaration('.terminal-quickbar__fixed-actions', 'position')
    ).not.toBe('absolute');
    expect(agentActions + fixedActions).toBeLessThanOrEqual(
      innerIPhone16Width
    );
  });
});
