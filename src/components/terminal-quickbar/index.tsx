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

interface Props {
  ctrlArmed: boolean;
  draftAvailable: boolean;
  scrollControls: boolean;
  onAction: (action: TerminalAction) => void;
  onControl: (character: string) => void;
  onHeightChange: (height: number) => void;
  onOpenComposer: () => void;
  onOpenKeyboard: () => void;
  onOpenMenu: () => void;
}

interface State {
  mode: QuickbarMode;
}

export class TerminalQuickbar extends Component<Props, State> {
  private element?: HTMLElement;
  private resizeObserver?: ResizeObserver;

  constructor(props: Props) {
    super(props);
    this.state = {
      mode: loadQuickbarMode(window.sessionStorage),
    };
  }

  componentDidMount() {
    if (!this.element) return;
    this.resizeObserver = new ResizeObserver(() => this.reportHeight());
    this.resizeObserver.observe(this.element);
    this.reportHeight();
  }

  componentWillUnmount() {
    this.resizeObserver?.disconnect();
    this.props.onHeightChange(0);
  }

  render({
    ctrlArmed,
    draftAvailable,
    scrollControls,
    onAction,
    onControl,
    onOpenComposer,
    onOpenKeyboard,
    onOpenMenu,
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
          <span class="terminal-quickbar__armed" role="status">
            Ctrl armed
          </span>
        )}
        <div class="terminal-quickbar__modes" aria-label="Quickbar mode">
          {(['agent', 'nav', 'tmux', 'ctrl'] as QuickbarMode[]).map(
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
            <QuickKey label="Esc" action="escape" onAction={onAction} danger />
            <div class="terminal-quickbar__context">
              {this.renderControls(
                scrollControls
                  ? tmuxScrollControls
                  : quickbarControls[this.state.mode],
                onAction,
                onControl
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
        </div>
      </nav>
    );
  }

  private reportHeight() {
    this.props.onHeightChange(this.element?.getBoundingClientRect().height ?? 0);
  }

  private selectMode(mode: QuickbarMode) {
    saveQuickbarMode(window.sessionStorage, mode);
    this.setState({mode});
  }

  private modeLabel(mode: QuickbarMode) {
    return mode.charAt(0).toUpperCase() + mode.slice(1);
  }

  private renderControls(
    controls: QuickbarControl[],
    onAction: Props['onAction'],
    onControl: Props['onControl']
  ) {
    return controls.map((control) =>
      'action' in control ? (
        <QuickKey
          key={control.label}
          label={control.label}
          action={control.action}
          onAction={onAction}
          danger={control.danger}
        />
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
