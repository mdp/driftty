import {describe, expect, it} from 'vitest';
import {TerminalUiController, type TerminalUiAction} from './ui-state';

function transition(
  controller: TerminalUiController,
  action: TerminalUiAction,
) {
  return {
    effect: controller.transition(action),
    state: controller.state,
  };
}

const show = (
  surface: 'menu' | 'composer' | 'web-keyboard',
): TerminalUiAction => ({
  type: 'show-surface',
  surface,
  preservePosition: true,
});

describe('TerminalUiController', () => {
  it('captures and restores around direct Composer use', () => {
    const controller = new TerminalUiController();

    expect(transition(controller, show('composer')).effect).toBe(
      'capture-position',
    );
    expect(controller.state.positionCheckpoint).toBe('captured');
    transition(controller, {type: 'return-to-terminal'});
    expect(controller.state.positionCheckpoint).toBe('restore-pending');
    expect(transition(controller, {type: 'layout-settled'}).effect).toBe(
      'restore-position',
    );
    expect(controller.state.positionCheckpoint).toBe('none');
  });

  it.each(['composer', 'web-keyboard'] as const)(
    'retains one checkpoint from Menu to %s',
    (surface) => {
      const controller = new TerminalUiController();

      expect(transition(controller, show('menu')).effect).toBe(
        'capture-position',
      );
      expect(transition(controller, show(surface)).effect).toBe('none');
      expect(controller.state.positionCheckpoint).toBe('captured');
      transition(controller, {type: 'return-to-terminal'});
      expect(transition(controller, {type: 'layout-settled'}).effect).toBe(
        'restore-position',
      );
    },
  );

  it('waits for keyboard dismissal and settled layout before restoring', () => {
    const controller = new TerminalUiController();

    transition(controller, show('composer'));
    transition(controller, {
      type: 'software-keyboard',
      open: true,
      preservePosition: true,
    });
    transition(controller, {type: 'return-to-terminal'});
    expect(transition(controller, {type: 'layout-settled'}).effect).toBe(
      'none',
    );
    transition(controller, {
      type: 'software-keyboard',
      open: false,
      preservePosition: true,
    });
    expect(transition(controller, {type: 'layout-settled'}).effect).toBe(
      'restore-position',
    );
  });

  it('captures and restores exactly once, then clears the checkpoint', () => {
    const controller = new TerminalUiController();
    const effects = [
      transition(controller, show('menu')).effect,
      transition(controller, show('composer')).effect,
      transition(controller, {type: 'return-to-terminal'}).effect,
      transition(controller, {type: 'layout-settled'}).effect,
      transition(controller, {type: 'layout-settled'}).effect,
    ];

    expect(
      effects.filter((effect) => effect === 'capture-position'),
    ).toHaveLength(1);
    expect(
      effects.filter((effect) => effect === 'restore-position'),
    ).toHaveLength(1);
    expect(controller.state.positionCheckpoint).toBe('none');
  });

  it('represents every surface as one mutually exclusive value', () => {
    const controller = new TerminalUiController();

    for (const surface of ['menu', 'composer', 'web-keyboard'] as const) {
      transition(controller, show(surface));
      expect(controller.state.surface).toBe(surface);
    }
    transition(controller, {type: 'return-to-terminal'});
    expect(controller.state.surface).toBe('terminal');
    expect(Object.keys(controller.state)).toEqual([
      'surface',
      'softwareKeyboardOpen',
      'positionCheckpoint',
    ]);
  });
});
