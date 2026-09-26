#!/usr/bin/env bash
# Builds with the test catalog fixture, starts Postgres 16, the storage
# stand-in and `next start`, then runs Playwright.
# Usage: e2e/run.sh | CATALOG=real e2e/run.sh | SKIP_BUILD=1 e2e/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}
PGDIR=${PGDIR:-/tmp/cgpg}
PGPORT=${PGPORT:-55432}
export SUPABASE_SERVICE_ROLE_KEY=e2e-service-key
export SUPABASE_URL=http://127.0.0.1:54999
export DATABASE_URL=postgres://postgres@127.0.0.1:$PGPORT/careergate
export STAFF_ACCESS_KEY=e2e-office-key
export PORT=${PORT:-3456}

as_pg() { if [[ $EUID -eq 0 ]]; then su postgres -c "$1"; else sudo -u postgres bash -c "$1"; fi; }

cleanup() {
  [[ -n "${NEXT_PID:-}" ]] && kill -- -"$NEXT_PID" 2>/dev/null || true
  [[ -n "${STORE_PID:-}" ]] && kill "$STORE_PID" 2>/dev/null || true
  as_pg "$PGBIN/pg_ctl -D $PGDIR/data stop -m fast" >/dev/null 2>&1 || true
  if [[ $EUID -eq 0 ]]; then rm -rf "$PGDIR"; else sudo rm -rf "$PGDIR"; fi
  if [[ -f data/job-catalog.json.orig ]]; then mv data/job-catalog.json.orig data/job-catalog.json; fi
}
trap cleanup EXIT

if [[ $EUID -eq 0 ]]; then rm -rf "$PGDIR"; mkdir -p "$PGDIR"; chown postgres "$PGDIR"; else sudo rm -rf "$PGDIR"; sudo mkdir -p "$PGDIR"; sudo chown postgres "$PGDIR"; fi
as_pg "$PGBIN/initdb -D $PGDIR/data -A trust -E UTF8 >/dev/null && $PGBIN/pg_ctl -D $PGDIR/data -o '-p $PGPORT -k $PGDIR -c listen_addresses=127.0.0.1' -l $PGDIR/log start >/dev/null"
sleep 2
psql -h 127.0.0.1 -p "$PGPORT" -U postgres -qc "create database careergate"
psql -h 127.0.0.1 -p "$PGPORT" -U postgres -d careergate -v ON_ERROR_STOP=1 -q -f e2e/supabase-stub.sql -f supabase/migrations/001_initial_schema.sql

if [[ -z "${SKIP_BUILD:-}" ]]; then
  cp data/job-catalog.json data/job-catalog.json.orig
  # CATALOG=real builds with the committed catalog instead of the fixture.
  [[ "${CATALOG:-fixture}" == "real" ]] || cp e2e/fixtures/job-catalog.test.json data/job-catalog.json
  rm -rf .next && npx next build >/tmp/cg-build.log 2>&1 || { tail -40 /tmp/cg-build.log; exit 1; }
  mv data/job-catalog.json.orig data/job-catalog.json
fi

node e2e/storage-double.mjs & STORE_PID=$!
NODE_ENV=production setsid npx next start -p "$PORT" >/tmp/cg-server.log 2>&1 & NEXT_PID=$!
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/apply" && break; sleep 0.5; done

BASE_URL="http://127.0.0.1:$PORT" npx playwright test "$@"
