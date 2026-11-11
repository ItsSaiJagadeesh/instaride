#!/bin/sh
# Runs INSIDE a one-off Redis container (see restore.sh). Loads /data/dump.rdb, then turns on the
# append-only file so the normal server (which uses it) starts with all the data. Works on Redis 6 and 7.
set -eu
DATA_DIR="${DATA_DIR:-/data}"
PORT="${REDIS_PORT:-6379}"

[ -s "$DATA_DIR/dump.rdb" ] || { echo "no dump.rdb found in $DATA_DIR"; exit 1; }
rm -rf "$DATA_DIR/appendonlydir" "$DATA_DIR/appendonly.aof"

redis-server --port "$PORT" --dir "$DATA_DIR" --appendonly no --daemonize yes >/dev/null
tries=0
until redis-cli -p "$PORT" ping >/dev/null 2>&1; do
  tries=$((tries + 1))
  [ "$tries" -le 30 ] || { echo "redis did not start"; exit 1; }
  sleep 1
done

redis-cli -p "$PORT" config set appendonly yes >/dev/null
tries=0
while [ "$(redis-cli -p "$PORT" info persistence | tr -d '\r' | grep '^aof_rewrite_in_progress' | cut -d: -f2)" != "0" ]; do
  tries=$((tries + 1))
  [ "$tries" -le 120 ] || { echo "append-only file was not written in time"; exit 1; }
  sleep 1
done
keys=$(redis-cli -p "$PORT" dbsize)
redis-cli -p "$PORT" shutdown nosave >/dev/null 2>&1 || true
echo "restored: $keys keys"
