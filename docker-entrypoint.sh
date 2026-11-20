#!/bin/sh
# Start as root only long enough to hand the writable bind mounts to the unprivileged
# `node` user, then drop privileges. Read-only mounts (media-mount, uptime-kuma-data)
# are skipped. Existing deployments owned by root migrate themselves on first start.
set -e
if [ "$(id -u)" = "0" ]; then
  for p in /app/data /app/.env /app/kometa-config; do
    [ -e "$p" ] && [ -w "$p" ] && chown -R node:node "$p" 2>/dev/null || true
  done
  exec su-exec node "$@"
fi
exec "$@"
