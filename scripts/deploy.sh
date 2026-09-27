#!/usr/bin/env bash
# Deploy to the VPS: backup prod DB -> rsync source -> rebuild on VPS -> restart -> health check.
# Usage: scripts/deploy.sh [--no-backup]
set -euo pipefail

SSH_KEY="${SSH_KEY:-/home/sagi/Documents/Open-Claw/ssh-key-2026-08-06.key}"
HOST="${DEPLOY_HOST:-ubuntu@82.70.254.122}"
REMOTE_DIR="${REMOTE_DIR:-shabetz-na}"
REMOTE_DB="/srv/shabetz-na/shabetz.db"
BACKUP_DIR="${BACKUP_DIR:-$HOME/shabetz-backups}"

cd "$(dirname "$0")/.."
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes "$HOST")

if [[ "${1:-}" != "--no-backup" ]]; then
  echo "==> backup prod DB"
  mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
  out="$BACKUP_DIR/shabetz-$(date +%F_%H%M%S).db"
  "${SSH[@]}" "sudo sqlite3 $REMOTE_DB '.backup /tmp/deploy-backup.db' && sudo chmod 644 /tmp/deploy-backup.db"
  scp -q -i "$SSH_KEY" "$HOST:/tmp/deploy-backup.db" "$out"
  "${SSH[@]}" "sudo shred -u /tmp/deploy-backup.db"
  chmod 600 "$out"
  sqlite3 "$out" "PRAGMA integrity_check;" | grep -qx ok || { echo "backup integrity check failed: $out" >&2; exit 1; }
  echo "    saved $out"
fi

echo "==> rsync source"
rsync -az --delete -e "ssh -i $SSH_KEY" \
  --exclude .git --exclude node_modules --exclude .next --exclude dev-db \
  --exclude '.env*' --exclude '*.db*' --exclude '*.tsbuildinfo' --exclude .claude \
  ./ "$HOST:$REMOTE_DIR/"

echo "==> build + restart"
"${SSH[@]}" "cd $REMOTE_DIR && sudo docker compose up -d --build"

echo "==> health check"
for i in {1..15}; do
  code=$("${SSH[@]}" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/" || true)
  if [[ "$code" =~ ^(200|301|302|307|308)$ ]]; then
    echo "    up (HTTP $code)"
    "${SSH[@]}" "cd $REMOTE_DIR && sudo docker compose logs --tail 10"
    exit 0
  fi
  sleep 2
done

echo "health check failed (last HTTP ${code:-none})" >&2
"${SSH[@]}" "cd $REMOTE_DIR && sudo docker compose logs --tail 40" >&2
exit 1
