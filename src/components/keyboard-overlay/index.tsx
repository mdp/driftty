import {Component, h} from 'preact';
import {Xterm} from '../terminal/xterm';
import {
  applyInputModifier,
  type InputModifier,
  letterRows,
  sequences,
  symbolRows,
} from './keys';
import {
  quickbarControls,
  quickbarControlSequence,
  scrollControls,
  type QuickbarControl,
} from '../terminal-quickbar/controls';
import {
  keyboardQuickbarModes,
  loadQuickbarMode,
  saveQuickbarMode,
  type QuickbarMode,
} from '../terminal-quickbar/mode';
import './keyboard-overlay.scss';

interface Props {
  terminal: Xterm;
  show: boolean;
  onToggle: () => void;
  onHeightChange: (height: number) => void;
}

type KeyboardLayer = 'letters' | 'symbols';

interface State {
  modifier?: InputModifier;
  mode: QuickbarMode;
  scrollControls: boolean;
  layer: KeyboardLayer;
}

export class KeyboardOverlay extends Component<Props, State> {
  private resizeObserver?: ResizeObserver;
  private handledTouchPress = false;
  private activeModifier?: InputModifier;

  constructor(props: Props) {
    super(props);
    this.state = {
      mode: this.loadMode(),
      scrollControls: false,
      layer: 'letters',
    };
  }

  componentDidMount() {
    this.props.terminal.onInputModifierChange((modifier) => {
      // Keep an immediate copy for rapid key presses. Preact state updates can
      // land after the next pointer event (notably Shift followed by Enter).
      this.activeModifier = modifier;
      this.setState({modifier});
    });
  }

  componentWillUnmount() {
    this.resizeObserver?.disconnect();
    this.props.onHeightChange(0);
    this.props.terminal.onInputModifierChange();
  }

  private setOverlayElement = (element: HTMLDivElement | null) => {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;

    if (!element) {
      this.props.onHeightChange(0);
      return;
    }

    const reportHeight = () =>
      this.props.onHeightChange(Math.ceil(element.getBoundingClientRect().height));
    reportHeight();
    this.resizeObserver = new ResizeObserver(reportHeight);
    this.resizeObserver.observe(element);
  };

  private sendKey = (sequence: string) => {
    this.props.terminal.sendData(sequence);
  };

  private typeCharacter = (value: string) => {
    const modifier = this.activeModifier;
    this.sendKey(modifier ? applyInputModifier(value, modifier) : value);
    if (modifier) this.props.terminal.clearInputModifier();
  };

  private toggleModifier = (modifier: InputModifier) => {
    if (this.activeModifier === modifier) {
      this.props.terminal.clearInputModifier();
    } else {
      this.props.terminal.armInputModifier(modifier);
    }
  };

  private loadMode(): QuickbarMode {
    const mode = loadQuickbarMode(window.sessionStorage);
    return keyboardQuickbarModes.includes(mode) ? mode : 'agent';
  }

  private selectMode = (mode: QuickbarMode) => {
    saveQuickbarMode(window.sessionStorage, mode);
    this.setState({mode, scrollControls: false});
  };

  private sendQuickbarControl = (control: QuickbarControl) => {
    this.sendKey(quickbarControlSequence(control));
    if ('action' in control) {
      if (control.action === 'tmux-scroll') {
        this.setState({scrollControls: true});
      } else if (
        control.action === 'tmux-scroll-exit' ||
        control.action === 'escape'
      ) {
        this.setState({scrollControls: false});
      }
    }
  };

  private renderQuickbarControl = (control: QuickbarControl) => (
    <button
      key={control.label}
      class={`keyboard-overlay__button ${
        control.danger ? 'keyboard-overlay__button--danger' : ''
      }`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => this.sendQuickbarControl(control)}
      aria-label={`Send ${control.label} to terminal`}
    >
      {control.label}
    </button>
  );

  private renderTypingKey = (
    label: string,
    value: string,
    className = ''
  ) => (
    <button
      key={`${label}-${value}`}
      class={`keyboard-overlay__key ${className}`}
      onPointerDown={(event) => {
        if (event.pointerType !== 'touch') return;
        this.handledTouchPress = true;
        this.typeCharacter(value);
      }}
      onClick={() => {
        if (this.handledTouchPress) {
          this.handledTouchPress = false;
          return;
        }
        this.typeCharacter(value);
      }}
      aria-label={label}
    >
      {label}
    </button>
  );

  private renderKeyboard() {
    const {layer, modifier} = this.state;
    const rows = layer === 'letters' ? letterRows : symbolRows;
    const shifted = modifier === 'shift';

    return (
      <div class="keyboard-overlay__typing-keys">
        {rows.map((row, rowIndex) => (
          <div
            class={`keyboard-overlay__key-row keyboard-overlay__key-row--${rowIndex}`}
            key={`${layer}-${rowIndex}`}
          >
            {layer === 'letters' && rowIndex === 2 ? (
              <button
                class={`keyboard-overlay__key keyboard-overlay__key--modifier keyboard-overlay__key--icon keyboard-overlay__key--edge ${
                  modifier === 'shift' ? 'keyboard-overlay__key--latched' : ''
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => this.toggleModifier('shift')}
                aria-label="Shift"
                aria-pressed={modifier === 'shift'}
              >
                ⇧
              </button>
            ) : null}
            {row.map(({label, value, shiftedValue}) => {
              const displayedValue = shifted
                ? (shiftedValue ?? label.toUpperCase())
                : label;
              const inputValue = shifted ? (shiftedValue ?? value) : value;
              return this.renderTypingKey(displayedValue, inputValue);
            })}
            {layer === 'letters' && rowIndex === 2
              ? this.renderTypingKey(
                  '⌫',
                  '\x7f',
                  'keyboard-overlay__key--icon keyboard-overlay__key--edge'
                )
              : null}
          </div>
        ))}
        <div class="keyboard-overlay__key-row keyboard-overlay__key-row--actions">
          <button
            class={`keyboard-overlay__key keyboard-overlay__key--modifier ${
              modifier === 'ctrl' ? 'keyboard-overlay__key--latched' : ''
            }`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => this.toggleModifier('ctrl')}
            aria-pressed={modifier === 'ctrl'}
          >
            Ctrl
          </button>
          {layer === 'symbols' ? (
            <button
              class={`keyboard-overlay__key keyboard-overlay__key--modifier keyboard-overlay__key--icon ${
                modifier === 'shift' ? 'keyboard-overlay__key--latched' : ''
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => this.toggleModifier('shift')}
              aria-label="Shift"
              aria-pressed={modifier === 'shift'}
            >
              ⇧
            </button>
          ) : null}
          <button
            class={`keyboard-overlay__key keyboard-overlay__key--modifier ${
              layer === 'symbols' ? 'keyboard-overlay__key--latched' : ''
            }`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              this.setState({
                layer: layer === 'letters' ? 'symbols' : 'letters',
              })
            }
          >
            {layer === 'letters' ? '#+=' : 'ABC'}
          </button>
          {this.renderTypingKey('Tab', sequences.tab, 'keyboard-overlay__key--wide')}
          {this.renderTypingKey('/', '/', 'keyboard-overlay__key--shell')}
          {this.renderTypingKey(
            'space',
            ' ',
            'keyboard-overlay__key--space'
          )}
          {layer === 'symbols'
            ? this.renderTypingKey(
                '⌫',
                '\x7f',
                'keyboard-overlay__key--wide keyboard-overlay__key--icon'
              )
            : null}
          {this.renderTypingKey(
            shifted ? '⇧↵' : '↵',
            '\r',
            'keyboard-overlay__key--enter'
          )}
        </div>
      </div>
    );
  }

  private renderSection() {
    const controls = this.state.scrollControls
      ? scrollControls
      : quickbarControls[this.state.mode];
    return (
      <div class="keyboard-overlay__buttons">
        {this.renderQuickbarControl({
          label: 'Esc',
          action: 'escape',
          danger: true,
        })}
        {controls.map(this.renderQuickbarControl)}
      </div>
    );
  }

  render() {
    if (!this.props.show) return null;

    return (
      <div
        ref={this.setOverlayElement}
        class="keyboard-overlay"
        onPointerDown={(event) => event.preventDefault()}
      >
        <div class="keyboard-overlay__status">
          <span>Full keyboard</span>
          <span class="keyboard-overlay__status-section">
            {this.state.scrollControls ? 'tmux scroll' : this.state.mode}
          </span>
        </div>
        <div class="keyboard-overlay__rail">
          {keyboardQuickbarModes.map((mode) => (
            <button
              key={mode}
              class={`keyboard-overlay__tab ${
                !this.state.scrollControls && this.state.mode === mode
                  ? 'keyboard-overlay__tab--active'
                  : ''
              }`}
              onClick={() => this.selectMode(mode)}
            >
              {mode === 'nav'
                ? 'Nav'
                : mode === 'tmux'
                  ? 'tmux'
                  : mode === 'ctrl'
                    ? 'Ctrl'
                    : 'Agent'}
            </button>
          ))}
          <button
            class="keyboard-overlay__tab keyboard-overlay__tab--close"
            onClick={this.props.onToggle}
            title="Close keyboard"
            aria-label="Close keyboard"
          >
            Close
          </button>
        </div>
        <div class="keyboard-overlay__keyboard">
          <div class="keyboard-overlay__special-keys">
            {this.renderSection()}
          </div>
          {this.renderKeyboard()}
        </div>
      </div>
    );
  }
}
