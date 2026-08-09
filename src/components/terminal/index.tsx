import { bind } from 'decko';
import { Component, h } from 'preact';
import {
  type ConnectionState,
  TouchSelectionState,
  Xterm,
  XtermOptions,
} from './xterm';
import { KeyboardOverlay } from '../keyboard-overlay';
import { VoiceComposer } from '../voice-composer';
import {TerminalMenu} from '../terminal-menu';
import {TerminalQuickbar} from '../terminal-quickbar';
import {
  controlSequence,
  terminalActionSequence,
  type TerminalAction,
} from '../terminal-actions';
import {measureVisualViewport} from '../../visual-viewport';
import type {ComposerSubmission} from '../voice-composer/actions';
import {
  loadComposerDraft,
  saveComposerDraft,
} from '../voice-composer/draft';
import {
  FixedMobileViewport,
  type FixedMobileViewportView,
  type TerminalViewportSize,
} from './fixed-mobile-viewport';
import {
  adjustTouchSelectionBox,
  type TouchSelectionAdjustment,
} from './touch-selection-box';
import {
  TerminalUiController,
  type TerminalUiAction,
  type TerminalUiState,
  type TerminalSurface,
} from './ui-state';
import {clampFontSize, FONT_SIZE_STORAGE_KEY} from '../../font-size';

import '@xterm/xterm/css/xterm.css';

interface Props extends XtermOptions {
  id: string;
}

interface State {
  ui: TerminalUiState;
  viewportHeight: number;
  viewportOffsetTop: number;
  composerValue: string;
  reconnectRequired: boolean;
  exited: boolean;
  connectionState: ConnectionState;
  autoReconnect: boolean;
  webKeyboardHeight: number;
  quickbarHeight: number;
  scrollControls: boolean;
  ctrlArmed: boolean;
  touchSelection: TouchSelectionState;
  fixedViewport: FixedMobileViewportView;
  fontSize: number;
}

export class Terminal extends Component<Props, State> {
  private container: HTMLElement;
  private viewport?: HTMLElement;
  private xterm: Xterm;
  private fixedMobileViewport: FixedMobileViewport;
  private uiController = new TerminalUiController();
  private layoutHeight = window.innerHeight;
  private layoutWidth = window.innerWidth;
  private quickbarLayoutReady = false;
  private readonly mobileViewer: boolean;
  private ctrlTimer?: number;
  private selectionAdjustment?: {
    type: TouchSelectionAdjustment;
    pointerId: number;
    pointerX: number;
    pointerY: number;
    box: NonNullable<TouchSelectionState['box']>;
    bounds: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
  };

  constructor(props: Props) {
    super();
    this.mobileViewer = props.viewer.formFactor === 'mobile';
    this.xterm = new Xterm(props);
    this.fixedMobileViewport = new FixedMobileViewport({
      mobile: this.mobileViewer,
      viewportSize: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      storage: window.localStorage,
      terminal: this.xterm,
      viewport: () => this.viewport,
      onChange: (fixedViewport) => this.setState({fixedViewport}),
    });
    this.state = {
      ui: this.uiController.state,
      viewportHeight: window.visualViewport?.height ?? window.innerHeight,
      viewportOffsetTop: window.visualViewport?.offsetTop ?? 0,
      composerValue: loadComposerDraft(
        window.sessionStorage,
        window.location.pathname
      ),
      reconnectRequired: false,
      exited: false,
      connectionState: 'connecting',
      autoReconnect: this.xterm.isAutoReconnectEnabled(),
      webKeyboardHeight: 0,
      quickbarHeight: 0,
      scrollControls: false,
      ctrlArmed: false,
      touchSelection: {status: 'idle'},
      fixedViewport: this.fixedMobileViewport.view,
      fontSize: props.termOptions.fontSize ?? 13,
    };
  }

  public getTerminal() {
    return this.xterm;
  }

  async componentDidMount() {
    this.xterm.onReconnectRequired((reconnectRequired) =>
      this.setState({reconnectRequired})
    );
    this.xterm.onExit(() => this.setState({exited: true}));
    this.xterm.onConnectionStateChange((connectionState) =>
      this.setState({connectionState})
    );
    this.xterm.onTouchSelection((touchSelection) =>
      this.setState({touchSelection})
    );
    await this.xterm.refreshToken();
    this.xterm.open(this.container);
    this.fixedMobileViewport.start();
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
    this.xterm.onExit();
    this.xterm.onConnectionStateChange();
    this.xterm.onTouchSelection();
    if (this.ctrlTimer) window.clearTimeout(this.ctrlTimer);
    this.xterm.dispose();
  }

  render(
    {id}: Props,
    {
      ui,
      viewportHeight,
      viewportOffsetTop,
      composerValue,
      reconnectRequired,
      exited,
      connectionState,
      autoReconnect,
      webKeyboardHeight,
      quickbarHeight,
      scrollControls,
      ctrlArmed,
      touchSelection,
      fixedViewport,
    }: State
  ) {
    const {size: terminalViewportSize, surface, transform} = fixedViewport;
    const showKeyboard = ui.surface === 'web-keyboard';
    const showComposer = ui.surface === 'composer';
    const showTerminalMenu = ui.surface === 'menu';
    return (
      <div
        class="terminal-shell"
        data-viewer={this.props.viewer.formFactor}
        data-os={this.props.viewer.os}
        style={{
          height: `${viewportHeight}px`,
          transform: `translateY(${viewportOffsetTop}px)`,
        }}
      >
        <span class="terminal-announcement" role="status" aria-live="polite">
          Connection {connectionState}
        </span>
        <span class="terminal-announcement" role="status" aria-live="polite">
          {ctrlArmed ? 'Ctrl armed' : 'Ctrl cancelled'}
        </span>
        <div
          id={id}
          ref={(element) => {
            this.viewport = element ?? undefined;
          }}
          class={terminalViewportSize === 'auto'
            ? 'terminal-viewport'
            : 'terminal-viewport terminal-viewport--fixed'}
          style={{
            height: `${Math.max(
              0,
              viewportHeight - webKeyboardHeight - quickbarHeight
            )}px`,
          }}
          onPointerDownCapture={this.handleFixedViewportPointer}
          onPointerMoveCapture={this.handleFixedViewportPointer}
          onPointerUpCapture={this.handleFixedViewportPointer}
          onPointerCancelCapture={this.handleFixedViewportPointer}
          onMouseDownCapture={this.handleFixedViewportMouseDown}
        >
          <div
            class="terminal-surface"
            style={{
              width: surface
                ? `${surface.width}px`
                : '100%',
              height: surface
                ? `${surface.height}px`
                : '100%',
              transform: terminalViewportSize === 'auto'
                ? undefined
                : `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
            }}
            ref={(c) => {
              this.container = c as HTMLElement;
            }}
          />
        </div>
        <KeyboardOverlay
          terminal={this.xterm}
          show={showKeyboard}
          onToggle={this.toggleKeyboard}
          onHeightChange={this.handleWebKeyboardHeight}
        />
        {touchSelection.box && (
          <div
            class={`terminal-touch-selection ${
              touchSelection.status === 'complete'
                ? 'terminal-touch-selection--complete'
                : ''
            }`}
            style={{
              left: `${touchSelection.box.left}px`,
              top: `${touchSelection.box.top - viewportOffsetTop}px`,
              width: `${touchSelection.box.width}px`,
              height: `${touchSelection.box.height}px`,
            }}
            onPointerDown={(event) =>
              this.beginSelectionAdjustment('move', event)
            }
            onPointerMove={this.moveSelectionAdjustment}
            onPointerUp={this.endSelectionAdjustment}
            onPointerCancel={this.endSelectionAdjustment}
          >
            {touchSelection.status === 'complete' && (
              <>
                <button
                  type="button"
                  class="terminal-selection-handle terminal-selection-handle--top-left"
                  aria-label="Resize selection from top left"
                  onPointerDown={(event) =>
                    this.beginSelectionAdjustment('top-left', event)
                  }
                />
                <button
                  type="button"
                  class="terminal-selection-handle terminal-selection-handle--bottom-right"
                  aria-label="Resize selection from bottom right"
                  onPointerDown={(event) =>
                    this.beginSelectionAdjustment('bottom-right', event)
                  }
                />
              </>
            )}
            {touchSelection.status === 'complete' && (
              <button
                class="terminal-selection-copy"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={this.copySelection}
                disabled={!touchSelection.copyAvailable}
              >
                Copy
              </button>
            )}
          </div>
        )}
        {reconnectRequired && this.mobileViewer && (
          <button
            class="reconnect-button"
            onClick={() => this.xterm.reconnectNow()}
          >
            Reconnect
          </button>
        )}
        {exited && (
          <div
            class="terminal-exited"
            role="dialog"
            aria-modal="true"
            aria-labelledby="terminal-exited-title"
          >
            <div class="terminal-exited__panel">
              <div class="terminal-exited__signal" aria-hidden="true">●</div>
              <h1 id="terminal-exited-title">Exited</h1>
              <p>This shell has ended and will not reconnect.</p>
              <a href="/">All terminals</a>
            </div>
          </div>
        )}
        {showComposer && (
          <VoiceComposer
            ctrlArmed={ctrlArmed}
            mobile={this.mobileViewer}
            value={composerValue}
            onChange={this.updateComposer}
            onTerminalAction={this.sendTerminalAction}
            onToggleCtrl={this.toggleCtrl}
            onSend={this.sendComposer}
            onClose={this.closeComposer}
          />
        )}
        {showTerminalMenu && (
          <TerminalMenu
            autoReconnect={autoReconnect}
            connectionState={connectionState}
            ctrlArmed={ctrlArmed}
            draftAvailable={Boolean(composerValue)}
            mobile={this.mobileViewer}
            onClose={this.closeTerminalMenu}
            onControl={this.sendControl}
            onOpenComposer={this.openComposer}
            onStartCopySelection={this.startCopySelection}
            onOpenKeyboard={this.openKeyboard}
            onReconnect={this.reconnect}
            onResetQuickbar={this.resetQuickbar}
            onTerminalAction={this.sendTerminalAction}
            onToggleCtrl={this.toggleCtrl}
            onToggleAutoReconnect={this.toggleAutoReconnect}
            terminalViewportSize={terminalViewportSize}
            onTerminalViewportSizeChange={this.setTerminalViewportSize}
            fontSize={this.state.fontSize}
            onFontSizeChange={this.setFontSize}
          />
        )}
        {this.mobileViewer &&
          ui.surface === 'terminal' && (
            <TerminalQuickbar
              ctrlArmed={ctrlArmed}
              draftAvailable={Boolean(composerValue)}
              scrollControls={scrollControls}
              onAction={this.sendTerminalAction}
              onControl={this.sendControl}
              onText={this.sendText}
              onHeightChange={this.handleQuickbarHeight}
              onOpenComposer={this.openComposer}
              onOpenKeyboard={this.openKeyboard}
              onOpenMenu={this.openTerminalMenu}
              onStartCopySelection={this.startCopySelection}
              onCopySelection={this.copySelection}
              onCancelCopySelection={this.cancelCopySelection}
              touchSelectionStatus={touchSelection.status}
              copySelectionAvailable={Boolean(
                touchSelection.copyAvailable
              )}
            />
          )}
        {!this.mobileViewer && !showKeyboard && !showComposer && (
          <button
            class="keyboard-toggle"
            onMouseDown={(event) => event.preventDefault()}
            onClick={this.toggleTerminalMenu}
            title="Open terminal menu"
            aria-label="Open terminal menu"
            aria-expanded={showTerminalMenu}
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
    if (this.uiController.state.surface === 'web-keyboard') {
      this.xterm.setWebKeyboardActive(false);
      this.returnToTerminal();
      return;
    }
    this.openKeyboard();
  }

  @bind
  openKeyboard() {
    if (this.uiController.state.surface === 'web-keyboard') return;
    this.xterm.setWebKeyboardActive(true);
    this.clearCtrl();
    this.showSurface('web-keyboard');
  }

  private handleWebKeyboardHeight = (webKeyboardHeight: number) => {
    if (webKeyboardHeight === this.state.webKeyboardHeight) return;
    this.setState({webKeyboardHeight}, () =>
      requestAnimationFrame(() => {
        this.xterm.fit();
        if (webKeyboardHeight > 0) {
          this.xterm.scrollToBottom();
          this.fixedMobileViewport.anchorBottom();
        }
      })
    );
  };

  private copySelection = async () => {
    await this.xterm.copyTouchSelection();
  };

  private startCopySelection = () => {
    this.xterm.armTouchSelection();
  };

  private cancelCopySelection = () => {
    this.xterm.cancelTouchSelection();
  };

  private beginSelectionAdjustment = (
    type: TouchSelectionAdjustment,
    event: PointerEvent,
  ) => {
    const box = this.state.touchSelection.box;
    const bounds = this.xterm.touchSelectionBounds();
    if (
      this.state.touchSelection.status !== 'complete' ||
      !box ||
      !bounds ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.selectionAdjustment = {
      type,
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      box,
      bounds,
    };
  };

  private moveSelectionAdjustment = (event: PointerEvent) => {
    const adjustment = this.selectionAdjustment;
    if (!adjustment || event.pointerId !== adjustment.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    this.xterm.updateTouchSelectionBox(
      adjustTouchSelectionBox(
        adjustment.box,
        adjustment.type,
        event.clientX - adjustment.pointerX,
        event.clientY - adjustment.pointerY,
        adjustment.bounds,
      )
    );
  };

  private endSelectionAdjustment = (event: PointerEvent) => {
    if (
      !this.selectionAdjustment ||
      event.pointerId !== this.selectionAdjustment.pointerId
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== 'pointercancel') {
      this.moveSelectionAdjustment(event);
    }
    this.selectionAdjustment = undefined;
  };

  @bind
  openComposer() {
    this.xterm.setWebKeyboardActive(false);
    this.showSurface('composer');
  }

  @bind
  closeComposer() {
    this.returnToTerminal(() => {
      if (!this.mobileViewer) this.xterm.focus();
    });
  }

  @bind
  updateComposer(value: string) {
    saveComposerDraft(
      window.sessionStorage,
      window.location.pathname,
      value
    );
    this.setState({ composerValue: value });
  }

  @bind
  sendComposer({text, enter}: ComposerSubmission) {
    try {
      this.xterm.paste(text);
      if (enter) this.xterm.sendData('\r');
    } catch {
      return;
    }
    saveComposerDraft(window.sessionStorage, window.location.pathname, '');
    this.clearCtrl();
    this.returnToTerminal(() => {
      this.setState({composerValue: ''});
      if (!this.mobileViewer) this.xterm.focus();
    });
  }

  @bind
  toggleTerminalMenu() {
    if (this.uiController.state.surface === 'menu') {
      this.closeTerminalMenu();
      return;
    }
    this.xterm.setWebKeyboardActive(false);
    this.showSurface('menu');
  }

  @bind
  openTerminalMenu() {
    this.xterm.setWebKeyboardActive(false);
    this.showSurface('menu');
  }

  @bind
  closeTerminalMenu() {
    this.clearCtrl();
    this.returnToTerminal(() => {
      if (!this.mobileViewer) this.xterm.focus();
    });
  }

  @bind
  sendTerminalAction(action: TerminalAction) {
    this.xterm.sendData(
      terminalActionSequence(action, this.state.ctrlArmed)
    );
    const leaveScrollControls =
      action === 'escape' || action === 'tmux-scroll-exit';
    this.clearCtrl();
    this.setState({
      scrollControls:
        action === 'tmux-scroll'
          ? true
          : leaveScrollControls
            ? false
            : this.state.scrollControls,
    });
  }

  @bind
  sendControl(character: string) {
    this.xterm.sendData(controlSequence(character));
    this.clearCtrl();
  }

  private sendText = (text: string) => {
    this.xterm.sendData(text);
    this.clearCtrl();
  };

  @bind
  toggleCtrl() {
    if (this.state.ctrlArmed) {
      this.clearCtrl();
      return;
    }
    this.setState({ctrlArmed: true});
    if (this.ctrlTimer) window.clearTimeout(this.ctrlTimer);
    this.ctrlTimer = window.setTimeout(this.clearCtrl, 10_000);
  }

  @bind
  resetQuickbar() {
    this.clearCtrl();
    this.setState({scrollControls: false});
  }

  private clearCtrl = () => {
    if (this.ctrlTimer) window.clearTimeout(this.ctrlTimer);
    this.ctrlTimer = undefined;
    if (this.state.ctrlArmed) this.setState({ctrlArmed: false});
  };

  private handleQuickbarHeight = (quickbarHeight: number) => {
    if (quickbarHeight === this.state.quickbarHeight) return;
    if (quickbarHeight === 0) this.quickbarLayoutReady = false;
    this.setState({quickbarHeight}, () =>
      requestAnimationFrame(() => {
        this.xterm.fit();
        if (this.uiController.state.positionCheckpoint === 'none') {
          this.xterm.scrollToBottom();
          this.fixedMobileViewport.anchorBottom();
        }
        if (quickbarHeight > 0) {
          this.quickbarLayoutReady = true;
          this.settleTerminalLayout();
        }
      })
    );
  };

  @bind
  toggleAutoReconnect() {
    const autoReconnect = !this.state.autoReconnect;
    this.xterm.setAutoReconnect(autoReconnect);
    this.setState({autoReconnect});
  }

  @bind
  reconnect() {
    this.xterm.reconnectNow();
  }

  @bind
  setTerminalViewportSize(terminalViewportSize: TerminalViewportSize) {
    this.fixedMobileViewport.select(terminalViewportSize);
  }

  @bind
  setFontSize(size: number) {
    const fontSize = clampFontSize(size);
    this.xterm.setFontSize(fontSize);
    this.fixedMobileViewport.select(this.state.fixedViewport.size);
    this.setState({fontSize});
    try {
      localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSize));
    } catch {
      // Storage can be disabled in privacy-focused browsers.
    }
  }

  private handleFixedViewportPointer = (event: PointerEvent) => {
    this.fixedMobileViewport.handlePointer(event);
  };

  private handleFixedViewportMouseDown = (event: MouseEvent) => {
    this.fixedMobileViewport.handleMouseDown(event);
  };

  private handleViewportChange = () => {
    const viewport = window.visualViewport;
    const currentWidth = window.innerWidth;
    const widthChanged = currentWidth !== this.layoutWidth;

    if (widthChanged) {
      this.layoutWidth = currentWidth;
      this.layoutHeight = window.innerHeight;
    }

    if (!viewport) {
      this.updateSoftwareKeyboard(false);
      this.setState(
        {
          viewportHeight: window.innerHeight,
          viewportOffsetTop: 0,
        },
        () => {
          this.xterm.fit();
          if (widthChanged) this.fixedMobileViewport.resize();
          this.settleTerminalLayout();
        }
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
      measurement.keyboardOpen &&
      !this.uiController.state.softwareKeyboardOpen;
    const keyboardChanged =
      measurement.keyboardOpen !==
      this.uiController.state.softwareKeyboardOpen;
    if (keyboardChanged) this.updateSoftwareKeyboard(measurement.keyboardOpen);
    if (keyboardJustOpened) this.xterm.setWebKeyboardActive(false);

    this.setState(
      {
        viewportHeight: measurement.height,
        viewportOffsetTop: measurement.offsetTop,
      },
      () => {
        requestAnimationFrame(() => {
          this.xterm.fit();
          if (widthChanged) this.fixedMobileViewport.resize();
          if (keyboardChanged) {
            if (measurement.keyboardOpen) {
              this.xterm.scrollToBottom();
              this.fixedMobileViewport.anchorBottom();
            } else {
              this.settleTerminalLayout();
            }
          }
        });
      }
    );
  };

  private showSurface(surface: Exclude<TerminalSurface, 'terminal'>) {
    this.transitionUi({
      type: 'show-surface',
      surface,
      preservePosition: this.mobileViewer,
    });
  }

  private returnToTerminal(callback?: () => void) {
    this.transitionUi({type: 'return-to-terminal'}, callback);
  }

  private updateSoftwareKeyboard(open: boolean) {
    this.transitionUi({
      type: 'software-keyboard',
      open,
      preservePosition: this.mobileViewer,
    });
  }

  private settleTerminalLayout() {
    if (this.mobileViewer && !this.quickbarLayoutReady) return;
    this.transitionUi({type: 'layout-settled'});
  }

  private transitionUi(action: TerminalUiAction, callback?: () => void) {
    const effect = this.uiController.transition(action);
    if (effect === 'capture-position') {
      this.xterm.captureKeyboardPosition();
      this.fixedMobileViewport.captureKeyboardPosition();
    }
    this.setState({ui: this.uiController.state}, () => {
      if (effect === 'restore-position') {
        this.xterm.restoreKeyboardPosition();
        this.fixedMobileViewport.restoreKeyboardPosition();
      }
      callback?.();
    });
  }
}
