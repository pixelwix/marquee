#!/usr/bin/env bash
# Syncs the current working tree to hosted's build context, verifies every
# transferred file byte-for-byte (checksum), then rebuilds and restarts the
# container. Exists because a bare `scp` of multiple files to a directory was
# observed to occasionally drop the largest file silently (no error, exit 0)
# — rsync's own checksum comparison closes that gap: a dropped/corrupted file
# simply doesn't match and gets retried on the spot, instead of shipping
# unnoticed. Safe to re-run any time; only ever pushes files that actually
# differ from what's already on the host.
set -euo pipefail

HOST=hosted
DEST=/mnt/docker/skyn3t
# Emergency use only: normal deploys are a push to main (Dockhand Git stack "marquee"). Same
# compose project as Dockhand, so this replaces the same container instead of fighting it;
# Dockhand's next sync puts main back.
COMPOSE="docker compose -p marquee"
IMAGE=marquee-marquee

cd "$(dirname "$0")"

echo "==> Syncing to $HOST:$DEST"
rsync -av --checksum \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.DS_Store' \
  --exclude '._*' \
  --exclude '.env' \
  --exclude '.env.bak*' \
  --exclude '*.bak-*' \
  --exclude '*.backup-*' \
  --exclude 'data' \
  --exclude '.agents' \
  . "$HOST:$DEST/"

echo "==> Verifying git-tracked files landed correctly"
fail=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  local_sum=$(shasum -a 256 "$f" | awk '{print $1}')
  remote_sum=$(ssh "$HOST" "shasum -a 256 '$DEST/$f' 2>/dev/null | awk '{print \$1}'")
  if [ "$local_sum" != "$remote_sum" ]; then
    echo "MISMATCH: $f (local=$local_sum remote=$remote_sum)"
    fail=1
  fi
done < <(git ls-files)

if [ "$fail" -ne 0 ]; then
  echo "==> Verification failed — not rebuilding. Re-run this script (rsync will retry only the mismatched files)."
  exit 1
fi
echo "==> All files verified"

echo "==> Rebuilding and restarting"
VERSION=$(node -p "require('./package.json').version")
ssh "$HOST" "cd $DEST && $COMPOSE build && $COMPOSE up -d"

# Keep each version's image under its own tag so ./rollback.sh vX.Y.Z can switch back in seconds
# (faster than redeploying an older commit). Only the newest 20 are kept; they
# share every layer except the app's own files, so the extra disk is small.
echo "==> Tagging image as v$VERSION (keeping the newest 20 version tags)"
ssh "$HOST" "docker tag $IMAGE:latest $IMAGE:v$VERSION && docker images $IMAGE --format '{{.Tag}}' | grep '^v' | sort -rV | tail -n +21 | xargs -r -I{} docker rmi $IMAGE:{} >/dev/null"

echo "==> Done. Container status:"
ssh "$HOST" "docker ps --filter name=skyn3t --format '{{.Names}}\t{{.Status}}'"
