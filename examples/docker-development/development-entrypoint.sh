#!/bin/sh
set -eu

install -d -m 0755 /run/sshd
install -d -m 0700 -o node -g node /home/node/.ssh
install -m 0600 -o node -g node \
  /run/driftty/development.pub \
  /home/node/.ssh/authorized_keys
ssh-keygen -A

exec /usr/sbin/sshd -D -e
