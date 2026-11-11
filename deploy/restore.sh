#!/usr/bin/env bash
# Restore a backup onto this server. THIS REPLACES the current data.
#   ./restore.sh backups/redis-YYYYMMDD-HHMMSS.rdb [backups/uploads-YYYYMMDD-HHMMSS.tar.gz]
# Practise it on a spare machine first: a backup nobody has restored is only a hope.
set -euo pipefail
cd "$(dirname "$0")"

RDB="${1:-}"
UPLOADS="${2:-}"
[ -n "$RDB" ] && [ -f "$RDB" ] || { echo "Usage: $0 backups/redis-<time>.rdb [backups/uploads-<time>.tar.gz]"; exit 1; }
[ -z "$UPLOADS" ] || [ -f "$UPLOADS" ] || { echo "Not found: $UPLOADS"; exit 1; }

echo "This will REPLACE all accounts, rides and settings with the contents of $RDB."
[ -z "$UPLOADS" ] || echo "It will also REPLACE the driver documents with $UPLOADS."
read -r -p "Type YES to continue: " answer
[ "$answer" = "YES" ] || { echo "Cancelled."; exit 1; }

docker compose stop app backup caddy
docker compose stop redis

rdb_dir=$(cd "$(dirname "$RDB")" && pwd)
docker compose run --rm --no-deps -T --user root --entrypoint sh \
  -v "$rdb_dir":/restore:ro -v "$PWD/restore-redis.sh":/restore-redis.sh:ro redis \
  -c "cp /restore/$(basename "$RDB") /data/dump.rdb && sh /restore-redis.sh"

if [ -n "$UPLOADS" ]; then
  up_dir=$(cd "$(dirname "$UPLOADS")" && pwd)
  docker compose run --rm --no-deps -T --user root --entrypoint sh \
    -v "$up_dir":/restore:ro app \
    -c "rm -rf /data/uploads && tar -xzf /restore/$(basename "$UPLOADS") -C /data && chown -R node:node /data/uploads"
fi

docker compose up -d
echo "Restored. Open the console and check the people, rides and driver photos."
