#!/bin/sh
# Monolith entrypoint: migrate, then run API (public), web SSR, and worker,
# process-managed in one container (PRD §6.1).
set -e

echo "[trackt] running database migrations..."
node packages/db/dist/bin/migrate.js

: "${PORT:=3000}"
: "${WEB_PORT:=3001}"
export WEB_PROXY_UPSTREAM="http://127.0.0.1:${WEB_PORT}"

echo "[trackt] starting web SSR on :${WEB_PORT}"
PORT="$WEB_PORT" HOST=127.0.0.1 node apps/web/server.mjs &
WEB_PID=$!

echo "[trackt] starting worker"
node apps/worker/dist/index.js &
WORKER_PID=$!

echo "[trackt] starting API on :${PORT}"
PORT="$PORT" node apps/api/dist/index.js &
API_PID=$!

shutdown() {
  echo "[trackt] shutting down..."
  kill "$API_PID" "$WORKER_PID" "$WEB_PID" 2>/dev/null || true
  wait
  exit 0
}
trap shutdown TERM INT

# POSIX sh has no `wait -n`: poll the children and exit if any of them dies,
# so the container restarts as a unit.
while true; do
  for pid in $API_PID $WORKER_PID $WEB_PID; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[trackt] process $pid exited unexpectedly, stopping container"
      kill "$API_PID" "$WORKER_PID" "$WEB_PID" 2>/dev/null || true
      exit 1
    fi
  done
  sleep 5 &
  wait $!
done
