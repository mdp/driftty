# Architecture improvement plan

driftty has two product outcomes that must continue to reinforce each other:

1. A lightweight mobile terminal image that runs an arbitrary command.
2. An installable gateway image that inherits that exact terminal experience.

This plan follows the architecture review in
`/tmp/architecture-review-20260730-115350.html`. The order below reflects the
current working tree, where the report's original top two recommendations have
already been implemented.

## Current status

| Priority | Improvement | Status |
| --- | --- | --- |
| 1 | Own a terminal route from first request to final byte | Implemented, awaiting commit |
| 2 | Make both distribution contracts executable | Implemented, awaiting commit |
| 3 | Put the fixed mobile viewport behind one seam | Implemented, awaiting commit |
| 4 | Deepen the remote shell registry | Implemented, awaiting commit |
| 5 | Turn profile input into a gateway plan | Implemented, awaiting commit |
| 6 | Smoke-test an installed gateway bundle | Next |

## 1. Deepen the fixed mobile viewport

### Problem

The `Terminal` module owns fixed terminal sizing, persistence, pinch and
double-tap gestures, keyboard anchoring, transforms, and xterm resize timing.
The neighboring `viewport-size` module exposes the arithmetic but does not own
the behavior. As a result:

- mobile viewport changes require edits across both modules;
- gesture and keyboard interactions are difficult to verify together;
- behavior tests reach through private `Terminal` methods;
- the high-risk mobile behavior remains embedded in an 800-line module.

### Direction

Create one fixed mobile viewport module with a small behavior interface.
It will own:

- the selected automatic, preset, or custom terminal size;
- fixed surface measurement and transform state;
- pinch and double-tap gesture state;
- fit, clamp, and keyboard-bottom anchoring behavior;
- persistence of the selected size;
- scheduling the matching xterm fixed-size change.

The `Terminal` module will keep general browser viewport measurement, page
layout, and rendering. It will delegate fixed-size actions to the new module
and render the view state returned through the seam.

### Delivery slices

1. Describe the behavior through tests at the fixed mobile viewport interface.
2. Move size selection, measurement, transform, and xterm timing behind it.
3. Move pointer gesture and double-tap behavior behind it.
4. Move keyboard anchoring behind it.
5. Replace tests that cast through private `Terminal` methods.

### Acceptance criteria

- Existing automatic and fixed terminal behavior is unchanged.
- Preset and custom sizes still persist across reloads.
- Pinch zoom keeps the gesture center anchored and clamps the surface.
- Double-tap and desktop double-click fit a fixed surface without affecting
  selection in automatic mode.
- Opening either keyboard keeps a fixed terminal anchored to the bottom.
- Tests exercise these outcomes through the new module's public interface.
- `Terminal` no longer owns fixed viewport gesture state or transform math.
- The production build remains a single `dist/index.html`.

## 2. Deepen the remote shell registry

### Direction

Give each session-routed profile one remote shell registry. The registry owns
tmux discovery, ownership rules, fixed and managed shell creation, shell
quoting, output parsing, attachment commands, and the representation of fixed
shells that are not currently running.

SSH execution remains an adapter at the registry seam. Terminal routing
receives ready attachment commands and does not learn tmux or profile policy.

### Acceptance criteria

- Registry behavior is testable without a live SSH server.
- Discovery filters out remote tmux sessions the gateway does not own.
- Missing fixed shells appear in picker results and can be started by slug.
- Managed shell naming, uniqueness, and limits remain enforced.
- Shell quoting and malformed discovery output are covered through registry
  behavior tests.
- The gateway runtime no longer coordinates fixed-shell reconciliation itself.

## 3. Turn profile input into a gateway plan

### Direction

Keep YAML parsing, validation, defaults, key resolution, and routing-mode
selection at configuration intake. Produce a gateway plan with:

- safe presentation facts for picker rendering;
- resolved SSH targets for connection adapters;
- direct-shell instructions;
- remote-shell-registry instructions;
- indexed lookup by public profile slug.

### Acceptance criteria

- Invalid combinations are rejected before runtime startup.
- Key paths, labels, ports, routing mode, and default session policy are
  resolved exactly once.
- Picker rendering receives no host credentials or key paths.
- Direct terminal routing receives a ready SSH command.
- Session policy crosses only into its remote shell registry.
- Tests assert plan outcomes rather than intermediate YAML parsing details.

## 4. Smoke-test an installed gateway bundle

Extend CI to assemble and unpack a versioned gateway bundle, validate its
pinned image tag, start its Compose shape with controlled fixtures, and verify
the picker and a routed terminal. This complements the existing image-lineage
check with proof of the installation outcome.

## Sequencing rules

- Preserve the lightweight image and gateway inheritance contracts throughout.
- Finish one seam and its behavior tests before starting the next.
- Prefer tests through module interfaces over tests of private implementation.
- Keep compatibility storage keys unless an explicit migration is introduced.
- Re-run the single-file build assertion after client architecture changes.
