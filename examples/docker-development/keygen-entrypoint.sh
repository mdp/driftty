#!/bin/sh
set -eu

/usr/local/bin/driftty-keygen "$@"

slug=${1:?profile slug is required}
chown "${DEV_UID:-1000}:${DEV_GID:-1000}" "/keys/$slug" "/keys/$slug.pub"
