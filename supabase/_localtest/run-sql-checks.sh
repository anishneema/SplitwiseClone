#!/usr/bin/env bash
# Applies every migration and the SQL assertion suites to a throwaway Postgres.
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
NAME="roomsplit-sqlcheck"

# Every migration, in the order Supabase would apply them -- not just the init
# one. The suites below assert on behaviour that later migrations change, so
# applying a subset would test a schema that never exists anywhere.
MIGRATIONS=()
while IFS= read -r f; do MIGRATIONS+=("$f"); done < <(ls "$DIR"/../migrations/*.sql | sort)

# The suites share one database and run in order: 01 leaves behind the room that
# 02 and 03 assert against.
SUITES=(
  "$DIR/01_functional.sql"
  "$DIR/02_my_rooms.sql"
  "$DIR/03_permissions.sql"
  "$DIR/04_shopping_charges.sql"
)

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "starting throwaway postgres..."
docker run --rm -d --name "$NAME" -e POSTGRES_PASSWORD=pw postgres:17-alpine >/dev/null
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

for f in "$DIR/00_supabase_stubs.sql" "${MIGRATIONS[@]}" "${SUITES[@]}"; do
  docker cp "$f" "$NAME:/tmp/$(basename "$f")" >/dev/null
done

docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/00_supabase_stubs.sql >/dev/null 2>&1

for f in "${MIGRATIONS[@]}"; do
  echo "applying $(basename "$f")..."
  docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -f "/tmp/$(basename "$f")"
done

# ERROR lines are kept as well as NOTICE ones: a failed assert reports through
# stderr, and filtering to NOTICE alone would swallow the reason for the exit.
for f in "${SUITES[@]}"; do
  docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -f "/tmp/$(basename "$f")" 2>&1 \
    | grep -E "NOTICE:|ERROR:|DETAIL:" \
    | sed -E 's/^.*(NOTICE|ERROR|DETAIL):  ?/  /'
done

echo "all SQL checks passed"
