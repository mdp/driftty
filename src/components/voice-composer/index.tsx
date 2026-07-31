import { Component, h } from 'preact';
import { bind } from 'decko';
import {
  composerSubmission,
  type ComposerAction,
  type ComposerSubmission,
} from './actions';
import type {TerminalAction} from '../terminal-actions';
import './voice-composer.scss';

interface Props {
  ctrlArmed: boolean;
  mobile: boolean;
  value: string;
  onChange: (value: string) => void;
  onTerminalAction: (action: TerminalAction) => void;
  onToggleCtrl: () => void;
  onSend: (submission: ComposerSubmission) => void;
  onClose: () => void;
}

interface State {
  copied: boolean;
  pasteMessage: string;
  confirmClear: boolean;
}

export class VoiceComposer extends Component<Props, State> {
  private textarea?: HTMLTextAreaElement;
  private copyReset?: number;

  state: State = {
    copied: false,
    pasteMessage: '',
    confirmClear: false,
  };

  componentDidMount() {
    this.textarea?.focus();
    const end = this.textarea?.value.length ?? 0;
    this.textarea?.setSelectionRange(end, end);
  }

  componentWillUnmount() {
    if (this.copyReset) window.clearTimeout(this.copyReset);
  }

  render(
    {
      ctrlArmed,
      mobile,
      value,
      onChange,
      onTerminalAction,
      onToggleCtrl,
    }: Props,
    {copied, pasteMessage, confirmClear}: State
  ) {
    return (
      <section
        class={`voice-composer ${
          mobile ? 'voice-composer--mobile' : 'voice-composer--desktop'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-composer-title"
      >
        <header class="voice-composer__header">
          <span id="voice-composer-title">Compose</span>
          {value && <span class="voice-composer__saved">Draft saved</span>}
          <button
            type="button"
            class="voice-composer__header-close"
            onClick={this.close}
            aria-label="Close Composer and save draft"
          >
            Close
          </button>
        </header>
        <textarea
          ref={(element) => {
            this.textarea = element ?? undefined;
          }}
          class="voice-composer__input"
          autoFocus
          value={value}
          onInput={(event) =>
            onChange((event.currentTarget as HTMLTextAreaElement).value)
          }
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              this.close();
            }
          }}
          lang="en"
          inputMode="text"
          enterkeyhint="enter"
          autoCapitalize="sentences"
          autoCorrect="on"
          spellcheck
          placeholder="Talk to me"
          aria-label="Compose terminal input"
        />
        <div
          class="voice-composer__supplements"
          aria-label="Terminal and text controls"
        >
          {(['escape', 'tab'] as TerminalAction[]).map((action) => (
            <button
              type="button"
              onPointerDown={preserveTextareaFocus}
              onClick={() => onTerminalAction(action)}
            >
              {action === 'escape' ? 'Esc' : 'Tab'}
            </button>
          ))}
          <button
            type="button"
            aria-label="Insert slash in draft"
            onPointerDown={preserveTextareaFocus}
            onClick={this.insertSlash}
          >
            /
          </button>
          {(['up', 'down'] as TerminalAction[]).map((action) => (
            <button
              type="button"
              aria-label={`Send ${action} to terminal`}
              onPointerDown={preserveTextareaFocus}
              onClick={() => onTerminalAction(action)}
            >
              {action === 'up' ? '↑' : '↓'}
            </button>
          ))}
          <button
            type="button"
            class={ctrlArmed ? 'voice-composer__control--armed' : ''}
            aria-pressed={ctrlArmed}
            onPointerDown={preserveTextareaFocus}
            onClick={onToggleCtrl}
          >
            {ctrlArmed ? 'Ctrl armed' : 'Ctrl'}
          </button>
          <button
            type="button"
            onPointerDown={preserveTextareaFocus}
            onClick={this.paste}
          >
            Paste
          </button>
        </div>
        <span class="voice-composer__message" role="status" aria-live="polite">
          {pasteMessage}
        </span>
        <div class="voice-composer__actions">
          <button
            type="button"
            class="voice-composer__action--clear"
            disabled={!value}
            onClick={this.clear}
          >
            {confirmClear ? 'Confirm clear' : 'Clear'}
          </button>
          <button
            type="button"
            disabled={!value}
            onClick={() => this.send('insert')}
          >
            Insert
          </button>
          <button
            type="button"
            class="voice-composer__action--send"
            onClick={() => this.send('insert-return')}
          >
            Send
          </button>
          <button
            type="button"
            class="voice-composer__action--copy"
            onClick={this.copy}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </section>
    );
  }

  private send(action: ComposerAction) {
    const { value, onSend } = this.props;
    if (!value && action === 'insert') return;
    this.textarea?.blur();
    onSend(composerSubmission(value, action));
  }

  private close = () => {
    this.textarea?.blur();
    this.props.onClose();
  };

  @bind
  private insertSlash() {
    const textarea = this.textarea;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value =
      this.props.value.slice(0, start) + '/' + this.props.value.slice(end);
    this.props.onChange(value);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + 1, start + 1);
    });
  }

  @bind
  private async paste() {
    try {
      const text = await navigator.clipboard.readText();
      const textarea = this.textarea;
      const start = textarea?.selectionStart ?? this.props.value.length;
      const end = textarea?.selectionEnd ?? start;
      const value =
        this.props.value.slice(0, start) + text + this.props.value.slice(end);
      this.props.onChange(value);
      this.setState({pasteMessage: ''});
      requestAnimationFrame(() => {
        textarea?.focus();
        textarea?.setSelectionRange(start + text.length, start + text.length);
      });
    } catch {
      this.setState({
        pasteMessage: 'Use the standard long-press Paste menu.',
      });
      this.textarea?.focus();
    }
  }

  @bind
  private clear() {
    if (!this.props.value) return;
    if (!this.state.confirmClear) {
      this.setState({confirmClear: true});
      return;
    }
    this.props.onChange('');
    this.setState({confirmClear: false, pasteMessage: ''});
    this.textarea?.focus();
  }

  @bind
  private async copy() {
    try {
      await navigator.clipboard.writeText(this.props.value);
      this.setState({ copied: true });
      this.copyReset = window.setTimeout(
        () => this.setState({ copied: false }),
        1200,
      );
    } catch {
      this.textarea?.select();
      document.execCommand('copy');
      this.setState({ copied: true });
    }
    this.textarea?.focus();
  }
}

function preserveTextareaFocus(event: PointerEvent) {
  event.preventDefault();
}
