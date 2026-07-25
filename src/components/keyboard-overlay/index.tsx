import {Component, h} from 'preact';
import {clampFontSize} from '../../font-size';
import {Xterm} from '../terminal/xterm';
import {
  agentKeys,
  type InputModifier,
  navigationKeys,
  sequences,
  tmuxKeys,
  tmuxScrollKeys,
  type ToolbarKey,
} from './keys';
import './keyboard-overlay.scss';

interface Props {
  terminal: Xterm;
  show: boolean;
  onToggle: () => void;
}

type Section = 'agent' | 'nav' | 'ctrl' | 'tmux' | 'tmux-scroll';

interface State {
  fontSize: number;
  modifier?: InputModifier;
  section: Section;
}

const controlShortcuts: ToolbarKey[] = ['B', 'C', 'D', 'L', 'R', 'U', 'W'].map(
  (letter) => ({
    label: `Ctrl-${letter}`,
    sequence: String.fromCharCode(letter.charCodeAt(0) & 0x1f),
    title: `Send Ctrl-${letter}`,
  })
);

export class KeyboardOverlay extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    const terminal = props.terminal?.getTerminal();
    this.state = {
      fontSize: terminal?.options?.fontSize || 13,
      section: 'agent',
    };
  }

  componentDidMount() {
    this.props.terminal.onInputModifierChange((modifier) =>
      this.setState({modifier})
    );
  }

  componentWillUnmount() {
    this.props.terminal.onInputModifierChange();
  }

  private sendKey = (sequence: string) => {
    this.props.terminal.sendData(sequence);
  };

  private sendToolbarKey = ({sequence}: ToolbarKey) => {
    this.sendKey(sequence);
  };

  private armModifier = (modifier: InputModifier) => {
    this.props.terminal.armInputModifier(modifier);
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
        <div class="keyboard-overlay__buttons">
          <button
            class={`keyboard-overlay__button keyboard-overlay__button--accent ${
              modifier === 'ctrl' ? 'keyboard-overlay__button--latched' : ''
            }`}
            onClick={() => this.armModifier('ctrl')}
            title="Apply Ctrl to the next key typed"
          >
            Ctrl next
          </button>
          <button
            class={`keyboard-overlay__button keyboard-overlay__button--accent ${
              modifier === 'shift' ? 'keyboard-overlay__button--latched' : ''
            }`}
            onClick={() => this.armModifier('shift')}
            title="Apply Shift to the next key typed"
          >
            Shift next
          </button>
          {controlShortcuts.map(this.renderKey)}
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
        class="keyboard-overlay"
        onPointerDown={(event) => event.preventDefault()}
      >
        <div class="keyboard-overlay__status" aria-hidden="true">
          <span class="keyboard-overlay__signal" />
          <span>TTYD//REMOTE</span>
          <span class="keyboard-overlay__status-section">
            {this.state.section.replace('-', '_')}
          </span>
          <span>LINK:UP</span>
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
            title="Close controls"
          >
            ×
          </button>
        </div>
        {this.renderSection()}
      </div>
    );
  }
}
