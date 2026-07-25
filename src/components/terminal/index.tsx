import { bind } from 'decko';
import { Component, h } from 'preact';
import { Xterm, XtermOptions } from './xterm';
import { KeyboardOverlay } from '../keyboard-overlay';
import { VoiceComposer } from '../voice-composer';
import {measureVisualViewport} from '../../visual-viewport';

import '@xterm/xterm/css/xterm.css';

interface Props extends XtermOptions {
  id: string;
}

interface State {
  showKeyboard: boolean;
  softwareKeyboardOpen: boolean;
  viewportHeight: number;
  viewportOffsetTop: number;
  showComposer: boolean;
  composerValue: string;
  reconnectRequired: boolean;
}

export class Terminal extends Component<Props, State> {
  private container: HTMLElement;
  private xterm: Xterm;
  private layoutHeight = window.innerHeight;
  private layoutWidth = window.innerWidth;

  constructor(props: Props) {
    super();
    this.xterm = new Xterm(props);
    this.state = {
      showKeyboard: false,
      softwareKeyboardOpen: false,
      viewportHeight: window.visualViewport?.height ?? window.innerHeight,
      viewportOffsetTop: window.visualViewport?.offsetTop ?? 0,
      showComposer: false,
      composerValue: '',
      reconnectRequired: false,
    };
  }

  public getTerminal() {
    return this.xterm;
  }

  async componentDidMount() {
    this.xterm.onReconnectRequired((reconnectRequired) =>
      this.setState({reconnectRequired})
    );
    await this.xterm.refreshToken();
    this.xterm.open(this.container);
    this.xterm.connect();
    window.visualViewport?.addEventListener(
      'resize',
      this.handleViewportChange
    );
    window.visualViewport?.addEventListener(
      'scroll',
      this.handleViewportChange
    );
    window.addEventListener('resize', this.handleViewportChange);
    this.handleViewportChange();
  }

  componentWillUnmount() {
    window.visualViewport?.removeEventListener(
      'resize',
      this.handleViewportChange
    );
    window.visualViewport?.removeEventListener(
      'scroll',
      this.handleViewportChange
    );
    window.removeEventListener('resize', this.handleViewportChange);
    this.xterm.onReconnectRequired();
    this.xterm.dispose();
  }

  render(
    {id}: Props,
    {
      showKeyboard,
      softwareKeyboardOpen,
      viewportHeight,
      viewportOffsetTop,
      showComposer,
      composerValue,
      reconnectRequired,
    }: State
  ) {
    return (
      <div
        class="terminal-shell"
        style={{
          height: `${viewportHeight}px`,
          transform: `translateY(${viewportOffsetTop}px)`,
        }}
      >
        <div
          id={id}
          ref={(c) => {
            this.container = c as HTMLElement;
          }}
        />
        <KeyboardOverlay
          terminal={this.xterm}
          show={showKeyboard && !showComposer}
          onToggle={this.toggleKeyboard}
        />
        {reconnectRequired && (
          <button
            class="reconnect-button"
            onClick={() => this.xterm.reconnectNow()}
          >
            Reconnect
          </button>
        )}
        {showComposer && (
          <VoiceComposer
            value={composerValue}
            onChange={this.updateComposer}
            onSend={this.sendComposer}
            onClose={this.closeComposer}
          />
        )}
        <button
          class={`voice-composer-toggle ${
            softwareKeyboardOpen && !showComposer
              ? 'voice-composer-toggle--visible'
              : ''
          }`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={this.openComposer}
          title="Open voice input"
          aria-label="Open voice input"
          aria-hidden={!softwareKeyboardOpen || showComposer}
          tabIndex={softwareKeyboardOpen && !showComposer ? 0 : -1}
        >
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12h-2Z"
            />
          </svg>
        </button>
        <button
          class={`keyboard-toggle ${
            showKeyboard ? 'keyboard-toggle--active' : ''
          } ${
            softwareKeyboardOpen ? 'keyboard-toggle--software-open' : ''
          }`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={this.toggleKeyboard}
          title="Toggle keyboard overlay"
          aria-label="Toggle terminal controls"
        >
          <span class="keyboard-toggle__signal" aria-hidden="true" />
          <span class="keyboard-toggle__prompt" aria-hidden="true">
            &gt;_
          </span>
        </button>
      </div>
    );
  }

  @bind
  toggleKeyboard() {
    this.setState((prevState) => ({ showKeyboard: !prevState.showKeyboard }));
  }

  @bind
  openComposer() {
    this.setState({ showComposer: true, showKeyboard: false });
  }

  @bind
  closeComposer() {
    this.setState({ showComposer: false }, () => this.xterm.focus());
  }

  @bind
  updateComposer(value: string) {
    this.setState({ composerValue: value });
  }

  @bind
  sendComposer(payloads: string[]) {
    for (const payload of payloads) {
      this.xterm.sendData(payload);
    }
    this.setState(
      { showComposer: false, composerValue: '' },
      () => this.xterm.focus(),
    );
  }

  private handleViewportChange = () => {
    const viewport = window.visualViewport;
    const currentWidth = window.innerWidth;

    if (Math.abs(currentWidth - this.layoutWidth) > 50) {
      this.layoutWidth = currentWidth;
      this.layoutHeight = window.innerHeight;
    }

    if (!viewport) {
      this.setState(
        {
          viewportHeight: window.innerHeight,
          viewportOffsetTop: 0,
          softwareKeyboardOpen: false,
        },
        () => this.xterm.fit()
      );
      return;
    }

    if (viewport.height > this.layoutHeight) {
      this.layoutHeight = viewport.height;
    }

    const measurement = measureVisualViewport(
      this.layoutHeight,
      viewport.height,
      viewport.offsetTop,
      viewport.scale
    );
    const keyboardJustOpened =
      measurement.keyboardOpen && !this.state.softwareKeyboardOpen;

    this.setState(
      {
        viewportHeight: measurement.height,
        viewportOffsetTop: measurement.offsetTop,
        softwareKeyboardOpen: measurement.keyboardOpen,
        showKeyboard: keyboardJustOpened ? false : this.state.showKeyboard,
      },
      () => {
        requestAnimationFrame(() => {
          this.xterm.fit();
          if (keyboardJustOpened) this.xterm.scrollToBottom();
        });
      }
    );
  };
}
