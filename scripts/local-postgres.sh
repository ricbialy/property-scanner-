#!/usr/bin/env bash
# Embedded local PostgreSQL cluster for environments without docker.
# Data lives in .local/pgdata; listens on 127.0.0.1:5432 with the same
# credentials as compose.yaml so DATABASE_URL is identical either way.
set -euo pipefail

cd "$(dirname "$0")/.."
PGDATA=".local/pgdata"
PGLOG=".local/postgres.log"
PORT="${PGPORT:-5432}"

PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
if [ -z "$PG_BIN" ]; then
  PG_BIN="$(dirname "$(command -v initdb)")"
fi
export PATH="$PG_BIN:$PATH"

# PostgreSQL refuses to run as root; delegate to an unprivileged user if needed.
AS_PG=""
if [ "$(id -u)" = "0" ]; then
  if ! id pglocal >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /bin/bash pglocal
  fi
  AS_PG="runuser -u pglocal --"
fi

run_pg() {
  if [ -n "$AS_PG" ]; then $AS_PG "$@"; else "$@"; fi
}

start() {
  mkdir -p .local
  if [ -n "$AS_PG" ]; then
    chown -R pglocal .local
  fi
  if [ ! -d "$PGDATA" ]; then
    run_pg "$PG_BIN/initdb" -D "$PGDATA" -U propertyscan --auth=trust >/dev/null
  fi
  if ! run_pg "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
    run_pg "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$PGLOG" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" start >/dev/null
  fi
  # Ensure the application database and password exist.
  psql -h 127.0.0.1 -p "$PORT" -U propertyscan -d postgres -qc \
    "alter user propertyscan password 'propertyscan'" >/dev/null
  if ! psql -h 127.0.0.1 -p "$PORT" -U propertyscan -d postgres -qtAc \
      "select 1 from pg_database where datname = 'propertyscan'" | grep -q 1; then
    createdb -h 127.0.0.1 -p "$PORT" -U propertyscan propertyscan
  fi
  echo "embedded postgres running on 127.0.0.1:$PORT (data: $PGDATA)"
}

stop() {
  if run_pg "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
    run_pg "$PG_BIN/pg_ctl" -D "$PGDATA" stop -m fast >/dev/null
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  *) echo "usage: $0 [start|stop]" >&2; exit 1 ;;
esac
