#!/usr/bin/env bash
# Local end-to-end run: PostgreSQL (+pgvector) with all migrations, the
# Storage stand-in, `next start`, then Playwright.
# Usage: e2e/run.sh | CATALOG=real e2e/run.sh | SKIP_BUILD=1 e2e/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}
PGDIR=${PGDIR:-/tmp/cgpg}
PGPORT=${PGPORT:-55432}
export DATABASE_URL=postgres://postgres@127.0.0.1:$PGPORT/careergate
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54999
export SUPABASE_SERVICE_ROLE_KEY=e2e-service-key
export SUPABASE_JWT_SECRET=e2e-jwt-secret-0123456789abcdef0123456789
export STATUS_OTP_PEPPER=e2e-otp-pepper-0123456789abcdef0123456789
export IP_HASH_PEPPER=e2e-ip-pepper-0123456789abcdef01234567890
export AMAZON_CREDENTIALS_KEY_V1=CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg=
export CRON_SECRET=e2e-cron-secret
export PORT=${PORT:-3456}
export E2E_CATALOG=${CATALOG:-fixture}

as_pg() { if [[ $EUID -eq 0 ]]; then su postgres -c "$1"; else sudo -u postgres bash -c "$1"; fi; }
cleanup() { [[ -n "${NEXT_PID:-}" ]] && kill -- -"$NEXT_PID" 2>/dev/null || true; [[ -n "${STORE_PID:-}" ]] && kill "$STORE_PID" 2>/dev/null || true; as_pg "$PGBIN/pg_ctl -D $PGDIR/data stop -m fast" >/dev/null 2>&1 || true; if [[ $EUID -eq 0 ]]; then rm -rf "$PGDIR"; else sudo rm -rf "$PGDIR"; fi; if [[ -f data/job-catalog.json.orig ]]; then mv data/job-catalog.json.orig data/job-catalog.json; fi; }
trap cleanup EXIT
if [[ $EUID -eq 0 ]]; then rm -rf "$PGDIR"; mkdir -p "$PGDIR"; chown postgres "$PGDIR"; else sudo rm -rf "$PGDIR"; sudo mkdir -p "$PGDIR"; sudo chown postgres "$PGDIR"; fi
as_pg "$PGBIN/initdb -D $PGDIR/data -A trust -E UTF8 >/dev/null && $PGBIN/pg_ctl -D $PGDIR/data -o '-p $PGPORT -k $PGDIR -c listen_addresses=127.0.0.1' -l $PGDIR/log start >/dev/null"
sleep 2
P="psql -h 127.0.0.1 -p $PGPORT -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "create database careergate"
$P -d careergate -f e2e/supabase-stub.sql $(for m in supabase/migrations/*.sql; do printf -- "-f %s " "$m"; done) -f e2e/seed.sql 2>&1 | grep -v "wal_level\|HINT" || true
if [[ -z "${SKIP_BUILD:-}" ]]; then cp data/job-catalog.json data/job-catalog.json.orig; [[ "${CATALOG:-fixture}" == "real" ]] || cp e2e/fixtures/job-catalog.test.json data/job-catalog.json; rm -rf .next && npx next build >/tmp/cg-build.log 2>&1 || { tail -40 /tmp/cg-build.log; exit 1; }; mv data/job-catalog.json.orig data/job-catalog.json; fi
node e2e/storage-double.mjs & STORE_PID=$!
NODE_ENV=production setsid npx next start -p "$PORT" >/tmp/cg-server.log 2>&1 & NEXT_PID=$!
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/apply" && break; sleep 0.5; done
BASE_URL="http://127.0.0.1:$PORT" npx playwright test "$@"
if [[ -n "${PERF:-}" ]]; then BASE_URL="http://127.0.0.1:$PORT" node scripts/measure.mjs; fi
