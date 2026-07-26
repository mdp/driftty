import {Component, h, type ComponentChildren} from 'preact';
import {
  loadLauncherCorner,
  resolveLauncherCorner,
  storeLauncherCorner,
  type LauncherCorner,
} from './position';
import './terminal-launcher.scss';

interface Props {
  onOpenKeyboard: () => void;
  onOpenComposer: () => void;
}

interface State {
  corner: LauncherCorner;
  dragging: boolean;
  dragX: number;
  dragY: number;
}

const DRAG_THRESHOLD = 8;
type LauncherAction = 'keyboard' | 'composer';

export class TerminalLauncher extends Component<Props, State> {
  private pointerTarget?: HTMLButtonElement;
  private pointerId?: number;
  private pointerAction?: LauncherAction;
  private startX = 0;
  private startY = 0;
  private isDragging = false;
  private suppressClick = false;

  state: State = {
    corner: loadLauncherCorner(),
    dragging: false,
    dragX: 0,
    dragY: 0,
  };

  render(_: Props, {corner, dragging, dragX, dragY}: State) {
    return (
      <div
        class={`terminal-launcher terminal-launcher--${corner} ${
          dragging ? 'terminal-launcher--dragging' : ''
        }`}
        style={
          dragging
            ? {transform: `translate3d(${dragX}px, ${dragY}px, 0)`}
            : undefined
        }
        role="group"
        aria-label="Terminal controls; drag either button to move"
      >
        <span class="terminal-launcher__signal" aria-hidden="true" />
        {this.renderButton('keyboard', '>_', 'Open web keyboard')}
        {this.renderButton(
          'composer',
          <svg
            class="terminal-launcher__microphone"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v4M9 21h6" />
          </svg>,
          'Open Input and Paste'
        )}
      </div>
    );
  }

  private renderButton(
    action: LauncherAction,
    label: ComponentChildren,
    accessibleLabel: string
  ) {
    return (
      <button
        type="button"
        class="terminal-launcher__button"
        title={`${accessibleLabel}; drag to move`}
        aria-label={accessibleLabel}
        onPointerDown={(event) => this.handlePointerDown(event, action)}
        onPointerMove={this.handlePointerMove}
        onPointerUp={this.handlePointerUp}
        onPointerCancel={this.handlePointerCancel}
        onClick={(event) => this.handleClick(event, action)}
      >
        {label}
      </button>
    );
  }

  private handlePointerDown = (
    event: PointerEvent,
    action: LauncherAction
  ) => {
    if (this.pointerId !== undefined) return;
    event.preventDefault();
    event.stopPropagation();
    this.pointerId = event.pointerId;
    this.pointerAction = action;
    this.pointerTarget = event.currentTarget as HTMLButtonElement;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.suppressClick = false;
    this.pointerTarget.setPointerCapture(event.pointerId);
  };

  private handlePointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dragX = event.clientX - this.startX;
    const dragY = event.clientY - this.startY;
    if (
      !this.isDragging &&
      Math.hypot(dragX, dragY) < DRAG_THRESHOLD
    ) {
      return;
    }
    this.suppressClick = true;
    this.isDragging = true;
    this.setState({dragging: true, dragX, dragY});
  };

  private handlePointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    event.stopPropagation();

    if (this.isDragging) {
      const viewport = window.visualViewport;
      const corner = resolveLauncherCorner({
        x: event.clientX,
        y: event.clientY - (viewport?.offsetTop ?? 0),
        viewportWidth: viewport?.width ?? window.innerWidth,
        viewportHeight: viewport?.height ?? window.innerHeight,
        deltaX: event.clientX - this.startX,
        deltaY: event.clientY - this.startY,
      });
      storeLauncherCorner(corner);
      this.isDragging = false;
      this.setState({corner, dragging: false, dragX: 0, dragY: 0});
    } else {
      this.suppressClick = true;
      this.invoke(this.pointerAction);
    }
    this.releasePointer();
  };

  private handlePointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    this.suppressClick = true;
    this.isDragging = false;
    this.releasePointer();
    this.setState({dragging: false, dragX: 0, dragY: 0});
  };

  private handleClick = (event: MouseEvent, action: LauncherAction) => {
    event.preventDefault();
    event.stopPropagation();
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    // Preserve keyboard and assistive-technology button activation.
    this.invoke(action);
  };

  private invoke(action?: LauncherAction) {
    if (action === 'composer') this.props.onOpenComposer();
    else if (action === 'keyboard') this.props.onOpenKeyboard();
  }

  private releasePointer() {
    const pointerId = this.pointerId;
    this.pointerId = undefined;
    this.pointerAction = undefined;
    if (
      pointerId !== undefined &&
      this.pointerTarget?.hasPointerCapture(pointerId)
    ) {
      this.pointerTarget.releasePointerCapture(pointerId);
    }
    this.pointerTarget = undefined;
  }
}
