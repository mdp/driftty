import { bind } from 'decko';
import { Component, h } from 'preact';
import { Xterm, XtermOptions } from './xterm';
import { KeyboardOverlay } from '../keyboard-overlay';
import { VoiceComposer } from '../voice-composer';
import {measureVisualViewport} from '../../visual-viewport';
import {isTouchCapable} from '../../touch-input';
import type {ComposerSubmission} from '../voice-composer/actions';

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
  webKeyboardHeight: number;
}

export class Terminal extends Component<Props, State> {
  private container: HTMLElement;
  private xterm: Xterm;
  private layoutHeight = window.innerHeight;
  private layoutWidth = window.innerWidth;
  private readonly touchCapable = isTouchCapable(navigator);

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
      webKeyboardHeight: 0,
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
      webKeyboardHeight,
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
          style={{
            height: `${Math.max(0, viewportHeight - webKeyboardHeight)}px`,
          }}
          ref={(c) => {
            this.container = c as HTMLElement;
          }}
        />
        <KeyboardOverlay
          terminal={this.xterm}
          show={showKeyboard && !showComposer}
          onToggle={this.toggleKeyboard}
          onHeightChange={this.handleWebKeyboardHeight}
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
            this.touchCapable && !showComposer
              ? 'voice-composer-toggle--visible'
              : ''
          }`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={this.openComposer}
          title="Open input and paste composer"
          aria-label="Open input and paste composer"
          aria-hidden={!this.touchCapable || showComposer}
          tabIndex={this.touchCapable && !showComposer ? 0 : -1}
        >
          <span aria-hidden="true">I/P</span>
        </button>
        {!showKeyboard && (
          <button
            class={`keyboard-toggle ${
              softwareKeyboardOpen ? 'keyboard-toggle--software-open' : ''
            }`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={this.toggleKeyboard}
            title="Open web keyboard"
            aria-label="Open web keyboard"
          >
            <span class="keyboard-toggle__signal" aria-hidden="true" />
            <span class="keyboard-toggle__prompt" aria-hidden="true">
              &gt;_
            </span>
          </button>
        )}
      </div>
    );
  }

  @bind
  toggleKeyboard() {
    const showKeyboard = !this.state.showKeyboard;
    this.xterm.setWebKeyboardActive(showKeyboard);
    this.setState({showKeyboard});
  }

  private handleWebKeyboardHeight = (webKeyboardHeight: number) => {
    if (webKeyboardHeight === this.state.webKeyboardHeight) return;
    this.setState({webKeyboardHeight}, () =>
      requestAnimationFrame(() => {
        this.xterm.fit();
        this.xterm.scrollToBottom();
      })
    );
  };

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
  sendComposer({text, enter}: ComposerSubmission) {
    this.xterm.paste(text);
    if (enter) this.xterm.sendData('\r');
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
