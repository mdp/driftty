FROM node:24-alpine AS web-client

WORKDIR /src
COPY package*.json ./
RUN npm ci
COPY src/ ./src/
COPY index.html tsconfig.json vite.config.ts ./
RUN npm run build

FROM node:24-alpine AS web-development

WORKDIR /src
COPY package*.json ./
RUN npm ci

FROM tsl0922/ttyd:alpine AS generic

LABEL org.opencontainers.image.source="https://github.com/mdp/driftty" \
      org.opencontainers.image.licenses="MIT"

COPY --from=web-client /src/dist/index.html /usr/share/ttyd/index.html
COPY docker/ttyd-entrypoint.sh /usr/local/bin/driftty
RUN chmod 0755 /usr/local/bin/driftty

EXPOSE 7681
ENTRYPOINT ["/usr/local/bin/driftty"]
CMD ["sh"]

FROM generic AS demo

ARG OPENCODE_VERSION=1.18.10
ARG CLINE_VERSION=3.0.49
ENV OPENCODE_VERSION=${OPENCODE_VERSION}
ENV CLINE_VERSION=${CLINE_VERSION}

RUN apk add --no-cache bash git libc6-compat nodejs npm ripgrep tmux \
    && npm install --global \
      "opencode-ai@${OPENCODE_VERSION}" \
      "cline@${CLINE_VERSION}" \
    && npm cache clean --force \
    && adduser -D -s /bin/bash demo \
    && mkdir -p /workspace \
    && chown demo:demo /workspace

COPY docker/demo-entrypoint.sh /usr/local/bin/driftty-demo
COPY --chown=demo:demo docker/demo.bash_profile /home/demo/.bash_profile
COPY --chown=demo:demo README.md /workspace/README.md
RUN chmod 0755 \
    /usr/local/bin/driftty-demo

ENV HOME=/home/demo
WORKDIR /workspace
USER demo

EXPOSE 7117
ENTRYPOINT ["/usr/local/bin/driftty-demo"]
CMD []

FROM oven/bun:1-alpine AS bun-runtime

FROM generic AS gateway

RUN apk add --no-cache caddy openssh-client libstdc++ libgcc
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /opt/driftty
COPY gateway/package.json gateway/bun.lock ./
RUN bun install --production --frozen-lockfile
COPY gateway/src/ ./src/
COPY docker/gateway-entrypoint.sh /usr/local/bin/driftty-gateway
COPY docker/keygen.sh /usr/local/bin/driftty-keygen
RUN chmod 0755 /usr/local/bin/driftty-gateway /usr/local/bin/driftty-keygen

ENTRYPOINT ["/usr/local/bin/driftty-gateway"]
CMD []

FROM gateway AS keygen
ENTRYPOINT ["/usr/local/bin/driftty-keygen"]
