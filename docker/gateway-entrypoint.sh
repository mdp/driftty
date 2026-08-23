#!/bin/sh
set -eu

exec bun run /opt/driftty/src/main.ts -- "$@"
