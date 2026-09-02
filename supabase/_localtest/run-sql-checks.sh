#!/usr/bin/env bash
# Applies the migration and the SQL assertion suites to a throwaway Postgres.
#
# These suites need a database where auth.uid() can be impersonated, so they run
# against plain Postgres plus the stubs in 00_supabase_stubs.sql rather than the
# real Supabase stack (where auth.uid() reads a JWT). They test the schema, RLS
# policies and RPCs in isolation; e2e.mjs covers the same ground through the
# real API.
#
#   ./supabase/_localtest/run-sql-checks.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION="$(ls "$DIR"/../migrations/*_init.sql | head -1)"
NAME="roomsplit-sqlcheck"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "starting throwaway postgres..."
docker run --rm -d --name "$NAME" -e POSTGRES_PASSWORD=pw postgres:17-alpine >/dev/null
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

for f in "$DIR/00_supabase_stubs.sql" "$MIGRATION" "$DIR/01_functional.sql" "$DIR/02_my_rooms.sql"; do
  docker cp "$f" "$NAME:/tmp/$(basename "$f")" >/dev/null
done

docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/00_supabase_stubs.sql >/dev/null 2>&1
echo "applying $(basename "$MIGRATION")..."
docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -f "/tmp/$(basename "$MIGRATION")"

docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/01_functional.sql 2>&1 | grep "NOTICE:" | sed 's/^.*NOTICE:  /  /'
docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/02_my_rooms.sql 2>&1 | grep "NOTICE:" | sed 's/^.*NOTICE:  /  /'

echo "all SQL checks passed"
