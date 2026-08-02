import {Component, h} from 'preact';
import type {TerminalAction} from '../terminal-actions';
import {
  loadQuickbarMode,
  saveQuickbarMode,
  type QuickbarMode,
} from './mode';
import {
  quickbarControls,
  scrollControls as tmuxScrollControls,
  type QuickbarControl,
} from './controls';
import './terminal-quickbar.scss';
import type {TouchSelectionStatus} from '../terminal/xterm';
import {loadAgentLetters, rememberAgentLetter} from './letters';

interface Props {
  ctrlArmed: boolean;
  draftAvailable: boolean;
  scrollControls: boolean;
  onAction: (action: TerminalAction) => void;
  onControl: (character: string) => void;
  onText: (text: string) => void;
  onHeightChange: (height: number) => void;
  onOpenComposer: () => void;
  onOpenKeyboard: () => void;
  onOpenMenu: () => void;
  onStartCopySelection: () => void;
  onCopySelection: () => void;
  onCancelCopySelection: () => void;
  touchSelectionStatus: TouchSelectionStatus;
  copySelectionAvailable: boolean;
}

interface State {
  mode: QuickbarMode;
  letterPickerOpen: boolean;
  letters: string[];
}

export class TerminalQuickbar extends Component<Props, State> {
  private element?: HTMLElement;
  private resizeObserver?: ResizeObserver;
  private letterPicker?: HTMLElement;

  constructor(props: Props) {
    super(props);
    this.state = {
      mode: loadQuickbarMode(window.sessionStorage),
      letterPickerOpen: false,
      letters: loadAgentLetters(window.localStorage),
    };
  }

  componentDidMount() {
    if (!this.element) return;
    this.resizeObserver = new ResizeObserver(() => this.reportHeight());
    this.resizeObserver.observe(this.element);
    document.addEventListener(
      'pointerdown',
      this.handleOutsidePointerDown,
      true,
    );
    this.reportHeight();
  }

  componentWillUnmount() {
    this.resizeObserver?.disconnect();
    document.removeEventListener(
      'pointerdown',
      this.handleOutsidePointerDown,
      true,
    );
    this.props.onHeightChange(0);
  }

  render({
    ctrlArmed,
    draftAvailable,
    scrollControls,
    onAction,
    onControl,
    onText,
    onOpenComposer,
    onOpenKeyboard,
    onOpenMenu,
    onStartCopySelection,
    onCopySelection,
    onCancelCopySelection,
    touchSelectionStatus,
    copySelectionAvailable,
  }: Props) {
    return (
      <nav
        ref={(element) => {
          this.element = element ?? undefined;
        }}
        class="terminal-quickbar"
        aria-label={scrollControls ? 'Scroll controls' : 'Terminal quick actions'}
      >
        {ctrlArmed && (
          <span class="terminal-quickbar__armed" aria-hidden="true">
            Ctrl armed
          </span>
        )}
        <div class="terminal-quickbar__modes" aria-label="Quickbar mode">
          {(['agent', 'nav', 'tmux', 'ctrl', 'copy'] as QuickbarMode[]).map(
            (mode) => (
              <button
                key={mode}
                type="button"
                class="terminal-quickbar__mode"
                aria-pressed={
                  scrollControls ? mode === 'tmux' : this.state.mode === mode
                }
                disabled={scrollControls}
                onPointerDown={preventTerminalFocus}
                onClick={() => this.selectMode(mode)}
              >
                {mode === 'nav'
                  ? 'Nav'
                  : mode === 'tmux'
                    ? 'tmux'
                    : mode === 'ctrl'
                    ? 'Ctrl'
                    : mode === 'copy'
                      ? 'Copy'
                      : 'Agent'}
              </button>
            )
          )}
          <button
            type="button"
            class="terminal-quickbar__mode terminal-quickbar__mode--more"
            onPointerDown={preventTerminalFocus}
            onClick={onOpenMenu}
          >
            More
          </button>
        </div>
        <div
          class="terminal-quickbar__actions"
          aria-label={
            scrollControls
              ? 'Scroll controls'
              : `${this.modeLabel(this.state.mode)} controls`
          }
        >
          <div class="terminal-quickbar__shortcuts">
            {!scrollControls &&
            this.state.mode === 'copy' &&
            touchSelectionStatus !== 'idle' ? (
              <button
                type="button"
                class="terminal-quickbar__key terminal-quickbar__key--danger"
                onPointerDown={preventTerminalFocus}
                onClick={onCancelCopySelection}
              >
                Cancel
              </button>
            ) : (
              <QuickKey
                label="Esc"
                action="escape"
                onAction={onAction}
                danger
              />
            )}
            <div class="terminal-quickbar__context">
              {!scrollControls && this.state.mode === 'copy'
                ? this.renderCopyControls(
                    touchSelectionStatus,
                    copySelectionAvailable,
                    onStartCopySelection,
                    onCopySelection,
                  )
                : this.renderControls(
                    scrollControls
                      ? tmuxScrollControls
                      : quickbarControls[this.state.mode],
                    onAction,
                    onControl,
                    onText
                  )}
            </div>
          </div>
          <div class="terminal-quickbar__fixed-actions">
            <button
              type="button"
              class="terminal-quickbar__key terminal-quickbar__key--icon"
              onPointerDown={preventTerminalFocus}
              onClick={onOpenKeyboard}
              aria-label="Open full terminal keyboard"
              title="Open full terminal keyboard"
            >
              <KeyboardIcon />
            </button>
            <button
              type="button"
              class="terminal-quickbar__key terminal-quickbar__key--compose"
              onPointerDown={preventTerminalFocus}
              onClick={onOpenComposer}
              aria-label={
                draftAvailable ? 'Compose, draft available' : 'Compose'
              }
            >
              Compose
              {draftAvailable && (
                <span class="terminal-quickbar__draft" aria-hidden="true" />
              )}
            </button>
          </div>
          {this.state.letterPickerOpen && (
            <div
              ref={(element) => {
                this.letterPicker = element ?? undefined;
              }}
              class="terminal-quickbar__letter-picker"
              role="dialog"
              aria-label="Choose the next slash-command letter"
            >
              {this.state.letters.map((letter) => (
                <button
                  key={letter}
                  type="button"
                  aria-label={`Type ${letter}`}
                  onClick={() => this.selectAgentLetter(letter, onText)}
                >
                  {letter}
                </button>
              ))}
            </div>
          )}
        </div>
      </nav>
    );
  }

  private reportHeight() {
    this.props.onHeightChange(this.element?.getBoundingClientRect().height ?? 0);
  }

  private selectMode(mode: QuickbarMode) {
    if (mode !== 'copy') this.props.onCancelCopySelection();
    saveQuickbarMode(window.sessionStorage, mode);
    this.setState({mode, letterPickerOpen: false});
  }

  private modeLabel(mode: QuickbarMode) {
    return mode.charAt(0).toUpperCase() + mode.slice(1);
  }

  private renderControls(
    controls: QuickbarControl[],
    onAction: Props['onAction'],
    onControl: Props['onControl'],
    onText: Props['onText']
  ) {
    return controls.map((control) =>
      'action' in control ? (
        <QuickKey
          key={control.label}
          label={control.label}
          action={control.action}
          onAction={
            control.action === 'slash'
              ? this.openAgentLetters
              : onAction
          }
          danger={control.danger}
        />
      ) : 'text' in control ? (
        <button
          key={control.label}
          type="button"
          class={`terminal-quickbar__key ${
            control.danger ? 'terminal-quickbar__key--danger' : ''
          }`}
          aria-label={`Send ${control.label} to terminal`}
          onPointerDown={preventTerminalFocus}
          onClick={() => onText(control.text)}
        >
          {control.label}
        </button>
      ) : (
        <button
          key={control.label}
          type="button"
          class={`terminal-quickbar__key ${
            control.danger ? 'terminal-quickbar__key--danger' : ''
          }`}
          aria-label={`Send Ctrl-${control.control} to terminal`}
          onPointerDown={preventTerminalFocus}
          onClick={() => onControl(control.control)}
        >
          {control.label}
        </button>
      )
    );
  }

  private openAgentLetters = () => {
    this.props.onAction('slash');
    this.setState({letterPickerOpen: true});
  };

  private selectAgentLetter = (
    letter: string,
    onText: Props['onText'] = this.props.onText,
  ) => {
    const letters = rememberAgentLetter(window.localStorage, letter);
    onText(letter);
    this.setState({letters, letterPickerOpen: false});
  };

  private handleOutsidePointerDown = (event: PointerEvent) => {
    if (!this.state.letterPickerOpen) return;
    const target = event.target;
    if (target instanceof Node && this.letterPicker?.contains(target)) return;
    this.setState({letterPickerOpen: false});
  };

  private renderCopyControls(
    status: TouchSelectionStatus,
    copyAvailable: boolean,
    onStart: Props['onStartCopySelection'],
    onCopy: Props['onCopySelection'],
  ) {
    if (status === 'complete') {
      return (
        <>
          <span class="terminal-quickbar__copy-help">
            Drag box or handles
          </span>
          <button
            type="button"
            class="terminal-quickbar__key terminal-quickbar__key--copy"
            onPointerDown={preventTerminalFocus}
            onClick={onCopy}
            disabled={!copyAvailable}
          >
            Copy
          </button>
        </>
      );
    }

    return (
      <>
        <span class="terminal-quickbar__copy-help">
          {status === 'idle' ? 'Tap, then drag over text' : 'Drag over text'}
        </span>
        <button
          type="button"
          class="terminal-quickbar__key terminal-quickbar__key--copy"
          aria-pressed={status === 'armed' || status === 'selecting'}
          onPointerDown={preventTerminalFocus}
          onClick={onStart}
        >
          {status === 'idle' ? 'Select' : 'Ready'}
        </button>
      </>
    );
  }
}

function QuickKey({
  label,
  action,
  onAction,
  danger = false,
}: {
  label: string;
  action: TerminalAction;
  onAction: (action: TerminalAction) => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      class={`terminal-quickbar__key ${
        danger ? 'terminal-quickbar__key--danger' : ''
      }`}
      aria-label={`Send ${label} to terminal`}
      onPointerDown={preventTerminalFocus}
      onClick={() => onAction(action)}
    >
      {label}
    </button>
  );
}

function preventTerminalFocus(event: PointerEvent) {
  event.preventDefault();
}

function KeyboardIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M6 9h1M10 9h1M14 9h1M18 9h1M6 13h1M10 13h1M14 13h1M18 13h1M7 16h10" />
    </svg>
  );
}
