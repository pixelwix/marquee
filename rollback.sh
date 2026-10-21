#!/usr/bin/env bash
# Switch the live Marquee back to an earlier version's image: ./rollback.sh v1.64.3
# ./rollback.sh with no argument lists the versions you can go back to.
# Emergency use only: the normal rollback is to revert the commit and push (Dockhand redeploys
# main within ~5 minutes), and Dockhand's next sync after a new push replaces this rollback.
# Version images come from deploy.sh (marquee-marquee:vX.Y.Z, newest 20) or from before the
# Dockhand move (skyn3t-marquee:vX.Y.Z, up to v1.78.0).
# Rolls back the app code only: data/ (sessions, alerts, settings in .env) is shared, so a version that
# changed a database's shape may not love older code — check What's new for the versions being skipped.
set -euo pipefail
HOST=hosted
DEST=/mnt/docker/skyn3t
COMPOSE="docker compose -p marquee"
IMAGE=marquee-marquee
if [ $# -eq 0 ]; then
  echo "Versions you can roll back to (newest first):"
  ssh "$HOST" "docker images --format '{{.Repository}}:{{.Tag}}  {{.CreatedSince}}' | grep -E '^(marquee-marquee|skyn3t-marquee):v' | sort -t: -k2 -rV"
  exit 0
fi
tag="$1"; [[ "$tag" == v* ]] || tag="v$tag"
src=$(ssh "$HOST" "for r in marquee-marquee skyn3t-marquee; do docker image inspect \$r:$tag >/dev/null 2>&1 && { echo \$r:$tag; break; }; done")
[ -n "$src" ] || { echo "No saved image for $tag (run ./rollback.sh to list)." >&2; exit 1; }
echo "==> Switching to $src"
ssh "$HOST" "cd $DEST && docker tag $src $IMAGE:latest && $COMPOSE up -d --no-build --force-recreate"
sleep 5
ssh "$HOST" "docker exec skyn3t node -p \"'Now running v' + require('./package.json').version\"; docker ps --filter name=skyn3t --format '{{.Names}}\t{{.Status}}'"
echo "To return to the newest version: push to main, or redeploy the marquee stack in Dockhand."
