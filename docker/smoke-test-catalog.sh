#!/bin/sh
# Smoke test for the apps/catalog image: boots the compiled service (inline
# boot migrations, then Fastify) against a throwaway Postgres, and asserts
# health + federated-search endpoints respond. No Redis (catalog has none).
# Used by CI on every PR; runs locally too:
#
#   docker build -t trackt-catalog:smoke -f apps/catalog/Dockerfile . \
#     && docker/smoke-test-catalog.sh trackt-catalog:smoke
set -eu

IMAGE="${1:-trackt-catalog:smoke}"
PORT="${SMOKE_PORT:-3102}"
NETWORK=trackt-catalog-smoke
PG=trackt-catalog-smoke-pg
APP=trackt-catalog-smoke-app

cleanup() {
  docker rm -f "$APP" "$PG" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
cleanup
trap cleanup EXIT

docker network create "$NETWORK" >/dev/null
docker run -d --name "$PG" --network "$NETWORK" \
  -e POSTGRES_USER=trackt -e POSTGRES_PASSWORD=trackt -e POSTGRES_DB=trackt_catalog \
  postgres:16-alpine >/dev/null

echo "[smoke] waiting for postgres..."
i=0
until docker exec "$PG" pg_isready -U trackt -d trackt_catalog >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "[smoke] postgres never became ready" >&2
    exit 1
  fi
  sleep 1
done

docker run -d --name "$APP" --network "$NETWORK" -p "127.0.0.1:${PORT}:3002" \
  -e DATABASE_URL="postgres://trackt:trackt@${PG}:5432/trackt_catalog" \
  -e CATALOG_ADMIN_TOKEN=smoke-test-admin-token-0123456789 \
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

echo "[smoke] /readyz (database, must be 200/ok — production mode fails boot if migrations failed)..."
curl -fsS "http://127.0.0.1:${PORT}/readyz"
echo

echo "[smoke] /v1/catalog/search..."
curl -fsS "http://127.0.0.1:${PORT}/v1/catalog/search?q=test"
echo

echo "[smoke] /v1/catalog/version..."
curl -fsS "http://127.0.0.1:${PORT}/v1/catalog/version"
echo

echo "[smoke] OK"
