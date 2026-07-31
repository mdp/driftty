export type TerminalSurface =
  | 'terminal'
  | 'menu'
  | 'composer'
  | 'web-keyboard';

export type PositionCheckpoint = 'none' | 'captured' | 'restore-pending';

export interface TerminalUiState {
  surface: TerminalSurface;
  softwareKeyboardOpen: boolean;
  positionCheckpoint: PositionCheckpoint;
}

export type TerminalUiEffect =
  | 'none'
  | 'capture-position'
  | 'restore-position';

export type TerminalUiAction =
  | {
      type: 'show-surface';
      surface: Exclude<TerminalSurface, 'terminal'>;
      preservePosition: boolean;
    }
  | {type: 'return-to-terminal'}
  | {
      type: 'software-keyboard';
      open: boolean;
      preservePosition: boolean;
    }
  | {type: 'layout-settled'};

interface TerminalUiTransition {
  state: TerminalUiState;
  effect: TerminalUiEffect;
}

export function initialTerminalUiState(): TerminalUiState {
  return {
    surface: 'terminal',
    softwareKeyboardOpen: false,
    positionCheckpoint: 'none',
  };
}

export class TerminalUiController {
  state = initialTerminalUiState();

  transition(action: TerminalUiAction): TerminalUiEffect {
    const transition = reduceTerminalUi(this.state, action);
    this.state = transition.state;
    return transition.effect;
  }
}

function reduceTerminalUi(
  state: TerminalUiState,
  action: TerminalUiAction,
): TerminalUiTransition {
  if (action.type === 'show-surface') {
    const shouldCapture =
      action.preservePosition &&
      state.surface === 'terminal' &&
      state.positionCheckpoint === 'none';
    return {
      state: {
        ...state,
        surface: action.surface,
        positionCheckpoint: shouldCapture
          ? 'captured'
          : state.positionCheckpoint === 'restore-pending'
            ? 'captured'
            : state.positionCheckpoint,
      },
      effect: shouldCapture ? 'capture-position' : 'none',
    };
  }

  if (action.type === 'return-to-terminal') {
    return {
      state: {
        ...state,
        surface: 'terminal',
        positionCheckpoint:
          state.positionCheckpoint === 'captured'
            ? 'restore-pending'
            : state.positionCheckpoint,
      },
      effect: 'none',
    };
  }

  if (action.type === 'software-keyboard') {
    const shouldCapture =
      action.open &&
      action.preservePosition &&
      state.positionCheckpoint === 'none';
    const surface =
      action.open && state.surface === 'web-keyboard'
        ? 'terminal'
        : state.surface;
    let positionCheckpoint = shouldCapture
      ? 'captured' as const
      : state.positionCheckpoint;
    if (
      !action.open &&
      surface === 'terminal' &&
      positionCheckpoint === 'captured'
    ) {
      positionCheckpoint = 'restore-pending';
    }
    return {
      state: {
        surface,
        softwareKeyboardOpen: action.open,
        positionCheckpoint,
      },
      effect: shouldCapture ? 'capture-position' : 'none',
    };
  }

  if (
    state.surface === 'terminal' &&
    !state.softwareKeyboardOpen &&
    state.positionCheckpoint === 'restore-pending'
  ) {
    return {
      state: {...state, positionCheckpoint: 'none'},
      effect: 'restore-position',
    };
  }

  return {state, effect: 'none'};
}
