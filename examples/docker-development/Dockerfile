FROM oven/bun:1 AS bun

FROM node:24-bookworm

ARG DEV_UID=1000
ARG DEV_GID=1000

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      openssh-server \
      ripgrep \
      sudo \
      tmux \
      vim \
    && rm -rf /var/lib/apt/lists/* \
    && groupmod --gid "${DEV_GID}" node \
    && usermod --uid "${DEV_UID}" --gid "${DEV_GID}" node \
    && usermod --shell /bin/bash node \
    && chown -R node:node /home/node \
    && printf 'node ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/node \
    && chmod 0440 /etc/sudoers.d/node

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

COPY development-entrypoint.sh /usr/local/bin/development-entrypoint
RUN chmod 0755 /usr/local/bin/development-entrypoint

WORKDIR /workspace
EXPOSE 22
ENTRYPOINT ["/usr/local/bin/development-entrypoint"]
