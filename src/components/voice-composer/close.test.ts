import {describe, expect, it, vi} from 'vitest';
import {VoiceComposer} from '.';

describe('composer close', () => {
  it('blurs the textarea before asking the terminal to close composer', () => {
    const events: string[] = [];
    const composer = new VoiceComposer({
      ctrlArmed: false,
      mobile: true,
      value: '',
      onChange: vi.fn(),
      onTerminalAction: vi.fn(),
      onToggleCtrl: vi.fn(),
      onSend: vi.fn(),
      onClose: () => events.push('close'),
    });
    (
      composer as unknown as {
        textarea: {blur: () => void};
        close: () => void;
      }
    ).textarea = {blur: () => events.push('blur')};

    (
      composer as unknown as {close: () => void}
    ).close();

    expect(events).toEqual(['blur', 'close']);
  });
});
