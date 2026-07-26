import {Component, h} from 'preact';
import {clampFontSize} from '../../font-size';
import {Xterm} from '../terminal/xterm';
import {
  agentKeys,
  applyInputModifier,
  controlKeys,
  type InputModifier,
  letterRows,
  navigationKeys,
  sequences,
  symbolRows,
  tmuxKeys,
  tmuxScrollKeys,
  type ToolbarKey,
} from './keys';
import './keyboard-overlay.scss';

interface Props {
  terminal: Xterm;
  show: boolean;
  onToggle: () => void;
  onHeightChange: (height: number) => void;
}

type Section = 'agent' | 'nav' | 'ctrl' | 'tmux' | 'tmux-scroll';
type KeyboardLayer = 'letters' | 'symbols';

interface State {
  fontSize: number;
  modifier?: InputModifier;
  section: Section;
  autoReconnect: boolean;
  layer: KeyboardLayer;
}

export class KeyboardOverlay extends Component<Props, State> {
  private resizeObserver?: ResizeObserver;
  private handledTouchPress = false;

  constructor(props: Props) {
    super(props);
    const terminal = props.terminal?.getTerminal();
    this.state = {
      fontSize: terminal?.options?.fontSize || 13,
      section: 'agent',
      autoReconnect: props.terminal.isAutoReconnectEnabled(),
      layer: 'letters',
    };
  }

  componentDidMount() {
    this.props.terminal.onInputModifierChange((modifier) =>
      this.setState({modifier})
    );
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
    const {modifier} = this.state;
    this.sendKey(modifier ? applyInputModifier(value, modifier) : value);
    if (modifier) this.props.terminal.clearInputModifier();
  };

  private sendToolbarKey = ({sequence}: ToolbarKey) => {
    this.sendKey(sequence);
  };

  private armModifier = (modifier: InputModifier) => {
    this.props.terminal.armInputModifier(modifier);
  };

  private toggleModifier = (modifier: InputModifier) => {
    if (this.state.modifier === modifier) {
      this.props.terminal.clearInputModifier();
    } else {
      this.props.terminal.armInputModifier(modifier);
    }
  };

  private enterTmuxScroll = () => {
    this.sendKey(sequences.tmuxScroll);
    this.setState({section: 'tmux-scroll'});
  };

  private exitTmuxScroll = () => {
    this.sendKey(sequences.tmuxScrollExit);
    this.setState({section: 'tmux'});
  };

  private adjustFontSize = (delta: number) => {
    const term = this.props.terminal?.getTerminal();
    if (!term) return;

    const newSize = clampFontSize((term.options.fontSize || 13) + delta);
    term.options.fontSize = newSize;
    this.setState({fontSize: newSize});
    this.props.terminal.fit();

    try {
      localStorage.setItem('ttyd-font-size', newSize.toString());
    } catch {
      // Storage can be disabled in privacy-focused browsers.
    }
  };

  private toggleAutoReconnect = () => {
    const autoReconnect = !this.state.autoReconnect;
    this.props.terminal.setAutoReconnect(autoReconnect);
    this.setState({autoReconnect});
  };

  private renderKey = (key: ToolbarKey) => (
    <button
      key={key.label}
      class={`keyboard-overlay__button ${
        key.emphasis
          ? `keyboard-overlay__button--${key.emphasis}`
          : ''
      }`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => this.sendToolbarKey(key)}
      title={key.title}
      aria-label={key.title}
    >
      {key.label}
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
            {row.map(({label, value}) =>
              this.renderTypingKey(
                shifted ? label.toUpperCase() : label,
                value
              )
            )}
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
    const {modifier, section} = this.state;

    if (section === 'tmux-scroll') {
      return (
        <>
          <div class="keyboard-overlay__mode-label">TMUX SCROLL</div>
          <div class="keyboard-overlay__buttons">
            {tmuxScrollKeys.map(this.renderKey)}
            <button
              class="keyboard-overlay__button keyboard-overlay__button--danger"
              onClick={this.exitTmuxScroll}
            >
              Exit
            </button>
          </div>
        </>
      );
    }

    if (section === 'ctrl') {
      return (
        <div class="keyboard-overlay__buttons keyboard-overlay__buttons--ctrl">
          <button
            class={`keyboard-overlay__button keyboard-overlay__button--accent ${
              modifier === 'ctrl' ? 'keyboard-overlay__button--latched' : ''
            }`}
            onClick={() => this.armModifier('ctrl')}
            title="Apply Ctrl to the next native-keyboard character"
            aria-label="Apply Ctrl to the next native-keyboard character"
          >
            CTRL
          </button>
          <button
            class={`keyboard-overlay__button keyboard-overlay__button--accent ${
              modifier === 'shift' ? 'keyboard-overlay__button--latched' : ''
            }`}
            onClick={() => this.armModifier('shift')}
            title="Apply Shift to the next native-keyboard character"
            aria-label="Apply Shift to the next native-keyboard character"
          >
            SHIFT
          </button>
          {controlKeys.map(this.renderKey)}
        </div>
      );
    }

    const keys =
      section === 'nav' ? navigationKeys : section === 'tmux' ? tmuxKeys : agentKeys;
    return (
      <div class="keyboard-overlay__buttons">
        {keys.map(this.renderKey)}
        {section === 'agent' || section === 'tmux' ? (
          <button
            class="keyboard-overlay__button keyboard-overlay__button--accent"
            onClick={this.enterTmuxScroll}
            title="Enter tmux copy mode and show scroll controls"
          >
            Scroll
          </button>
        ) : null}
      </div>
    );
  }

  render() {
    if (!this.props.show) return null;

    const sections: Array<{id: Exclude<Section, 'tmux-scroll'>; label: string}> =
      [
        {id: 'agent', label: 'Agent'},
        {id: 'nav', label: 'Nav'},
        {id: 'ctrl', label: 'Ctrl'},
        {id: 'tmux', label: 'tmux'},
      ];

    return (
      <div
        ref={this.setOverlayElement}
        class="keyboard-overlay"
        onPointerDown={(event) => event.preventDefault()}
      >
        <div class="keyboard-overlay__status">
          <span class="keyboard-overlay__signal" aria-hidden="true" />
          <span>TTYD//REMOTE</span>
          <span class="keyboard-overlay__status-section">
            {this.state.section.replace('-', '_')}
          </span>
          <label class="keyboard-overlay__setting">
            <input
              type="checkbox"
              checked={this.state.autoReconnect}
              onChange={this.toggleAutoReconnect}
            />
            Auto reconnect
          </label>
        </div>
        <div class="keyboard-overlay__rail">
          {sections.map(({id, label}) => (
            <button
              key={id}
              class={`keyboard-overlay__tab ${
                this.state.section === id ? 'keyboard-overlay__tab--active' : ''
              }`}
              onClick={() => this.setState({section: id})}
            >
              {label}
            </button>
          ))}
          <button
            class="keyboard-overlay__tab"
            onClick={() => this.adjustFontSize(-1)}
            title="Decrease font size"
          >
            A−
          </button>
          <button
            class="keyboard-overlay__tab"
            onClick={() => this.adjustFontSize(1)}
            title="Increase font size"
          >
            A+
          </button>
          <button
            class="keyboard-overlay__tab"
            onClick={this.props.onToggle}
            title="Close keyboard"
            aria-label="Close keyboard"
          >
            ⌄
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
