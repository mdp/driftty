import {Component, h, type ComponentChildren} from 'preact';
import type {ConnectionState} from '../terminal/xterm';
import type {TerminalAction} from '../terminal-actions';
import {terminalIdentity} from './model';
import {
  customTerminalViewportSize,
  fixedTerminalSize,
  terminalViewportSizes,
  type TerminalViewportSize,
} from '../terminal/fixed-mobile-viewport';
import {MAX_FONT_SIZE, MIN_FONT_SIZE} from '../../font-size';
import './terminal-menu.scss';

interface Props {
  autoReconnect: boolean;
  connectionState: ConnectionState;
  ctrlArmed?: boolean;
  draftAvailable?: boolean;
  mobile?: boolean;
  onClose: () => void;
  onControl?: (character: string) => void;
  onOpenComposer: () => void;
  onOpenKeyboard: () => void;
  onReconnect: () => void;
  onResetQuickbar?: () => void;
  onTerminalAction?: (action: TerminalAction) => void;
  onToggleCtrl?: () => void;
  onToggleAutoReconnect: () => void;
  terminalViewportSize?: TerminalViewportSize;
  onTerminalViewportSizeChange?: (size: TerminalViewportSize) => void;
  fontSize?: number;
  onFontSizeChange?: (size: number) => void;
}

export class TerminalMenu extends Component<Props> {
  private menu?: HTMLElement;
  private firstControl?: HTMLAnchorElement;
  private sheetPointerId?: number;
  private sheetStartY = 0;
  private customColumns = 140;
  private customRows = 60;

  constructor(props: Props) {
    super(props);
    if (props.terminalViewportSize?.startsWith('custom:')) {
      const size = fixedTerminalSize(props.terminalViewportSize);
      this.customColumns = size?.columns ?? 140;
      this.customRows = size?.rows ?? 60;
    }
  }

  componentDidMount() {
    document.addEventListener('pointerdown', this.handleOutsidePointer);
    document.addEventListener('keydown', this.handleKeyDown);
    this.firstControl?.focus();
  }

  componentWillUnmount() {
    document.removeEventListener('pointerdown', this.handleOutsidePointer);
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  render({
    autoReconnect,
    connectionState,
    ctrlArmed = false,
    draftAvailable = false,
    mobile = false,
    onClose,
    onControl,
    onOpenComposer,
    onOpenKeyboard,
    onReconnect,
    onResetQuickbar,
    onTerminalAction,
    onToggleCtrl,
    onToggleAutoReconnect,
    terminalViewportSize = 'auto',
    onTerminalViewportSizeChange,
    fontSize,
    onFontSizeChange,
  }: Props) {
    const identity = terminalIdentity(window.location.pathname);
    const connectionLabel =
      connectionState.charAt(0).toUpperCase() + connectionState.slice(1);

    const menu = (
      <aside
        ref={(element) => {
          this.menu = element ?? undefined;
        }}
        class="terminal-menu"
        role="dialog"
        aria-modal={mobile ? 'true' : 'false'}
        aria-labelledby="terminal-menu-title"
        onPointerDown={this.handleSheetPointerDown}
        onPointerUp={this.handleSheetPointerUp}
        onPointerCancel={this.clearSheetPointer}
      >
        <header class="terminal-menu__header">
          <span>
            <strong id="terminal-menu-title">
              {identity.host}
              {identity.session ? ` / ${identity.session}` : ''}
            </strong>
            <small>
              Connection:{' '}
              <span data-state={connectionState}>{connectionLabel}</span>
            </small>
          </span>
          <button
            type="button"
            class="terminal-menu__close"
            onClick={onClose}
            aria-label="Close terminal menu"
          >
            ×
          </button>
        </header>

        <nav class="terminal-menu__primary" aria-label="Terminal">
          <a
            ref={(element) => {
              this.firstControl = element ?? undefined;
            }}
            href="/"
          >
            <span>All terminals</span>
            <span aria-hidden="true">→</span>
          </a>
          <button
            type="button"
            onClick={onOpenComposer}
            aria-label={
              draftAvailable
                ? 'Compose / Paste, draft available'
                : 'Compose / Paste'
            }
          >
            <span>Compose / Paste</span>
            <span aria-hidden="true">
              {draftAvailable ? '•' : '›'}
            </span>
          </button>
        </nav>

        {mobile && onTerminalAction && (
          <>
            <MenuKeys title="Terminal">
              <MenuAction label="/" action="slash" send={onTerminalAction} />
              <MenuAction label="Space" action="space" send={onTerminalAction} />
              <MenuAction label="Home" action="home" send={onTerminalAction} />
              <MenuAction label="End" action="end" send={onTerminalAction} />
              <MenuAction label="PgUp" action="page-up" send={onTerminalAction} />
              <MenuAction label="PgDn" action="page-down" send={onTerminalAction} />
              <MenuAction label="Ins" action="insert" send={onTerminalAction} />
              <MenuAction label="Del" action="delete" send={onTerminalAction} />
              <MenuAction
                label="Send Escape to terminal"
                action="escape"
                send={onTerminalAction}
                wide
              />
            </MenuKeys>
            <MenuKeys title="tmux">
              <MenuAction label="Scroll" action="tmux-scroll" send={onTerminalAction} />
              <MenuAction label="Previous" action="tmux-previous" send={onTerminalAction} />
              <MenuAction label="Next" action="tmux-next" send={onTerminalAction} />
              <MenuAction label="New" action="tmux-new" send={onTerminalAction} />
              <MenuAction label="Detach" action="tmux-detach" send={onTerminalAction} />
              <MenuAction label="Prefix" action="tmux-prefix" send={onTerminalAction} />
              <button type="button" class="terminal-menu__wide" onClick={onResetQuickbar}>
                Reset Quickbar
              </button>
            </MenuKeys>
            <MenuKeys title="Control">
              <button
                type="button"
                aria-pressed={ctrlArmed}
                class={ctrlArmed ? 'terminal-menu__armed' : ''}
                onClick={onToggleCtrl}
              >
                {ctrlArmed ? 'Ctrl armed' : 'Ctrl'}
              </button>
              {['C', 'D', 'L', 'R', 'S', 'T'].map((character) => (
                <button
                  key={character}
                  type="button"
                  class={character === 'C' ? 'terminal-menu__interrupt' : ''}
                  aria-label={`Send Ctrl-${character} to terminal`}
                  onClick={() => onControl?.(character)}
                >
                  {character}
                </button>
              ))}
              <button
                type="button"
                class="terminal-menu__keyboard"
                onClick={onOpenKeyboard}
                aria-label="Open full terminal keyboard"
                title="Open full terminal keyboard"
              >
                <KeyboardIcon />
              </button>
            </MenuKeys>
          </>
        )}

        <section class="terminal-menu__section">
          <h2>Connection</h2>
          <button
            type="button"
            onClick={onReconnect}
            disabled={
              connectionState === 'connecting' ||
              connectionState === 'connected'
            }
          >
            <span>Reconnect</span>
            <span class="terminal-menu__state">{connectionLabel}</span>
          </button>
          <label>
            <span>Auto reconnect</span>
            <input
              type="checkbox"
              checked={autoReconnect}
              onChange={onToggleAutoReconnect}
            />
          </label>
        </section>

        <section class="terminal-menu__section">
          <h2>Settings</h2>
          {onTerminalViewportSizeChange && (
            <fieldset class="terminal-menu__size">
              <legend>Terminal size</legend>
              {terminalViewportSizes.map(({value, label, description}) => (
                <label key={value}>
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                  <input
                    type="radio"
                    name="terminal-viewport-size"
                    value={value}
                    checked={terminalViewportSize === value}
                    onChange={() => onTerminalViewportSizeChange(value)}
                  />
                </label>
              ))}
              <div class="terminal-menu__custom-size">
                <span>
                  <strong>Custom</strong>
                  <small>Up to 200 × 200</small>
                </span>
                <label>
                  <span>Columns</span>
                  <input
                    type="number"
                    min="1"
                    max="200"
                    value={this.customColumns}
                    onInput={(event) => {
                      this.customColumns = Number(event.currentTarget.value);
                    }}
                  />
                </label>
                <span aria-hidden="true">×</span>
                <label>
                  <span>Rows</span>
                  <input
                    type="number"
                    min="1"
                    max="200"
                    value={this.customRows}
                    onInput={(event) => {
                      this.customRows = Number(event.currentTarget.value);
                    }}
                  />
                </label>
                <button
                  type="button"
                  aria-pressed={terminalViewportSize.startsWith('custom:')}
                  onClick={() => {
                    const value = customTerminalViewportSize(
                      this.customColumns,
                      this.customRows,
                    );
                    const size = fixedTerminalSize(value);
                    this.customColumns = size?.columns ?? 1;
                    this.customRows = size?.rows ?? 1;
                    onTerminalViewportSizeChange(value);
                  }}
                >
                  Apply
                </button>
              </div>
              <p>
                {mobile
                  ? 'Fixed sizes support two-finger pan, pinch zoom, and double-tap to fit.'
                  : 'Fixed sizes preserve the selected TTY geometry; double-click to fit.'}
              </p>
            </fieldset>
          )}
          {fontSize !== undefined && onFontSizeChange && (
            <fieldset class="terminal-menu__font-size">
              <legend>Font size</legend>
              <div>
                <button
                  type="button"
                  onClick={() => onFontSizeChange(fontSize - 1)}
                  disabled={fontSize <= MIN_FONT_SIZE}
                  aria-label="Decrease terminal font size"
                >
                  A-
                </button>
                <output aria-live="polite">{fontSize}px</output>
                <button
                  type="button"
                  onClick={() => onFontSizeChange(fontSize + 1)}
                  disabled={fontSize >= MAX_FONT_SIZE}
                  aria-label="Increase terminal font size"
                >
                  A+
                </button>
              </div>
            </fieldset>
          )}
          <button type="button" onClick={onOpenKeyboard}>
            <span>Full terminal keyboard</span>
            <span aria-hidden="true">›</span>
          </button>
        </section>
      </aside>
    );
    return mobile ? (
      <div class="terminal-menu-backdrop" onPointerDown={this.handleBackdrop}>
        {menu}
      </div>
    ) : menu;
  }

  private handleOutsidePointer = (event: PointerEvent) => {
    if (this.props.mobile) return;
    const target = event.target as Element;
    if (
      !this.menu?.contains(target) &&
      !target.closest('.keyboard-toggle')
    ) {
      this.props.onClose();
    }
  };

  private handleBackdrop = (event: PointerEvent) => {
    if (event.target === event.currentTarget) this.props.onClose();
  };

  private handleSheetPointerDown = (event: PointerEvent) => {
    if (!this.props.mobile || event.pointerType !== 'touch') return;
    this.sheetPointerId = event.pointerId;
    this.sheetStartY = event.clientY;
  };

  private handleSheetPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.sheetPointerId) return;
    const distance = event.clientY - this.sheetStartY;
    this.clearSheetPointer();
    if (distance > 72) this.props.onClose();
  };

  private clearSheetPointer = () => {
    this.sheetPointerId = undefined;
    this.sheetStartY = 0;
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.props.onClose();
      return;
    }
    if (event.key !== 'Tab' || !this.props.mobile || !this.menu) return;
    const target = mobileMenuFocusTarget(
      focusableMenuControls(this.menu),
      document.activeElement,
      event.shiftKey,
    );
    if (!target) return;
    event.preventDefault();
    target.focus();
  };
}

const menuFocusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableMenuControls(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>(menuFocusableSelector));
}

export function mobileMenuFocusTarget(
  controls: readonly HTMLElement[],
  activeElement: Element | null,
  backwards: boolean,
): HTMLElement | undefined {
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (!first || !last) return undefined;
  const focusIsOutside = !controls.includes(activeElement as HTMLElement);
  if (backwards && (activeElement === first || focusIsOutside)) {
    return last;
  }
  if (!backwards && (activeElement === last || focusIsOutside)) {
    return first;
  }
  return undefined;
}

function MenuKeys({
  title,
  children,
}: {
  title: string;
  children: ComponentChildren;
}) {
  return (
    <section class="terminal-menu__section terminal-menu__key-section">
      <h2>{title}</h2>
      <div class="terminal-menu__key-grid">{children}</div>
    </section>
  );
}

function MenuAction({
  label,
  action,
  send,
  wide = false,
}: {
  label: string;
  action: TerminalAction;
  send: (action: TerminalAction) => void;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      class={wide ? 'terminal-menu__wide' : ''}
      aria-label={`Send ${label} to terminal`}
      onClick={() => send(action)}
    >
      {label}
    </button>
  );
}

function KeyboardIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M6 9h1M10 9h1M14 9h1M18 9h1M6 13h1M10 13h1M14 13h1M18 13h1M7 16h10" />
    </svg>
  );
}
