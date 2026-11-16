#!/usr/bin/env bash
# Deploy to the VPS: backup prod DB -> rsync source -> rebuild on VPS -> restart -> health check.
# Usage: scripts/deploy.sh [--no-backup] [--migrate]
#   --migrate  run scripts/migrate.ts against the prod DB (via the Dockerfile builder stage) before restart
set -euo pipefail

SSH_KEY="${SSH_KEY:-/home/sagi/Documents/Open-Claw/ssh-key-2026-08-06.key}"
HOST="${DEPLOY_HOST:-ubuntu@82.70.254.122}"
REMOTE_DIR="${REMOTE_DIR:-shabetz-na}"
REMOTE_DATA_DIR="/srv/shabetz-na"
REMOTE_DB="$REMOTE_DATA_DIR/shabetz.db"
BACKUP_DIR="${BACKUP_DIR:-$HOME/shabetz-backups}"

cd "$(dirname "$0")/.."
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes "$HOST")

BACKUP=1
MIGRATE=0
for arg in "$@"; do
  case "$arg" in
    --no-backup) BACKUP=0 ;;
    --migrate) MIGRATE=1 ;;
    *) echo "unknown option: $arg" >&2; echo "usage: $0 [--no-backup] [--migrate]" >&2; exit 2 ;;
  esac
done

if (( BACKUP )); then
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

if (( MIGRATE )); then
  echo "==> migrate"
  # runner image has no tsx/src; use the builder stage. uid 1001 = nextjs in runner, keeps -wal/-shm ownership right.
  "${SSH[@]}" "cd $REMOTE_DIR && sudo docker build -q --target builder -t shabetzna-migrate . >/dev/null \
    && sudo docker run --rm --user 1001:1001 -v $REMOTE_DATA_DIR:/data -e DATABASE_PATH=/data/shabetz.db \
       shabetzna-migrate npx tsx scripts/migrate.ts"
fi

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
