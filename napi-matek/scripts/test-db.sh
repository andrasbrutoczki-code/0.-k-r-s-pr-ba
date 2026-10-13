#!/usr/bin/env bash
# Adatbázis-tesztek futtatása sima PostgreSQL-en (Docker és Supabase CLI nélkül).
#
# Minden tesztfájl egy frissen létrehozott adatbázison fut:
#   Supabase-csonkok → összes migráció időrendben → jogosultságok → tesztfájl.
#
# Kapcsolódás a szokásos PG* környezeti változókkal (PGHOST, PGPORT, PGUSER,
# PGPASSWORD). A felhasználónak adatbázist és szerepkört kell tudnia létrehozni.
#
#   PGHOST=localhost PGUSER=postgres ./scripts/test-db.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="napi_matek_test"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

failed=0
for test in "$ROOT"/tests/sql/[0-9]*.test.sql; do
  "${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null

  "${PSQL[@]}" -d "$DB" -f "$ROOT/tests/sql/_supabase_stubs.sql" >/dev/null
  for m in "$ROOT"/supabase/migrations/*.sql; do
    "${PSQL[@]}" -d "$DB" -f "$m" >/dev/null
  done
  "${PSQL[@]}" -d "$DB" -f "$ROOT/tests/sql/_after_migrations.sql" >/dev/null

  echo "== $(basename "$test")"
  # A NOTICE-ok a teszteredmények (stderr); a lekérdezések kimenetét elnyeljük.
  rc=0
  out=$(PGOPTIONS="-c client_min_messages=notice" "${PSQL[@]}" -d "$DB" -f "$test" 2>&1 >/dev/null) || rc=$?
  printf '%s\n' "$out" | sed -n 's/^psql:.*NOTICE:  /  /p; s/^psql:.*ERROR:  /  HIBA: /p'
  [ "$rc" -eq 0 ] || failed=1
done

"${PSQL[@]}" -d postgres -c "drop database if exists $DB" >/dev/null
if [ "$failed" -ne 0 ]; then
  echo "SIKERTELEN adatbázis-tesztek" >&2
  exit 1
fi
echo "Minden adatbázis-teszt sikeres."
