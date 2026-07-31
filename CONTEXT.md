# driftty

driftty provides a mobile-first web terminal as a lightweight image and as
the terminal experience embedded in an installable SSH gateway.

## Language

**Mobile terminal image**:
The lightweight, general-purpose image containing the complete driftty
terminal experience and capable of running an arbitrary command.
_Avoid_: Generic image, base image

**Gateway image**:
The SSH gateway image that inherits the complete mobile terminal image and adds
gateway capabilities.
_Avoid_: Universal image, standalone gateway

**Demo image**:
A configured derivative of the mobile terminal image for trying driftty locally
with an Alpine workspace, one tmux session, and a terminal coding agent.
_Avoid_: Agent image, third deployment mode

**Gateway bundle**:
A versioned, ready-to-configure installation package for the gateway image and
its required supporting processes. A bundle corresponds to one gateway release.
_Avoid_: Latest bundle, universal image

**Terminal route**:
The gateway association between a public shell URL and one live terminal
process. A terminal route may open a direct remote shell or attach to a remote
tmux session.
_Avoid_: Session proxy, Caddy route

**Fixed mobile viewport**:
A mobile terminal presentation with stable terminal columns and rows whose
surface can be scaled and positioned independently of the browser viewport.
_Avoid_: Fixed terminal, Zoom mode

**Gateway plan**:
The validated, fully resolved set of direct-shell and remote-shell-registry
instructions produced from gateway configuration.
_Avoid_: Profile list, Parsed YAML

**Remote shell registry**:
The gateway's view of the remote tmux shells it owns for one configured host,
including their discovery, creation, attachment, and availability.
_Avoid_: Session helper, tmux wrapper
