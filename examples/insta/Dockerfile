# Driftty gateway demo for InstaCloud: single-password login page + a tmux
# session pre-created inside the same container with the coding-agent windows.
#
# The coding agents are copied from the driftty demo image (which already has
# a working opencode + codex + claude + cline install on Alpine); this avoids
# re-resolving their dependency tree against npm at build time.
#
# Build remotely with `insta deploy <dir>` (no local Docker needed), or
# locally with `docker build -t <image> .` and deploy with `insta deploy
# --image <image>`.

# Demo image tag that contains the coding agents (insta = the multi-agent
# build; switch to edge once published from main).
ARG DEMO_IMAGE_TAG=insta
FROM ghcr.io/mdp/driftty-demo:${DEMO_IMAGE_TAG} AS agents

# Keep the npm bin shims as symlinks (Docker COPY dereferences single-file
# symlinks, which breaks the agents' platform-package resolution).
RUN mkdir -p /tmp/agents-bin \
    && cp -a /usr/local/bin/opencode /usr/local/bin/codex \
       /usr/local/bin/claude /usr/local/bin/cline /tmp/agents-bin/

FROM ghcr.io/mdp/driftty-gateway:edge

COPY --from=agents /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=agents /tmp/agents-bin/ /usr/local/bin/

# Node runs the agents' shims; the gateway image only ships Bun.
RUN apk add --no-cache nodejs npm bash git libc6-compat ripgrep \
    && mkdir -p /workspace

# Same mobile client, launcher menu, and agent workspace as the demo image.
COPY agent-menu.sh /usr/local/bin/driftty-agent-menu
COPY gateway-demo-entrypoint.sh /usr/local/bin/driftty-gateway-demo
RUN chmod 0755 /usr/local/bin/driftty-agent-menu /usr/local/bin/driftty-gateway-demo
COPY README.md /workspace/README.md

EXPOSE 7681
ENTRYPOINT ["/usr/local/bin/driftty-gateway-demo"]
CMD []