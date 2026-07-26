import { describe, expect, it, vi } from 'vitest';
import { isTouchCapable, setNativeInputDisabled } from './touch-input';

function helperTextarea(overrides: Record<string, unknown> = {}) {
  const attributes = new Map<string, string>();
  const textarea = {
    disabled: false,
    readOnly: false,
    inputMode: 'text',
    tabIndex: 0,
    blur: vi.fn(),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    ...overrides,
  } as unknown as HTMLTextAreaElement;
  return { textarea, attributes };
}

describe('isTouchCapable', () => {
  it('detects one or more reported touch points', () => {
    expect(isTouchCapable({ maxTouchPoints: 1 })).toBe(true);
    expect(isTouchCapable({ maxTouchPoints: 5 })).toBe(true);
  });

  it('treats zero or an absent navigator as non-touch', () => {
    expect(isTouchCapable({ maxTouchPoints: 0 })).toBe(false);
    expect(isTouchCapable()).toBe(false);
  });
});

describe('setNativeInputDisabled', () => {
  it('blurs and disables the xterm helper textarea', () => {
    const { textarea } = helperTextarea();
    setNativeInputDisabled(textarea, true);
    expect(textarea.disabled).toBe(true);
    expect(textarea.readOnly).toBe(true);
    expect(textarea.inputMode).toBe('none');
    expect(textarea.tabIndex).toBe(-1);
    expect(textarea.blur).toHaveBeenCalledOnce();
  });

  it('restores the original native input state', () => {
    const { textarea, attributes } = helperTextarea({
      disabled: true,
      readOnly: false,
      inputMode: 'decimal',
      tabIndex: 4,
    });
    attributes.set('tabindex', '4');
    setNativeInputDisabled(textarea, true);
    setNativeInputDisabled(textarea, false);
    expect(textarea.disabled).toBe(true);
    expect(textarea.readOnly).toBe(false);
    expect(textarea.inputMode).toBe('decimal');
    expect(attributes.get('tabindex')).toBe('4');
  });

  it('restores an absent tabindex attribute', () => {
    const { textarea, attributes } = helperTextarea();
    setNativeInputDisabled(textarea, true);
    setNativeInputDisabled(textarea, false);
    expect(attributes.has('tabindex')).toBe(false);
  });
});
