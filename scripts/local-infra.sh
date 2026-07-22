#!/usr/bin/env bash
# Start/stop local infrastructure. Prefers docker compose (PostgreSQL + MinIO);
# falls back to an embedded PostgreSQL cluster (scripts/local-postgres.sh) when
# no docker daemon is available. Object storage falls back to the fs driver.
set -euo pipefail

cd "$(dirname "$0")/.."
CMD="${1:-up}"

have_docker() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

case "$CMD" in
  up)
    if have_docker; then
      docker compose up -d --wait postgres minio minio-init
      echo "docker compose infrastructure ready (postgres:5432, minio:9000)"
    else
      ./scripts/local-postgres.sh start
      echo "embedded postgres ready; using STORAGE_DRIVER=fs for objects"
    fi
    ;;
  down)
    if have_docker; then
      docker compose down
    else
      ./scripts/local-postgres.sh stop
    fi
    ;;
  *)
    echo "usage: $0 [up|down]" >&2
    exit 1
    ;;
esac
