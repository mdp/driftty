import {Component, h} from 'preact';
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

const HOLD_DELAY = 500;
const DRAG_THRESHOLD = 8;

export class TerminalLauncher extends Component<Props, State> {
  private button?: HTMLButtonElement;
  private pointerId?: number;
  private startX = 0;
  private startY = 0;
  private holdTimer?: number;
  private held = false;
  private isDragging = false;
  private suppressClick = false;

  state: State = {
    corner: loadLauncherCorner(),
    dragging: false,
    dragX: 0,
    dragY: 0,
  };

  componentWillUnmount() {
    this.clearHold();
  }

  render(_: Props, {corner, dragging, dragX, dragY}: State) {
    return (
      <button
        ref={(element) => {
          this.button = element ?? undefined;
        }}
        type="button"
        class={`terminal-launcher terminal-launcher--${corner} ${
          dragging ? 'terminal-launcher--dragging' : ''
        }`}
        style={
          dragging
            ? {transform: `translate3d(${dragX}px, ${dragY}px, 0)`}
            : undefined
        }
        title="Tap for web keyboard; hold for Input/Paste; drag to move"
        aria-label="Terminal controls: tap for web keyboard, hold for Input and Paste, or drag to move"
        onPointerDown={this.handlePointerDown}
        onPointerMove={this.handlePointerMove}
        onPointerUp={this.handlePointerUp}
        onPointerCancel={this.handlePointerCancel}
        onClick={this.handleClick}
      >
        <span class="terminal-launcher__signal" aria-hidden="true" />
        <span class="terminal-launcher__screen" aria-hidden="true">
          <span>&gt;_</span>
        </span>
      </button>
    );
  }

  private clearHold = () => {
    if (this.holdTimer !== undefined) {
      window.clearTimeout(this.holdTimer);
      this.holdTimer = undefined;
    }
  };

  private handlePointerDown = (event: PointerEvent) => {
    if (this.pointerId !== undefined) return;
    event.preventDefault();
    event.stopPropagation();
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.held = false;
    this.suppressClick = false;
    this.button?.setPointerCapture(event.pointerId);
    this.holdTimer = window.setTimeout(() => {
      if (this.pointerId === undefined || this.isDragging) return;
      this.held = true;
      this.suppressClick = true;
      this.releasePointer();
      this.props.onOpenComposer();
    }, HOLD_DELAY);
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
    this.clearHold();
    this.suppressClick = true;
    this.isDragging = true;
    this.setState({dragging: true, dragX, dragY});
  };

  private handlePointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    this.clearHold();

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
    } else if (!this.held) {
      this.suppressClick = true;
      this.props.onOpenKeyboard();
    }
    this.releasePointer();
  };

  private handlePointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    this.clearHold();
    this.suppressClick = true;
    this.isDragging = false;
    this.releasePointer();
    this.setState({dragging: false, dragX: 0, dragY: 0});
  };

  private handleClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    // Preserve keyboard and assistive-technology button activation.
    this.props.onOpenKeyboard();
  };

  private releasePointer() {
    const pointerId = this.pointerId;
    this.pointerId = undefined;
    if (
      pointerId !== undefined &&
      this.button?.hasPointerCapture(pointerId)
    ) {
      this.button.releasePointerCapture(pointerId);
    }
  }
}
