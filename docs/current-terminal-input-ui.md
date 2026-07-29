# Current Terminal Input UI: Product and Interaction Audit

**Audit date:** 2026-07-27  
**Scope:** The terminal-facing web UI as currently implemented, with emphasis on
the web keyboard, keyboard groups, individual keys, Input/Paste composer,
settings, keyboard/microphone launchers, selection, and native-keyboard
interaction.

This document describes the current implementation, not a proposed design.
Where a label or comment implies behavior that the UI cannot currently deliver,
that discrepancy is called out explicitly.

## 1. Executive summary

The terminal has three input paths:

1. **Native xterm input** from a physical or operating-system keyboard.
2. **Web keyboard overlay** with a QWERTY/symbol keyboard and four groups of
   terminal shortcuts.
3. **Input / Paste composer**, a standard multiline text area intended for
   typing, paste, and operating-system dictation before inserting text into the
   terminal.

The entry controls differ by viewer:

| Viewer | Closed-state controls | Native xterm input |
|---|---|---|
| Desktop | A 24 px cyan corner triangle in the upper-right. Hover/focus expands it into a `>_` keyboard button. | Enabled until the web keyboard is opened. |
| Mobile | A draggable, two-button `>_` + microphone launcher, initially in the bottom-right. | Permanently disabled; input is expected through the web keyboard or composer. |
| iOS | Same mobile UI and behavior as Android. | Disabled. |
| Android | Same mobile UI and behavior as iOS. | Disabled. |

There is currently no OS-specific keyboard layout or behavior beyond viewer
detection and `data-os` metadata on the terminal shell.

## 2. Viewer detection and responsive split

At startup, the client classifies the viewer once:

- iPhone, iPad, iPod, iPadOS, and Android are classified as **mobile**.
- A mobile user agent without a fine pointer is also classified as mobile.
- Other viewers are classified as **desktop**.
- iPadOS is inferred from a Macintosh user agent combined with touch support and
  no fine pointer.

The result contains form factor, OS, touch capability, and fine-pointer
capability. The terminal shell exposes `data-viewer` and `data-os`, but current
styles do not use these attributes for further OS-specific variants.

The initial terminal font is normally 13 px on desktop. Mobile font size is
chosen from viewport dimensions, usually 16 px in phone portrait and 14 px in
phone landscape. A saved `ttyd-font-size` value, if another feature has written
one, overrides this calculation. This UI does not currently expose a font-size
setting.

Relevant implementation:
[viewer-profile.ts](../src/viewer-profile.ts),
[font-size.ts](../src/font-size.ts), and
[app.tsx](../src/components/app.tsx).

## 3. Overall UI state model

The terminal begins with the web keyboard and composer closed.

```text
Terminal
├── closed controls
│   ├── desktop: corner keyboard toggle
│   └── mobile: movable keyboard + microphone launcher
├── web keyboard
│   ├── Agent / Nav / Ctrl / tmux / tmux-scroll groups
│   ├── letters / symbols typing layers
│   └── Settings page
└── Input / Paste composer
```

Important state rules:

- Opening the web keyboard hides the closed-state launcher.
- Opening the composer closes the web keyboard.
- Closing the composer returns focus to xterm on desktop; `focus()` intentionally
  does nothing on mobile.
- The composer retains its draft while it is closed without sending. A
  successful Insert action clears it.
- The selected keyboard group and letters/symbols layer survive closing and
  reopening the keyboard for the life of the mounted page.
- Settings are not automatically closed when the keyboard is closed, so
  reopening the keyboard can return directly to Settings.
- Reloading the page resets keyboard visibility, selected group, layer,
  modifier, composer draft, and Settings visibility.
- Auto reconnect and the mobile launcher corner are persisted in
  `localStorage`.

## 4. Desktop closed-state keyboard control

Desktop viewers see a keyboard-only control in the upper-right whenever the web
keyboard is closed. It remains visible while the composer is open because its
render condition only checks keyboard visibility.

### Resting appearance

- Transparent button footprint: 26 px wide × 24 px high.
- Solid cyan gradient triangle: exactly 24 px × 24 px, clipped into the
  upper-right corner.
- No line and no status dot.
- Opacity: 0.78.

### Hover and keyboard-focus appearance

- Expands to 52 px × 42 px.
- Gains a dark panel, cyan border effect, and shadow.
- The triangle fades and scales down.
- A bordered `>_` prompt rotates out from the corner, going from a rotated,
  0.32-scale state to full size.

### Interaction

- Click opens the web keyboard.
- Mouse-down prevents the xterm helper input from stealing or changing focus.
- The control cannot be dragged.
- It has the title and accessible label **“Open web keyboard.”**
- It does not provide direct access to the composer. Desktop users must open the
  web keyboard, then select its microphone tab to reach Input / Paste.

Relevant implementation:
[terminal/index.tsx](../src/components/terminal/index.tsx) and
[keyboard-overlay.scss](../src/components/keyboard-overlay/keyboard-overlay.scss).

## 5. Mobile closed-state launcher

Mobile viewers see a two-button launcher only when all of the following are
true:

- the web keyboard is closed;
- the Input / Paste composer is closed; and
- the browser's software keyboard is not detected as open.

Although sometimes described as “hover” controls, this launcher is designed for
touch/coarse-pointer use. CSS completely hides it on devices reporting both
hover support and a fine pointer.

### Appearance

- 88 px wide × 44 px high.
- Dark cyan-edged panel with clipped corners.
- Left half: cyan `>_`, opening the web keyboard.
- Right half: magenta microphone icon, opening Input / Paste.
- A small green status dot appears at the upper-right.
- A short magenta decorative line appears at the upper-left.
- Default location: bottom-right, inset at least 12 px plus safe-area insets.

### Click/tap behavior

- Tapping `>_` opens the web keyboard.
- Tapping the microphone opens Input / Paste directly.
- Pointer events prevent propagation to the terminal.
- Keyboard and assistive-technology button activation are supported through a
  normal click fallback.

### Drag behavior

- Either half can drag the entire launcher.
- Movement under 8 px is treated as a tap.
- On release, the launcher snaps to one of four corners.
- A drag of at least 24 px uses gesture direction to choose each axis;
  otherwise the release position relative to the viewport midpoint chooses it.
- The selected corner is saved under `ttyd-launcher-corner` in `localStorage`.
- If storage is unavailable or invalid, the launcher defaults to bottom-right.
- The stored position is a corner, not free x/y coordinates.

Relevant implementation:
[terminal-launcher/index.tsx](../src/components/terminal-launcher/index.tsx),
[position.ts](../src/components/terminal-launcher/position.ts), and
[terminal-launcher.scss](../src/components/terminal-launcher/terminal-launcher.scss).

## 6. Web keyboard overlay

The web keyboard is an absolute bottom sheet above the terminal.

### Layout and sizing

- Anchored to the bottom, left, and right edges.
- Maximum height is the smaller of 72 viewport-height units and 430 px.
- Includes bottom safe-area padding.
- Opening animation deploys upward over 170 ms.
- Its measured height is subtracted from the terminal container height.
- After a size change, xterm is fitted to the remaining space and scrolled to
  the bottom.
- Maximum-height CSS does not itself make the complete overlay scrollable.

The overlay has three vertical regions:

1. status/header;
2. horizontally scrollable group rail;
3. selected shortcut group followed by the typing keyboard.

At viewport heights of 620 px or less, the status/header is hidden and typing
keys shrink to 40 px high. At widths of 430 px or less, ordinary shortcut
groups change from five columns to three. The Ctrl group remains six columns.

The overlay prevents default behavior on pointer-down across its entire panel,
primarily to avoid accidental terminal/native-keyboard interaction.

### Header/status row

The row shows:

- a pulsing green status dot;
- fixed text `TTYD//REMOTE`;
- the active group (`agent`, `nav`, `ctrl`, `tmux`, or `tmux_scroll`) or
  `settings`;
- a `⚙ Settings` button.

This is visual status only; it does not report the actual connection state.

### Group rail

In normal mode, the horizontally scrollable rail contains:

1. **Agent**
2. **Nav**
3. **Ctrl**
4. **tmux**
5. a microphone icon for **Open Input and Paste**
6. a `⌄` button for **Close keyboard**

The active group is highlighted cyan. The microphone is magenta. The rail hides
its scrollbar.

In Settings mode, the group buttons are replaced by:

1. **← Back**
2. **⌄ Close keyboard**

## 7. Shortcut groups and exact terminal output

All shortcut buttons send their sequence immediately to the terminal
WebSocket. They do not consume an armed one-shot Ctrl or Shift modifier.

Escape notation used below:

- `ESC` = byte `0x1b`
- `CR` = byte `0x0d`
- `LF` = byte `0x0a`
- `DEL` = byte `0x7f`
- `Ctrl-B` = byte `0x02`

### 7.1 Agent group

Agent is the initial group.

| Label | Sent sequence | Intended meaning |
|---|---|---|
| `Esc` | `ESC` | Escape |
| `Tab` | `TAB` (`0x09`) | Tab |
| `⇧Tab` | `ESC [ Z` | Back-tab / Shift+Tab |
| `↑` | `ESC [ A` | Up arrow |
| `↓` | `ESC [ B` | Down arrow |
| `PgUp` | `ESC [ 5 ~` | Page Up |
| `PgDn` | `ESC [ 6 ~` | Page Down |
| `Ctrl-C` | `0x03` | Interrupt; danger styling |
| `Scroll` | `Ctrl-B` then `[` | Enter tmux copy mode and switch UI to tmux-scroll |

There are no left/right arrows in Agent.

### 7.2 Nav group

| Label | Sent sequence |
|---|---|
| `←` | `ESC [ D` |
| `↑` | `ESC [ A` |
| `↓` | `ESC [ B` |
| `→` | `ESC [ C` |
| `PgUp` | `ESC [ 5 ~` |
| `PgDn` | `ESC [ 6 ~` |
| `Home` | `ESC [ H` |
| `End` | `ESC [ F` |

Nav does not show the Scroll action.

### 7.3 Ctrl group

The first two buttons arm a one-shot modifier:

| Label | Behavior |
|---|---|
| `CTRL` | Arms Ctrl for the next web-typing key or native xterm input event. |
| `SHIFT` | Arms Shift for the next web-typing key or native xterm input event. |

The remaining buttons send fixed control bytes immediately:

| Label | Sent byte | Current title/intended use |
|---|---:|---|
| `Esc` | `0x1b` | Ctrl-[ — Escape |
| `^\` | `0x1c` | Ctrl-\ — quit foreground process |
| `^_` | `0x1f` | Ctrl-_ — undo last edit |
| `Del` | `0x7f` | Ctrl-? — delete backward |
| `^W` | `0x17` | Delete previous word |
| `^E` | `0x05` | Move to end of line |
| `^R` | `0x12` | Search history or rename session |
| `^U` | `0x15` | Delete to start of line |
| `^P` | `0x10` | Previous item or command list |
| `^A` | `0x01` | Move to start of line |
| `^D` | `0x04` | Delete, EOF, or exit |
| `^G` | `0x07` | Cancel active prompt or response |
| `^L` | `0x0c` | Clear or redraw screen |
| `^Z` | `0x1a` | Suspend foreground process |
| `^X` | `0x18` | OpenCode leader or command prefix |
| `^C` | `0x03` | Interrupt or cancel; danger styling |

On narrow screens the Ctrl grid still has six columns, creating three rows of
six controls including the two modifier buttons.

### 7.4 tmux group

All commands assume tmux's default `Ctrl-B` prefix. There is no configuration
for a custom tmux prefix in this UI.

| Label | Sent sequence | Intended tmux action |
|---|---|---|
| `Prefix` | `Ctrl-B` | Send prefix only |
| `New` | `Ctrl-B c` | New window |
| `Next` | `Ctrl-B n` | Next window |
| `Prev` | `Ctrl-B p` | Previous window |
| `Split ↔` | `Ctrl-B %` | Horizontal pane split |
| `Split ↕` | `Ctrl-B "` | Vertical pane split |
| `Zoom` | `Ctrl-B z` | Toggle pane zoom |
| `Detach` | `Ctrl-B d` | Detach client |
| `Scroll` | `Ctrl-B [` | Enter tmux copy mode and switch UI to tmux-scroll |

The split labels describe visual direction, while the exact orientation naming
can vary between tmux documentation and user expectations.

### 7.5 tmux-scroll submode

Entering Scroll from Agent or tmux immediately sends `Ctrl-B [` and replaces
the current shortcut group with:

| Label | Sent sequence |
|---|---|
| `PgUp` | `ESC [ 5 ~` |
| `PgDn` | `ESC [ 6 ~` |
| `↑` | `ESC [ A` |
| `↓` | `ESC [ B` |
| `Exit` | literal `q` |

The UI displays an amber **TMUX SCROLL** mode label. Exit sends `q` and returns
the selected group to tmux. There is no independent UI verification that tmux
actually entered or remained in copy mode, so keyboard mode and remote tmux
mode can become unsynchronized.

Relevant implementation:
[keys.ts](../src/components/keyboard-overlay/keys.ts) and
[keyboard-overlay/index.tsx](../src/components/keyboard-overlay/index.tsx).

## 8. Typing keyboard

The typing keyboard is always below the selected shortcut group except while
Settings is open.

### 8.1 Letters layer

Three centered QWERTY rows:

```text
q w e r t y u i o p
  a s d f g h j k l
⇧ z x c v b n m ⌫
```

The bottom action row is:

```text
Ctrl   #+=   Tab   /   space   ↵
```

The second alphabet row is inset by 4% on each side. Shift and Backspace are
wider edge keys on the third row.

### 8.2 Symbols layer

Three symbol rows:

```text
1 2 3 4 5 6 7 8 9 0
- _ = + / \ | ~ `
. , : ; ' " ( ) [ ] { }
```

The bottom action row is:

```text
Ctrl   ⇧   ABC   Tab   /   space   ⌫   ↵
```

The slash is intentionally duplicated as a shell-friendly action-row key.

### 8.3 Key behavior

| Key | Behavior |
|---|---|
| Character/symbol | Sends the displayed key's configured value immediately. |
| `⌫` | Sends `DEL` (`0x7f`), not ASCII Backspace (`0x08`). |
| `Tab` | Sends `TAB` (`0x09`). |
| `/` | Sends literal `/`. |
| `space` | Sends one literal space. |
| `↵` | Sends `CR` (`0x0d`). |
| `#+=` / `ABC` | Switches between letters and symbols; sends nothing. |
| `Ctrl` | Toggles the one-shot Ctrl modifier. |
| `⇧` | Toggles the one-shot Shift modifier. |

Touch input is sent on pointer-down for lower perceived latency. The subsequent
synthetic click is suppressed so a touch does not send twice. Mouse/keyboard
activation sends on click.

### 8.4 One-shot modifier behavior

Only one modifier can be armed at a time. Arming Ctrl replaces Shift and vice
versa. Tapping an already armed modifier clears it. The amber latched style
shows the active modifier.

The modifier is consumed after the next typing key or native xterm input event:

- Ctrl + `A`–`Z` produces bytes `0x01`–`0x1a`.
- Ctrl supports terminal symbol mappings for `@`, `[`, `\`, `]`, `^`, `_`,
  and `?`.
- Shift uppercases a single letter.
- Shift + Tab produces `ESC [ Z`.
- Shift + Enter produces `LF` (`0x0a`), matching Ctrl-J, instead of `CR`.
- Shift leaves already explicit symbols such as `/` and `-` unchanged.

Because the symbols layer already exposes shifted and unshifted symbols as
separate keys, Shift does not transform `1` to `!`, `-` to `_`, and so on.

The Ctrl group's fixed control buttons and all other shortcut groups bypass the
armed modifier and do not clear it. For example, arm Shift, tap Agent `Esc`,
then tap `a`: Escape is sent first and `A` is still sent afterward.

### 8.5 Native keyboard interaction

On desktop, opening the web keyboard disables, blurs, and removes the xterm
helper text area from tab order. Closing it restores the helper text area's
prior state.

On mobile, that xterm helper input is always disabled, read-only,
`inputMode="none"`, and removed from tab order. Consequently:

- the operating-system keyboard is not a viable direct xterm input path;
- the Ctrl/Shift group labels saying they apply to the “next native-keyboard
  character” are not actionable on mobile;
- modifiers do not carry into the Input / Paste composer.

Physical Shift+Enter in xterm is specially intercepted and sends `LF`, provided
Ctrl, Alt, and Meta are not also held. Both keydown and keyup are suppressed,
with the byte sent on keydown. This makes coding-agent multiline entry behave
like Ctrl-J.

## 9. Input / Paste composer

The composer is a modal-looking panel near the top of the visual viewport. It
is available:

- directly from the mobile launcher's microphone;
- from the microphone tab inside the web keyboard on mobile or desktop.

Opening it disables web-keyboard mode, closes the keyboard, and gives focus to a
standard HTML text area. The caret is placed at the end of an existing draft.

### 9.1 Header and input

Header:

- pulsing magenta signal dot;
- title **INPUT / PASTE**;
- right-aligned hint **TYPE · PASTE · DICTATE**.

Text area:

- minimum height 92 px;
- maximum height 32% of viewport height;
- vertically resizable;
- 16 px monospace text;
- standard text input mode;
- English language;
- sentence auto-capitalization;
- autocorrect and spellcheck enabled;
- browser Enter key hint set to `enter`;
- placeholder: “Long-press to paste, type, or use keyboard dictation…”.

“Dictate” is not an in-app speech-recognition implementation. It means using
the operating system's keyboard dictation inside the normal text area. The app
does not request microphone permission or record audio.

### 9.2 Actions

| Button | Behavior |
|---|---|
| `INSERT` | Paste the composer text into xterm without Enter, close the composer, clear the draft, and restore desktop terminal focus. If the text is empty, do nothing and remain open. |
| `INSERT ↵` | Paste the text, then separately send `CR`, close, clear, and restore desktop terminal focus. This works even with empty text, in which case it sends Enter only. |
| `COPY` | Copy the entire composer value to the browser clipboard. On success the label becomes `COPIED` for 1.2 seconds. If Clipboard API access fails, select the text and use legacy `execCommand("copy")`. Refocus the text area afterward. |
| `CLOSE` | Close without clearing the draft; restore desktop terminal focus. |

The insert path uses xterm's `paste()` API, rather than sending characters one
at a time. With bracketed paste enabled by the remote application, xterm may
wrap the text in bracketed-paste control sequences. `INSERT ↵` deliberately
sends Enter separately so it executes after the paste rather than becoming part
of the pasted content.

The composer has `role="dialog"` and `aria-modal="true"`, but there is no focus
trap, Escape-to-close handler, click-outside close, or explicit focus return to
the launcher control.

Relevant implementation:
[voice-composer/index.tsx](../src/components/voice-composer/index.tsx),
[actions.ts](../src/components/voice-composer/actions.ts), and
[voice-composer.scss](../src/components/voice-composer/voice-composer.scss).

## 10. Settings

Settings are accessible only from the web keyboard header.

Opening Settings:

- changes the header's active section label to `settings`;
- replaces the group rail with **← Back** and **⌄ Close keyboard**;
- replaces all shortcut and typing keys with two settings rows.

### Hosts

- Label: **Hosts**
- Description: “Return to the main host list”
- Trailing magenta arrow.
- Implemented as a direct link to `/`.
- It does not preserve the current session route or ask for confirmation.

### Auto reconnect

- Label: **Auto reconnect**
- Description: “Reconnect automatically if the session drops”
- Native checkbox, cyan accent.
- Enabled by default unless `ttyd-auto-reconnect` is exactly `false` in
  `localStorage`.
- Toggling updates the active xterm connection policy and persists the value.
- Turning it off cancels a pending retry timer.

Unexpected disconnects retry up to five times using delays of 0.5, 1, 2, 4,
and 8 seconds. After retries are exhausted—or when automatic reconnect is
disabled—the UI displays a separate **Reconnect** button and terminal overlay
text “Tap Reconnect or press ⏎”. Pressing Enter in xterm or tapping the button
starts a manual reconnect.

Server-provided ttyd preferences can also change or disable reconnect behavior,
which can cause the settings component's checkbox state to be stale because
the component only initializes from xterm once and updates on its own clicks.

## 11. Selection, copy, paste, and mouse ownership

### Desktop selection

Ordinary terminal mouse input remains available to tmux or another mouse-aware
terminal program.

Local browser selection requires **Shift + primary-button drag**:

- the gesture is intercepted before xterm can report it remotely;
- selection snaps to terminal cells;
- releasing completes xterm's selection;
- every non-empty xterm selection change attempts an automatic copy using
  `document.execCommand("copy")`;
- a scissors overlay briefly confirms the attempt.

There is no visible desktop Copy button. The automatic copy API is legacy and
its failure is silently ignored.

### Mobile selection

Touch selection is custom and rectangular:

1. Hold a primary touch for 525 ms without moving more than 12 px.
2. The device vibrates for 15 ms when supported.
3. Drag a cyan rectangle over terminal cells.
4. Release to extract the rectangular cell range from the currently visible
   terminal buffer.
5. A floating **Copy** button appears above a non-empty selection.
6. Copy uses `navigator.clipboard.writeText`; success shows a scissors overlay
   and clears the selection.

The extraction is rectangular rather than normal line-flow selection. It trims
each selected buffer line and then trims trailing whitespace from the combined
result. It operates against the current viewport rows.

### Paste paths

There are two current paste mechanisms:

- Clipboard support loaded into xterm through `@xterm/addon-clipboard`, using
  xterm's standard browser interactions.
- The explicit Input / Paste composer, which is the primary discoverable path
  on mobile.

There is no standalone Paste button in the web keyboard and no application
clipboard-history UI.

Relevant implementation:
[xterm/index.ts](../src/components/terminal/xterm/index.ts) and
[style/index.scss](../src/style/index.scss).

## 12. Visual language

The terminal input UI consistently uses:

- near-black backgrounds;
- cyan for primary controls and active states;
- green for live/status accents and Enter;
- magenta for composer/microphone accents;
- amber for latched modifiers and tmux-scroll status;
- pink/red for destructive or interrupt controls;
- monospace type, clipped corners, scanlines, glow, and grid textures.

Reduced-motion preference removes the major deployment and signal animations,
although transition effects on controls are not comprehensively disabled.

## 13. Accessibility inventory

Implemented:

- Launcher buttons and desktop toggle have accessible labels.
- Shortcut keys expose descriptive `title` and `aria-label` values when created
  from key definitions.
- Shift and Ctrl typing modifiers expose `aria-pressed`.
- Settings trigger exposes `aria-expanded`.
- Composer is labelled as a modal dialog.
- Visible focus treatments exist for most controls.
- Buttons use semantic `<button>` elements.

Current gaps or inconsistencies:

- Group tabs do not expose `aria-selected` or a tablist relationship.
- The active keyboard group is communicated visually but not as a formal
  selected state.
- The Ctrl section's fixed-key titles are descriptive, but several custom
  buttons such as Scroll and tmux-scroll Exit lack equivalent explicit
  accessible labels.
- The desktop `>_` prompt is hidden from assistive technology, leaving the
  button's accessible label as the correct name.
- The composer declares itself modal but does not trap focus or handle Escape.
- The mobile launcher group label says either button can be dragged, while the
  individual accessible labels mention only the action, not dragging.
- Automatic selection copying has no persistent screen-reader announcement.

## 14. Product-relevant implementation realities

These are the main facts a redesign should account for:

1. **The UI is form-factor-specific, not yet OS-specific.** iOS and Android are
   detected but currently behave the same.
2. **Desktop has no closed-state microphone control.** Reaching Input / Paste
   requires opening the corner keyboard control first.
3. **The mobile launcher is not a hover UI.** It is hidden on fine-pointer hover
   devices and is designed around tap and drag.
4. **Mobile native xterm input is deliberately disabled.** The web keyboard and
   composer are the only first-class mobile entry paths.
5. **Ctrl and Shift are one-shot, mutually exclusive modifiers.** They do not
   chord together and do not modify shortcut-group buttons or composer input.
6. **Shift is not a full symbol-shift implementation.** Symbols are explicit
   keys; Shift mainly uppercases letters, provides back-tab, and turns Enter
   into LF.
7. **tmux controls assume `Ctrl-B`.** They do not inspect or configure the
   remote tmux prefix.
8. **tmux-scroll is optimistic UI state.** The client does not know whether the
   remote tmux session actually entered copy mode.
9. **Settings are embedded inside the keyboard.** They are unavailable while
   the keyboard remains closed.
10. **Dictation is delegated to the OS keyboard.** There is no application
    microphone capture despite the microphone icon.
11. **Composer Close preserves drafts; Insert clears them.** This distinction is
    useful but not explained in the UI.
12. **The keyboard reclaims terminal height.** It is not merely layered over
    the terminal; opening and resizing it triggers an xterm fit.
13. **Desktop and mobile selection are intentionally different.** Desktop uses
    Shift-drag and auto-copy; mobile uses long-press rectangular selection and
    an explicit Copy button.
14. **Connection status decoration is not connection status.** Green dots in
    the keyboard and launcher are ornamental and remain green regardless of
    WebSocket state.

## 15. Source map

| Concern | Primary source |
|---|---|
| Terminal UI state and conditional controls | [terminal/index.tsx](../src/components/terminal/index.tsx) |
| Keyboard rendering and state | [keyboard-overlay/index.tsx](../src/components/keyboard-overlay/index.tsx) |
| Key definitions and byte mappings | [keys.ts](../src/components/keyboard-overlay/keys.ts) |
| Keyboard and desktop-toggle styling | [keyboard-overlay.scss](../src/components/keyboard-overlay/keyboard-overlay.scss) |
| Input / Paste behavior | [voice-composer/index.tsx](../src/components/voice-composer/index.tsx) |
| Input / Paste action semantics | [voice-composer/actions.ts](../src/components/voice-composer/actions.ts) |
| Mobile launcher behavior | [terminal-launcher/index.tsx](../src/components/terminal-launcher/index.tsx) |
| Launcher persistence and corner choice | [terminal-launcher/position.ts](../src/components/terminal-launcher/position.ts) |
| Native input, selection, paste, and WebSocket input | [xterm/index.ts](../src/components/terminal/xterm/index.ts) |
| Viewer/OS detection | [viewer-profile.ts](../src/viewer-profile.ts) |
| Native helper-input disabling | [touch-input.ts](../src/touch-input.ts) |
| Reconnect policy | [reconnect.ts](../src/reconnect.ts) |
