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

LABEL org.opencontainers.image.source="https://github.com/mdp/ttyd-mobile" \
      org.opencontainers.image.licenses="MIT"

COPY --from=web-client /src/dist/index.html /usr/share/ttyd/index.html
COPY docker/ttyd-entrypoint.sh /usr/local/bin/ttyd-mobile
RUN chmod 0755 /usr/local/bin/ttyd-mobile

EXPOSE 7681
ENTRYPOINT ["/usr/local/bin/ttyd-mobile"]
CMD ["sh"]

FROM oven/bun:1-alpine AS bun-runtime

FROM generic AS gateway

RUN apk add --no-cache caddy openssh-client libstdc++ libgcc
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /opt/ttyd-mobile
COPY gateway/package.json gateway/bun.lock ./
RUN bun install --production --frozen-lockfile
COPY gateway/src/ ./src/
COPY docker/gateway-entrypoint.sh /usr/local/bin/ttyd-mobile-gateway
COPY docker/keygen.sh /usr/local/bin/ttyd-mobile-keygen
RUN chmod 0755 /usr/local/bin/ttyd-mobile-gateway /usr/local/bin/ttyd-mobile-keygen

ENTRYPOINT ["/usr/local/bin/ttyd-mobile-gateway"]
CMD []

FROM gateway AS keygen
ENTRYPOINT ["/usr/local/bin/ttyd-mobile-keygen"]
