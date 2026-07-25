import { h, Component } from 'preact';
import { Xterm } from '../terminal/xterm';
import {clampFontSize} from '../../font-size';
import {terminalKeys} from './keys';
import './keyboard-overlay.scss';

interface Props {
  terminal: Xterm;
  show: boolean;
  onToggle: () => void;
}

interface State {
  fontSize: number;
}

export class KeyboardOverlay extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    const terminal = props.terminal?.getTerminal();
    this.state = {
      fontSize: terminal?.options?.fontSize || 13,
    };
  }

  private sendKey = (sequence: string) => {
    const { terminal } = this.props;
    if (terminal) {
      terminal.sendData(sequence);
    }
  };

  private adjustFontSize = (delta: number) => {
    const { terminal } = this.props;
    const term = terminal?.getTerminal();
    if (term) {
      const currentSize = term.options.fontSize || 13;
      const newSize = clampFontSize(currentSize + delta);
      term.options.fontSize = newSize;
      this.setState({ fontSize: newSize });

      // Store preference in localStorage
      try {
        localStorage.setItem('ttyd-font-size', newSize.toString());
      } catch (e) {
        // Ignore localStorage errors
      }
    }
  };

  render() {
    const { show } = this.props;

    if (!show) {
      return null;
    }

    return (
      <div class="keyboard-overlay">
        <div class="keyboard-overlay__buttons">
          {terminalKeys.map(({label, sequence, title}) => (
            <button
              class="keyboard-overlay__button"
              onClick={() => this.sendKey(sequence)}
              title={title}
              aria-label={title}
            >
              {label}
            </button>
          ))}
          <button
            class="keyboard-overlay__button keyboard-overlay__button--font"
            onClick={() => this.adjustFontSize(-1)}
            title="Decrease font size"
          >
            A-
          </button>
          <button
            class="keyboard-overlay__button keyboard-overlay__button--font"
            onClick={() => this.adjustFontSize(1)}
            title="Increase font size"
          >
            A+
          </button>
        </div>
      </div>
    );
  }
}
