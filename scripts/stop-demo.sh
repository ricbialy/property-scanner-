#!/usr/bin/env bash
# Stop services started by scripts/test-demo.sh.
set -uo pipefail
cd "$(dirname "$0")/.."
for name in api worker web simulator; do
  if [ -f ".local/pids/$name.pid" ]; then
    kill "$(cat ".local/pids/$name.pid")" 2>/dev/null || true
    rm -f ".local/pids/$name.pid"
  fi
done
pkill -f "next start --port 3000" 2>/dev/null || true
echo "demo services stopped (postgres left running; use 'make db-down' to stop it)"
