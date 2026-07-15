#!/bin/sh
# Smoke test for the monolith image: boots the real entrypoint path — boot
# migrations, then API + web SSR + worker under the process supervisor —
# against throwaway Postgres/Redis containers, and asserts the health
# endpoints respond. Used by CI on every PR; runs locally too:
#
#   docker build -t trackt:smoke . && docker/smoke-test.sh trackt:smoke
set -eu

IMAGE="${1:-trackt:smoke}"
PORT="${SMOKE_PORT:-3100}"
NETWORK=trackt-smoke
PG=trackt-smoke-pg
REDIS=trackt-smoke-redis
APP=trackt-smoke-app

cleanup() {
  docker rm -f "$APP" "$PG" "$REDIS" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
cleanup
trap cleanup EXIT

docker network create "$NETWORK" >/dev/null
docker run -d --name "$PG" --network "$NETWORK" \
  -e POSTGRES_USER=trackt -e POSTGRES_PASSWORD=trackt -e POSTGRES_DB=trackt \
  postgres:16-alpine >/dev/null
docker run -d --name "$REDIS" --network "$NETWORK" redis:7-alpine >/dev/null

echo "[smoke] waiting for postgres..."
i=0
until docker exec "$PG" pg_isready -U trackt -d trackt >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "[smoke] postgres never became ready" >&2
    exit 1
  fi
  sleep 1
done

docker run -d --name "$APP" --network "$NETWORK" -p "127.0.0.1:${PORT}:3000" \
  -e DATABASE_URL="postgres://trackt:trackt@${PG}:5432/trackt" \
  -e REDIS_URL="redis://${REDIS}:6379" \
  -e AUTH_SECRET=smoke-test-secret-0123456789 \
  "$IMAGE" >/dev/null

echo "[smoke] waiting for /healthz..."
i=0
until curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$(docker inspect -f '{{.State.Running}}' "$APP" 2>/dev/null)" != "true" ]; then
    echo "[smoke] app container exited during boot:" >&2
    docker logs "$APP" >&2 || true
    exit 1
  fi
  if [ "$i" -ge 60 ]; then
    echo "[smoke] timed out waiting for /healthz" >&2
    docker logs "$APP" >&2 || true
    exit 1
  fi
  sleep 2
done

echo "[smoke] /readyz (database + redis)..."
curl -fsS "http://127.0.0.1:${PORT}/readyz"
echo

echo "[smoke] web SSR through the API proxy..."
curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/"

# The entrypoint stops the container if any of its three processes dies; give
# the supervisor a couple of poll cycles to notice a crashed worker.
echo "[smoke] verifying all supervised processes stay up..."
sleep 12
if [ "$(docker inspect -f '{{.State.Running}}' "$APP")" != "true" ]; then
  echo "[smoke] a supervised process died after boot:" >&2
  docker logs "$APP" >&2 || true
  exit 1
fi

echo "[smoke] OK"
