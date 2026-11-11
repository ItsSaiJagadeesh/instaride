#!/bin/sh
# Daily backup: a Redis dump (all accounts, rides, settings) and a tarball of the driver documents.
# Runs inside the "backup" container. For a single test run set ONCE=1.
set -eu
umask 077

REDIS_HOST="${REDIS_HOST:-redis}"
REDIS_PORT="${REDIS_PORT:-6379}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
DATA_DIR="${DATA_DIR:-/data}"
KEEP_DAYS="${KEEP_DAYS:-14}"
INTERVAL_HOURS="${INTERVAL_HOURS:-24}"

mkdir -p "$BACKUP_DIR"
chmod 755 "$BACKUP_DIR"   # files stay private (600); the app only needs to see how fresh the newest one is

backup_once() {
  stamp=$(date +%Y%m%d-%H%M%S)
  tmp_rdb="$BACKUP_DIR/.redis-$stamp.rdb.part"
  if ! redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" --rdb "$tmp_rdb" >/dev/null 2>&1 || [ ! -s "$tmp_rdb" ]; then
    rm -f "$tmp_rdb"
    echo "backup FAILED: could not dump Redis at $REDIS_HOST:$REDIS_PORT"
    return 1
  fi
  mv "$tmp_rdb" "$BACKUP_DIR/redis-$stamp.rdb"

  if [ -d "$DATA_DIR/uploads" ]; then
    tmp_tar="$BACKUP_DIR/.uploads-$stamp.tar.gz.part"
    if tar -czf "$tmp_tar" -C "$DATA_DIR" uploads; then
      mv "$tmp_tar" "$BACKUP_DIR/uploads-$stamp.tar.gz"
    else
      rm -f "$tmp_tar"
      echo "backup FAILED: could not archive the driver documents"
      return 1
    fi
  fi

  find "$BACKUP_DIR" -maxdepth 1 \( -name 'redis-*.rdb' -o -name 'uploads-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
  echo "backup ok $stamp"
}

if [ "${ONCE:-0}" = "1" ]; then
  backup_once
  exit $?
fi

while true; do
  backup_once || echo "will try again next round"
  sleep $((INTERVAL_HOURS * 3600))
done
