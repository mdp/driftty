import { bind } from 'decko';
import { Component, h } from 'preact';
import { Xterm, XtermOptions } from './xterm';
import { KeyboardOverlay } from '../keyboard-overlay';
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
    };
  }

  public getTerminal() {
    return this.xterm;
  }

  async componentDidMount() {
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
    this.xterm.dispose();
  }

  render(
    {id}: Props,
    {
      showKeyboard,
      softwareKeyboardOpen,
      viewportHeight,
      viewportOffsetTop,
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
          show={showKeyboard}
          onToggle={this.toggleKeyboard}
        />
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
