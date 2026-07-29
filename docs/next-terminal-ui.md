# Next Terminal UI

**Status:** Product specification for prototype and implementation  
**Updated:** 2026-07-27  
**Scope:** Terminal input and terminal-level application controls on mobile,
tablet, and desktop  
**Companion:** [Current Terminal Input UI](./current-terminal-input-ui.md)
documents the existing implementation

## 1. Decision summary

The next UI will stop treating the custom web keyboard as the center of the
product.

The product is primarily a remote control for long-running coding agents and
tmux workspaces. Most mobile interactions are Escape, navigation, Tab, Enter,
slash commands, and tmux scrolling. Longer text is usually dictated, pasted,
or edited before it is sent. Desktop users already have a physical keyboard.

The new UI has three distinct surfaces:

1. **Quickbar** — persistent, one-tap terminal actions on touch devices.
2. **Composer** — native text entry for prompts, commands, paste, and OS
   dictation.
3. **Terminal menu** — sessions, settings, connection controls, secondary
   terminal actions, and access to the legacy web keyboard.

On mobile, the Quickbar is the default control surface and the Terminal menu is
a bottom sheet. On desktop, the Quickbar is absent and the Terminal menu is a
small popover opened from the upper-right corner control.

The custom QWERTY keyboard remains available as a fallback for one release. It
is not the default on any device.

## 2. Goals

The next version must make these workflows excellent:

- stop an agent immediately;
- answer an agent questionnaire;
- enter and complete a slash command;
- move through shell history;
- enter and exit tmux scroll mode;
- dictate, review, and send a prompt;
- type a short shell command using the native keyboard plus terminal keys;
- return to the host/session router without ending the current tmux session;
- reach settings without opening a keyboard;
- use a physical keyboard on desktop without UI interference.

The redesign succeeds when the terminal remains the dominant surface and the
user rarely needs the full web keyboard.

## 3. Non-goals

This version will not:

- change the terminal renderer;
- change tmux session persistence;
- redesign the host/session router;
- change profile authorization, routing, or token handling;
- implement application-owned speech recognition;
- infer which program is running from terminal output;
- generate commands with AI;
- replace the WebSocket transport;
- reproduce a complete physical keyboard on glass;
- add unrestricted Quickbar customization.

## 4. Product model

### 4.1 The four user activities

#### Supervise

The terminal is primarily output. The user stops an agent, answers a prompt,
navigates a choice, or enters tmux scroll mode. This is the dominant mobile
activity and must not require opening a sheet or keyboard.

#### Compose

The user dictates, types, pastes, and edits a prompt before it reaches the
terminal. This requires a normal operating-system text field, not a synthetic
QWERTY keyboard.

#### Command

The user types a shell command or slash command. The native keyboard handles
letters; the product supplies Escape, Tab, slash, arrows, Ctrl, and other
terminal-specific input.

#### Manage

The user changes sessions or settings, reconnects, or accesses uncommon
terminal actions. These are application controls and belong in a menu, not in a
keyboard group.

### 4.2 Surface ownership

Each action has one primary home:

| Need | Primary surface | Secondary access |
|---|---|---|
| Stop, navigate, Tab, Enter, slash, scroll | Quickbar | Terminal menu |
| Type, paste, dictate, review text | Composer | — |
| Switch sessions | Terminal menu | — |
| Settings and connection | Terminal menu | — |
| Uncommon terminal/tmux/Ctrl keys | Terminal menu | Legacy keyboard |
| Physical typing | Terminal/xterm | Composer when explicitly focused |

Duplicating a high-frequency action such as Escape or Scroll is acceptable.
Duplicating navigation and settings across unrelated surfaces is not.

## 5. Design principles

### Frequency before completeness

Controls earn permanent space through repeated use. Escape and Scroll are more
important than function keys or pane splitting.

### Native composition, terminal-specific supplements

Use the iOS or Android keyboard for letters, selection, autocorrect, clipboard,
and dictation. Add the terminal keys it lacks. Do not rebuild QWERTY.

### One tap for urgent actions

Escape, directional navigation, Enter, Tab, and Scroll must be available from
the closed mobile state.

### Preserve context

Opening a control should cover only as much terminal output as the task needs.
The current prompt and recent output should remain visible whenever practical.

### Stable positions beat speculative adaptation

Controls must not rearrange themselves based on terminal output. A user may
select an Agent or Shell preset, but the UI will not guess the active program.

### Explicit transmission

The interface must distinguish inserting text, sending text with Enter, and
sending a terminal control sequence. No icon should hide a consequential
difference.

### Honest state

Connection and tmux-mode indicators must reflect known state. When the client
cannot verify remote state, the copy must describe an action rather than claim
a condition.

### Capability over user-agent

Layout should consider viewport size, coarse/fine pointer, hover, software
keyboard visibility, and recent physical-keyboard use. iOS and Android share
the product model but require separate viewport and focus testing.

## 6. Mobile architecture

```text
Terminal
├── Quickbar (closed/default state)
├── Composer
│   ├── native text area
│   ├── terminal supplement row
│   └── Insert / Send
└── Terminal menu
    ├── current session and All terminals
    ├── terminal actions
    ├── tmux actions
    ├── Ctrl actions
    ├── settings and connection
    └── legacy web keyboard
```

Only one of Composer, Terminal menu, or legacy keyboard may be open at once.
The Quickbar remains visible in a compact form above the software keyboard but
is hidden behind the Terminal menu and legacy keyboard.

## 7. Mobile Quickbar

### 7.1 Default layout

The compact control surface has a horizontally scrollable section rail:

```text
[Agent] [Nav] [tmux] [Ctrl] → [More]
```

`More` is the final rail item and opens the Terminal menu. The selected
section supplies the horizontally scrollable shortcut strip below it. The
default Agent strip is:

```text
[Esc] [↑] [↓] [Tab] [/] [Enter] →  [Keyboard] [Compose]
```

The section rail and shortcut strip scroll independently. Keyboard and Compose
remain fixed at the right edge while shortcuts pass beneath their masked
surface. This gives later sections and shortcuts room without shrinking their
labels. A hidden scrollbar must not prevent touch panning.

Why Enter is present: questionnaires commonly require a selection to be
confirmed, and opening a keyboard merely to confirm it defeats the Quickbar.
Space remains in the Terminal menu for prompts that require toggling an option.

### 7.2 Placement

The Quickbar is docked to the bottom safe area:

- it spans the available width;
- it does not drag or float;
- it sits above browser chrome and safe-area insets;
- it sits above the software keyboard when that keyboard is visible;
- it causes xterm to fit the remaining viewport rather than overlaying the
  active terminal line.

Every target is at least 44 × 44 CSS pixels. Visible keycaps may be smaller.

### 7.3 Collapsing

Phase 1 does not include a manually collapsed Quickbar. The implementation may
revisit collapse only after measuring the default bar on small screens.

### 7.4 Agent and Shell presets

Phase 1 ships only the default Agent layout. Phase 2 may add a manual Shell
preset:

```text
[Esc] [Tab] [↑] [↓] [←] [→] [Ctrl] [Type] [More]
```

Changing presets is explicit and persisted per browser. Presets never change
automatically. Constrained reordering is a later enhancement, not part of this
release.

### 7.5 Key behavior

Quickbar actions send their terminal sequence immediately on activation.

- `Esc`, arrows, `Tab`, and `Enter` send the existing sequences.
- `/` sends `/` to the terminal when Composer is closed.
- `Scroll` sends the configured tmux prefix followed by `[`.
- `Compose` opens Composer without sending input.
- `More` opens Terminal menu without sending input.

Pointer-down must not cause xterm's helper input or the software keyboard to
open. One gesture must result in exactly one terminal transmission.

### 7.6 Scroll behavior

Scroll is an action, not an authoritative mode indicator in Phase 1. Tapping it:

1. sends the tmux copy-mode sequence;
2. replaces the middle of the Quickbar with scroll controls;
3. labels the active action set **Scroll controls**, not **Scrolling**.

Scroll controls are:

```text
[Esc] [↑] [↓] [PgUp] [PgDn] [Exit] [Compose] [More]
```

`Exit` sends `q` and restores the default Quickbar. `Esc` sends Escape and also
restores the default Quickbar. Because the client cannot currently verify tmux
copy mode, leaving it by another terminal action may temporarily desynchronize
the UI. Opening More must always offer **Reset Quickbar**.

Phase 2 may reconcile copy-mode state if the gateway can provide reliable tmux
state. Until then, the UI must not claim that copy mode is definitely active.

## 8. Composer

### 8.1 Purpose

Composer is the sole first-class mobile surface for text entry. It supports:

- native typing;
- operating-system dictation;
- operating-system or Clipboard API paste;
- selection and editing before transmission;
- multiline prompts and commands.

The application does not record audio. A microphone icon must never imply that
tapping it begins recording.

### 8.2 Opening and layout

Composer opens as a bottom sheet sized to the software keyboard and its
content. It focuses a standard multiline text area and requests the native
keyboard.

```text
┌ Compose ─────────────── Draft saved [Close] ┐
│ Ask the agent…                             │
│                                            │
├ [Esc] [Tab] [/] [↑] [↓] [Ctrl] [Paste] ───┤
│ [Clear]                    [Insert] [Send] │
└────────────────────────────────────────────┘
```

The header says **Compose** in Phase 1. Prompt and Command labels may accompany
presets in Phase 2.

### 8.3 Terminal supplement row

Controls in this row have deliberately different destinations:

| Control | Behavior while Composer is focused |
|---|---|
| `/` | Insert `/` at the text cursor |
| `Paste` | Paste into the text area, never directly into xterm |
| `Esc`, `Tab`, arrows | Send the terminal sequence without altering the draft |
| `Ctrl` | Open or arm the Ctrl picker; do not modify text-area typing |

Terminal-directed keys keep Composer open and preserve its draft. This allows
the user to interrupt or navigate an agent without losing composed text.

If clipboard permission is unavailable, `Paste` explains that the standard
long-press paste menu should be used. Permission failure is not presented as a
terminal error.

### 8.4 Insert and Send

The actions are:

- **Insert** — paste the draft through xterm without Enter.
- **Send** — paste the draft through xterm, then send one Enter.

Both actions close Composer and clear the draft only after the terminal accepted
the client-side paste/send call without an immediate error. This does not imply
remote acknowledgement. `Insert` is secondary and `Send` is primary in Phase
1. Empty Insert is disabled. Empty Send is allowed and sends Enter, matching the
current behavior.

The labels must remain visible. A paper plane, return arrow, or clipboard icon
alone is not sufficiently precise.

### 8.5 Newlines and paste semantics

- Enter in the text area creates a newline.
- Send transmits the complete draft, followed by exactly one Enter.
- Insert transmits the complete draft without appending input.
- xterm's paste path and remote bracketed-paste behavior remain intact.
- No multiline confirmation is added in Phase 1.

The product must document that multiple shell-command lines may execute when
inserted or sent to a shell. Adding a generic confirmation would punish the
dominant multiline-agent workflow and would still be unreliable without
knowing the active terminal program.

### 8.6 Draft lifecycle

- Closing Composer preserves the draft.
- Reopening Composer in the same terminal restores it.
- A dot on Compose and the accessible label **Compose, draft available**
  indicate a non-empty draft.
- Successful Insert or Send clears the draft.
- Clear requires one confirmation when the draft is non-empty.
- Drafts use `sessionStorage`, keyed by terminal route.
- Drafts survive reload in the same tab but not a new browser session.
- Draft text must never appear in analytics, logs, URLs, or router state.

### 8.7 Closing and focus

Close is a full 44 px target in the Composer header. It preserves the draft and
closes the native keyboard.

After closing:

- touch devices return to terminal view without programmatically opening the
  native keyboard;
- desktop returns focus to xterm;
- opening Composer again restores text-area focus and selection when possible.

## 9. Mobile Terminal menu

### 9.1 Structure

More opens a bottom sheet with a compact initial detent and an expandable
full-height detent:

```text
Aachen / mdp
[All terminals]

Terminal
  [Space] [Home] [End] [PgUp] [PgDn] [Ins] [Del]

tmux
  [Scroll] [Previous] [Next] [New] [Detach] [Prefix]
  [Reset Quickbar]

Control
  [Ctrl] [C] [D] [L] [R] [S] [T] […]

Connection & settings
  Connection: Connected
  [Reconnect]
  Auto reconnect                          [on]

Advanced
  [Full terminal keyboard]
```

The current host and session provide orientation. **All terminals** is the
first action because it is the most common application-level destination.

### 9.2 Navigation

All terminals navigates to the router without killing or detaching the
tmux-backed session beyond the behavior already required by routing. Returning
to the session route reattaches through the existing session model.

### 9.3 Terminal actions

The Terminal section holds valid but less frequent keys. Space is here because
some agent questionnaires use it. Terminal actions transmit immediately and
keep the sheet open unless the action naturally requires terminal inspection;
Escape closes the sheet instead of reaching the terminal while focus is inside
application chrome.

A visible **Send Escape to terminal** action must therefore exist inside the
Terminal section. This resolves the otherwise ambiguous conflict between
dismissing the sheet and interrupting the terminal.

### 9.4 Ctrl

Phase 1 retains the current curated, one-tap Ctrl combinations. Tapping `C`
sends Ctrl-C immediately; it does not type `c`.

A generic `Ctrl` button arms a one-shot modifier for the next compatible
Terminal-menu or Quickbar key. The armed state:

- is labeled **Ctrl armed**;
- uses shape/text as well as color;
- is announced through an ARIA live region;
- cancels on a second tap, sheet dismissal, route change, or successful use;
- expires after 10 seconds of inactivity.

It does not modify typing in the Composer text area. Modifier locking and
multi-modifier chords are not part of Phase 1.

### 9.5 tmux

tmux controls use readable action labels. Phase 1 continues to use the current
Ctrl-B prefix but centralizes it behind one action builder so it can become
profile-configurable later.

Scroll appears in both Quickbar and tmux. Previous, Next, New, Detach, and
Prefix belong only in Terminal menu. Pane split and zoom may remain in Advanced
or the legacy keyboard rather than competing for first-level space.

### 9.6 Settings and connection

Settings are application controls, not a keyboard page. Phase 1 includes:

- actual WebSocket connection state in text;
- manual reconnect when disconnected;
- auto reconnect;
- entry to the host/session router;
- the legacy web keyboard.

Do not show a decorative connected dot. Color may reinforce connection state
but cannot be its only representation. Font size and appearance controls should
only be added when their behavior exists and is tested.

### 9.7 Dismissal

The sheet closes on:

- downward swipe beyond its dismissal threshold;
- tapping the backdrop;
- the explicit Close control;
- route change.

Browser Back closes the sheet before navigating away. A swipe beginning in
terminal content must never accidentally open the sheet.

## 10. Legacy web keyboard

The current custom keyboard remains available at:

**Terminal menu → Advanced → Full terminal keyboard**

For the transition release:

- all current keyboard groups and key mappings remain available;
- the legacy keyboard never opens automatically;
- closing it returns to the new default state;
- Settings and All terminals are removed from its group rail once the Terminal
  menu equivalents exist;
- on desktop it is centered with a maximum width of 720 px;
- its mobile layout receives only regression fixes, not further expansion.

Removal can be considered after the native Composer and supplement keys have
been validated on supported iOS and Android versions. It may be removed only
when every current terminal sequence remains reachable elsewhere or is
explicitly declared obsolete.

## 11. Desktop architecture

### 11.1 Default state

Desktop has no Quickbar. xterm owns ordinary keyboard input, mouse input, and
focus.

The existing 24 px solid triangle remains in the upper-right as the resting
entry point. It is renamed conceptually from a keyboard launcher to **Open
terminal menu**. Hover or keyboard focus reveals a compact `>_` menu button.
The control must not imply that clicking changes typing mode.

### 11.2 Terminal menu

Clicking the corner control opens a 280–360 px popover:

```text
Aachen / mdp
Connection: Connected

[All terminals]
[Compose / Paste]

Connection
  [Reconnect]
  Auto reconnect                         [on]

Advanced
  [Full terminal keyboard]
```

Desktop does not show the touch-oriented terminal key grids by default. A
physical keyboard already supplies those actions.

The popover:

- closes on outside click, explicit Close, route change, or a second corner
  click;
- closes on Escape when focus is within the popover;
- traps focus only while keyboard navigation is occurring;
- returns focus to xterm after dismissal;
- does not resize the terminal.

### 11.3 Desktop Composer

Compose / Paste opens the same Composer model in a constrained popover or side
panel, no wider than 560 px. It does not open a full-width bottom keyboard.

While the text area is focused, physical typing belongs to Composer. Otherwise,
physical typing belongs to xterm. Insert, Send, draft recovery, clipboard
handling, and multiline semantics match mobile.

### 11.4 Desktop selection and mouse input

The redesign must preserve:

- ordinary mouse input for tmux and mouse-aware programs;
- Shift-drag terminal text selection;
- existing right-click behavior;
- terminal focus after application chrome closes.

The corner hit area must not overlap the terminal scrollbar or capture mouse
events outside its visible 24 px target.

## 12. Tablet and hardware keyboard

Tablet behavior follows input capability:

- coarse pointer with no recent physical-keyboard input uses mobile Quickbar;
- physical-keyboard input collapses touch chrome to the desktop-style menu;
- touch targets remain 44 px even in minimal mode;
- disconnecting a keyboard restores the Quickbar without reloading.

Because keyboard presence APIs are inconsistent, Phase 1 may use a simple
**Touch controls: Auto / Always / Minimal** preference. Auto should consider
recent keyboard events, pointer capability, hover, and viewport width. It must
not classify an iPad permanently from its user-agent.

## 13. State and focus model

The top-level UI state is exclusive:

```text
terminal
  ├─ open Compose ───────> composer
  ├─ open More ──────────> terminal-menu
  └─ open fallback ──────> legacy-keyboard

composer
  ├─ close/insert/send ──> terminal
  └─ open More ──────────> terminal-menu

terminal-menu
  ├─ close ──────────────> terminal
  ├─ compose ────────────> composer
  └─ fallback ───────────> legacy-keyboard

legacy-keyboard
  └─ close ──────────────> terminal
```

Rules:

- only one overlay surface is mounted as active;
- terminal transmission never depends on a visual animation completing;
- route change closes every surface;
- reconnect does not discard a Composer draft;
- software-keyboard visibility is derived from viewport/focus signals, not a
  hard-coded timeout;
- terminal fitting occurs after measured layout changes;
- no application button focuses xterm on pointer-down;
- after a desktop surface closes, xterm focus is restored once;
- after a mobile surface closes, xterm is not programmatically focused.

## 14. Visual and interaction language

- The terminal remains visually dominant.
- Use the existing dark/cyan language for neutral terminal controls.
- Reserve magenta for Compose and draft-related affordances.
- Use green only for verified connected state.
- Use amber for armed or caution states, accompanied by text/shape.
- Use red only for destructive or interrupt actions such as Ctrl-C.
- Prefer `Esc`, `Tab`, `Ctrl`, and `Scroll` labels over novel icons.
- Every touch target is at least 44 px.
- Every interactive control has visible hover, pressed, focus, and disabled
  states where applicable.
- Active and selected states cannot rely on color alone.
- Motion honors `prefers-reduced-motion`.
- Sheets and popovers use short, functional transitions; terminal actions do
  not wait for them.

## 15. Accessibility

Phase 1 must provide:

- a logical focus order;
- accessible names for every control;
- `aria-pressed` for armed/toggled controls;
- an ARIA live announcement for connection changes and Ctrl armed/cancelled;
- no focusable controls hidden behind a closed sheet;
- at least 44 px touch targets;
- text in addition to color for connection and state;
- correct sheet/popover dialog semantics;
- focus restoration on desktop;
- no forced focus into xterm on mobile;
- screen-reader names that state transmission effects, such as **Insert without
  Enter** and **Send with Enter**.

Escape behavior must be contextual:

- inside a menu, popover, or Composer, Escape closes that application surface;
- in the normal terminal state, Escape is sent to the terminal;
- the menu includes an explicit Send Escape action for interrupting the
  terminal without first dismissing it.

## 16. Required non-regressions

- Escape sends immediately from the normal terminal state.
- Shift+Enter sends LF/Ctrl-J, not plain Enter.
- Tab, Enter, arrows, and control sequences work in shells, tmux, and coding
  agents.
- Desktop Shift-drag selection continues to work.
- Mobile long-press selection does not conflict with Quickbar or sheet
  gestures.
- Right-click behavior remains intact.
- Composer paste uses xterm's paste path.
- Insert never appends Enter.
- Send appends exactly one Enter.
- Opening and closing chrome refits the terminal without losing the bottom
  prompt.
- UI actions do not cause duplicate terminal input.
- Reconnect state comes from the real WebSocket lifecycle.
- A route change never leaks a draft into a different terminal route.

## 17. Release plan

### Phase 1A — hierarchy and desktop menu

1. Introduce the shared Terminal menu model.
2. Change the desktop corner control to open the compact menu.
3. Move All terminals, auto reconnect, connection state, and reconnect into
   Terminal menu.
4. Keep Full terminal keyboard under Advanced.
5. Constrain the legacy keyboard width on desktop.

This is the lowest-risk slice and fixes desktop without changing terminal input.

### Phase 1B — mobile Quickbar

1. Replace the draggable mobile launcher with the docked Quickbar.
2. Implement default and Scroll-controls layouts.
3. Add Terminal menu as a mobile bottom sheet.
4. Route existing key sequences through shared terminal actions.
5. Preserve the legacy keyboard as the Advanced fallback.

### Phase 1C — Composer

1. Promote Input / Paste to Composer.
2. Rename actions Insert and Send.
3. Add the terminal supplement row.
4. Preserve drafts in route-keyed `sessionStorage`.
5. Implement exact focus and software-keyboard behavior.
6. Add mobile and desktop Composer presentations.

### Phase 2 — refinement

1. Add Agent and Shell presets.
2. Add Touch controls Auto / Always / Minimal if required.
3. Make tmux prefix profile-configurable.
4. Explore reliable tmux copy-mode reconciliation.
5. Evaluate constrained Quickbar reordering.
6. Decide whether legacy QWERTY still earns a place.

## 18. Phase 1 acceptance criteria

### Mobile

- The closed state exposes section choices, a horizontally scrollable shortcut
  strip, and fixed Keyboard and Compose actions.
- Escape, navigation, and Scroll require one tap.
- Keyboard and Compose remain visible while the shortcut strip scrolls beneath
  them.
- Primary targets are at least 44 × 44 px.
- Compose opens a native multiline text area suitable for OS dictation.
- Insert and Send have visible labels and distinct, tested behavior.
- Closing Composer preserves the route-specific draft.
- More exposes All terminals, Space, secondary terminal actions, tmux, Ctrl,
  settings, connection, and the legacy keyboard.
- The software keyboard can be dismissed through a full-size control.
- The terminal remains fitted above visible controls and the software keyboard.

### Desktop

- The corner affordance opens Terminal menu, not the keyboard.
- All terminals, Compose / Paste, connection, and settings are reachable from
  the menu.
- xterm receives physical input unless Composer or another application control
  owns focus.
- Composer does not span the full desktop width.
- The fallback keyboard is explicitly requested and no wider than 720 px.
- Shift-drag selection and right-click continue to work.

### Both

- UI connection copy reflects actual WebSocket state.
- Every control has an accessible name and visible focus state.
- The top-level overlay states are mutually exclusive.
- Escape behavior matches the focus rules.
- Terminal fit, focus, selection, paste, Shift+Enter, reconnect, draft
  isolation, and duplicate-input prevention have regression coverage.

## 19. Prototype questions

These require hands-on testing but do not block Phase 1:

1. Can all nine Quickbar actions remain understandable at the narrowest
   supported portrait width, or should its center section scroll?
2. Is Enter used often enough to remain pinned, or should Space replace it?
3. Does the Scroll-controls layout remain synchronized well enough without
   gateway-provided tmux state?
4. Should Composer use a compact sheet or expand to a larger detent while
   dictating and editing long prompts?
5. Does Send deserve to be the primary Composer action for shell-heavy users?
6. Is Auto tablet detection reliable enough, or is a visible Touch controls
   preference necessary?
7. Which legacy web-keyboard actions are still used after one release?

Prototype answers should change slot order or presentation, not reopen the
three-surface architecture.

## 20. Validation matrix

Test at minimum:

| Platform | Input | Orientation / viewport | Critical checks |
|---|---|---|---|
| iPhone Safari | touch + OS keyboard | portrait and landscape | safe area, dictation, focus, viewport resize |
| Android Chrome | touch + OS keyboard | portrait and landscape | keyboard resize, Back behavior, paste |
| iPad Safari | touch | portrait and split view | Quickbar fit, sheets, selection |
| iPad Safari | hardware keyboard + trackpad | full and split view | capability switch, focus, mouse |
| Desktop Chrome | keyboard + mouse | common laptop size | popover, selection, right-click |
| Desktop Firefox | keyboard + mouse | common laptop size | focus, clipboard fallback, WebSocket state |
| Narrow desktop window | keyboard + mouse | mobile-like width | capability rules, no false mobile keyboard |

Each platform must exercise:

- agent interruption;
- questionnaire navigation;
- tmux Scroll and exit;
- slash-command entry;
- multiline Compose → Send;
- Compose → Insert;
- draft dismissal and reload recovery;
- session route change and draft isolation;
- disconnect, reconnect, and auto reconnect;
- legacy keyboard entry and exit.

## 21. Competitive context

The direction borrows proven patterns without copying a general SSH client:

- Termius separates customizable shortcut controls from Paste mode and
  recommends Paste mode plus OS dictation for mobile coding-agent prompts:
  [AI agents on mobile](https://termius.com/blog/8-tips-for-using-ai-agents-on-mobile-in-termius).
- Termius places special symbols, signals, history, and customization in an
  extended surface rather than keeping every key visible:
  [Touch terminal on iOS](https://termius.com/blog/new-touch-terminal-on-ios).
- Blink places terminal modifiers and extra keys above the OS keyboard and
  treats settings and shell navigation as application controls:
  [Blink Shell documentation](https://docs.blink.sh/).
- Mosh demonstrates the importance of immediate feedback and honest stale or
  disconnected state on mobile networks:
  [Mosh](https://mosh.org/).

The product opportunity is more specific: build for agent supervision and tmux
first, with shell entry as a supported but secondary mobile activity.

## 22. Final product test

The qualitative test is:

> On mobile, this should feel like a remote control for a live agent and tmux
> workspace that can also type—not like a miniature desktop keyboard covering
> a terminal.

On desktop, application controls should be quietly available without changing
how the terminal, physical keyboard, selection, or mouse already work.
