#!/usr/bin/env bash
# Rebuild and restart after you replaced the project files with a newer version. Data is kept.
set -euo pipefail
cd "$(dirname "$0")"
docker compose pull redis caddy
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps
