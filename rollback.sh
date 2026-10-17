#!/usr/bin/env bash
# Switch the live Marquee back to an earlier version's image: ./rollback.sh v1.64.3
# ./rollback.sh with no argument lists the versions you can go back to (deploy.sh keeps the newest 20).
# Rolls back the app code only: data/ (sessions, alerts, settings in .env) is shared, so a version that
# changed a database's shape may not love older code — check What's new for the versions being skipped.
# The next ./deploy.sh rebuilds from the working tree, which puts the newest version back.
set -euo pipefail
HOST=hosted
DEST=/mnt/docker/skyn3t
if [ $# -eq 0 ]; then
  echo "Versions you can roll back to (newest first):"
  ssh "$HOST" "docker images skyn3t-marquee --format '{{.Tag}}  {{.CreatedSince}}' | grep '^v' | sort -rV"
  exit 0
fi
tag="$1"; [[ "$tag" == v* ]] || tag="v$tag"
ssh "$HOST" "docker image inspect skyn3t-marquee:$tag >/dev/null 2>&1" || { echo "No saved image for $tag (run ./rollback.sh to list)." >&2; exit 1; }
echo "==> Switching to $tag"
ssh "$HOST" "cd $DEST && docker tag skyn3t-marquee:$tag skyn3t-marquee:latest && docker compose up -d --no-build --force-recreate"
sleep 5
ssh "$HOST" "docker exec skyn3t node -p \"'Now running v' + require('./package.json').version\"; docker ps --filter name=skyn3t --format '{{.Names}}\t{{.Status}}'"
echo "To return to the newest version: ./deploy.sh"
