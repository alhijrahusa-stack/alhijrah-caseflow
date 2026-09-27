#!/usr/bin/env bash
# Fresh PostgreSQL (with pgvector), both migrations, then the integration suite.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}
PGDIR=${PGDIR:-/tmp/cgpg-int}
PGPORT=${PGPORT:-55433}
as_pg() { if [[ $EUID -eq 0 ]]; then su postgres -c "$1"; else sudo -u postgres bash -c "$1"; fi; }
cleanup() { as_pg "$PGBIN/pg_ctl -D $PGDIR/data stop -m fast" >/dev/null 2>&1 || true; if [[ $EUID -eq 0 ]]; then rm -rf "$PGDIR"; else sudo rm -rf "$PGDIR"; fi; }
trap cleanup EXIT
if [[ $EUID -eq 0 ]]; then rm -rf "$PGDIR"; mkdir -p "$PGDIR"; chown postgres "$PGDIR"; else sudo rm -rf "$PGDIR"; sudo mkdir -p "$PGDIR"; sudo chown postgres "$PGDIR"; fi
as_pg "$PGBIN/initdb -D $PGDIR/data -A trust -E UTF8 >/dev/null && $PGBIN/pg_ctl -D $PGDIR/data -o '-p $PGPORT -k $PGDIR -c listen_addresses=127.0.0.1' -l $PGDIR/log start >/dev/null"
sleep 2
P="psql -h 127.0.0.1 -p $PGPORT -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "create database careergate"
$P -d careergate -f e2e/supabase-stub.sql -f supabase/migrations/001_initial_schema.sql -f supabase/migrations/002_operations_platform.sql 2>&1 | grep -v "wal_level\|HINT" || true
$P -d careergate -c "select 1 from public.status_transitions limit 1" >/dev/null
echo "migrations applied"
DATABASE_URL="postgres://postgres@127.0.0.1:$PGPORT/careergate" \
STATUS_OTP_PEPPER="integration-otp-pepper-0123456789abcdef" \
IP_HASH_PEPPER="integration-ip-pepper-0123456789abcdefgh" \
TZ=UTC npx vitest run --config vitest.integration.config.ts "$@"
