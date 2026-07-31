import {describe, expect, it, vi} from 'vitest';
import {mobileMenuFocusTarget, TerminalMenu} from '.';

function control() {
  return {focus: vi.fn()} as unknown as HTMLElement;
}

function menu(mobile: boolean) {
  return new TerminalMenu({
    autoReconnect: true,
    connectionState: 'connected',
    mobile,
    onClose: vi.fn(),
    onOpenComposer: vi.fn(),
    onOpenKeyboard: vi.fn(),
    onReconnect: vi.fn(),
    onToggleAutoReconnect: vi.fn(),
  });
}

describe('mobile menu focus containment', () => {
  it('wraps Tab from the last control to the first', () => {
    const first = control();
    const last = control();

    expect(mobileMenuFocusTarget([first, last], last, false)).toBe(first);
  });

  it('wraps Shift+Tab from the first control to the last', () => {
    const first = control();
    const last = control();

    expect(mobileMenuFocusTarget([first, last], first, true)).toBe(last);
  });

  it('pulls focus back from outside the modal in either direction', () => {
    const first = control();
    const last = control();
    const outside = control();

    expect(mobileMenuFocusTarget([first, last], outside, false)).toBe(first);
    expect(mobileMenuFocusTarget([first, last], outside, true)).toBe(last);
  });

  it('does not trap Tab for the desktop popover', () => {
    const terminalMenu = menu(false);
    const preventDefault = vi.fn();

    (
      terminalMenu as unknown as {
        handleKeyDown: (event: Partial<KeyboardEvent>) => void;
      }
    ).handleKeyDown({key: 'Tab', preventDefault});

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('prevents mobile Tab from escaping and moves focus', () => {
    const first = control();
    const last = control();
    const terminalMenu = menu(true);
    const preventDefault = vi.fn();
    vi.stubGlobal('document', {activeElement: last});
    (
      terminalMenu as unknown as {
        menu: {querySelectorAll: () => HTMLElement[]};
      }
    ).menu = {querySelectorAll: () => [first, last]};

    (
      terminalMenu as unknown as {
        handleKeyDown: (event: Partial<KeyboardEvent>) => void;
      }
    ).handleKeyDown({key: 'Tab', shiftKey: false, preventDefault});

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(first.focus).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
