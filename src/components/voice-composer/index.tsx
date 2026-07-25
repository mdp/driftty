import { Component, h } from 'preact';
import { bind } from 'decko';
import { composerPayload, type ComposerAction } from './actions';
import './voice-composer.scss';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: (value: string) => void;
  onClose: () => void;
}

interface State {
  copied: boolean;
}

export class VoiceComposer extends Component<Props, State> {
  private textarea?: HTMLTextAreaElement;
  private copyReset?: number;

  state: State = { copied: false };

  componentDidMount() {
    requestAnimationFrame(() => {
      this.textarea?.focus();
      const end = this.textarea?.value.length ?? 0;
      this.textarea?.setSelectionRange(end, end);
    });
  }

  componentWillUnmount() {
    if (this.copyReset) window.clearTimeout(this.copyReset);
  }

  render({ value, onChange, onClose }: Props, { copied }: State) {
    return (
      <section
        class="voice-composer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-composer-title"
      >
        <header class="voice-composer__header">
          <span class="voice-composer__signal" aria-hidden="true" />
          <span id="voice-composer-title">VOICE INPUT</span>
          <span class="voice-composer__native">iOS DICTATION READY</span>
        </header>
        <textarea
          ref={(element) => {
            this.textarea = element ?? undefined;
          }}
          class="voice-composer__input"
          value={value}
          onInput={(event) =>
            onChange((event.currentTarget as HTMLTextAreaElement).value)
          }
          lang="en"
          inputMode="text"
          enterkeyhint="enter"
          autoCapitalize="sentences"
          autoCorrect="on"
          spellcheck
          placeholder="Tap the microphone on the iOS keyboard and speak…"
          aria-label="Dictated terminal input"
        />
        <div class="voice-composer__actions">
          <button type="button" onClick={() => this.send('insert')}>
            INSERT
          </button>
          <button
            type="button"
            class="voice-composer__action--run"
            onClick={() => this.send('insert-return')}
          >
            INSERT ↵
          </button>
          <button type="button" onClick={this.copy}>
            {copied ? 'COPIED' : 'COPY'}
          </button>
          <button
            type="button"
            class="voice-composer__action--close"
            onClick={onClose}
          >
            CLOSE
          </button>
        </div>
      </section>
    );
  }

  private send(action: ComposerAction) {
    const { value, onSend } = this.props;
    if (!value && action === 'insert') return;
    onSend(composerPayload(value, action));
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
