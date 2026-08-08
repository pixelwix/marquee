#!/usr/bin/env bash
# Syncs the current working tree to docker-host's build context, verifies every
# transferred file byte-for-byte (checksum), then rebuilds and restarts the
# container. Exists because a bare `scp` of multiple files to a directory was
# observed to occasionally drop the largest file silently (no error, exit 0)
# — rsync's own checksum comparison closes that gap: a dropped/corrupted file
# simply doesn't match and gets retried on the spot, instead of shipping
# unnoticed. Safe to re-run any time; only ever pushes files that actually
# differ from what's already on the host.
set -euo pipefail

HOST=docker-host
DEST=/mnt/docker/skyn3t

cd "$(dirname "$0")"

echo "==> Syncing to $HOST:$DEST"
rsync -av --checksum \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude 'data' \
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
ssh "$HOST" "cd $DEST && docker compose build && docker compose up -d"

echo "==> Done. Container status:"
ssh "$HOST" "docker ps --filter name=skyn3t --format '{{.Names}}\t{{.Status}}'"
