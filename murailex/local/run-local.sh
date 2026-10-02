#!/usr/bin/env bash
# MURAILEX — one-command local stack (single machine, personal use).
#
#   murailex/local/run-local.sh            start (installs/initialises on first run)
#   murailex/local/run-local.sh stop       stop every process started by this script
#
# Everything stays on this machine: PostgreSQL cluster, evidence files and on-device Whisper
# ASR. Data lives in murailex/.local-data/ and survives restarts.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
DATA="$ROOT/.local-data"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
PGDATA="$DATA/pg"
PGPORT="${MURAILEX_PG_PORT:-55432}"
API_PORT="${MURAILEX_API_PORT:-8000}"
WEB_PORT="${MURAILEX_WEB_PORT:-3000}"
RUN="$DATA/run"
LOG="$DATA/logs"

log() { printf '[murailex] %s\n' "$*"; }
die() { printf '[murailex] ERROR: %s\n' "$*" >&2; exit 1; }

PG_BIN="${PG_BIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/pg_ctl 2>/dev/null | sort -V | tail -1)")}"
[ -x "$PG_BIN/pg_ctl" ] || die "PostgreSQL server binaries (pg_ctl/initdb) not found. Install PostgreSQL 15+ or set PG_BIN."

as_pg() {
  # initdb/postgres refuse to run as root; use the system postgres account in that case.
  if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi
}

stop_all() {
  # Each service runs in its own process group; signal the whole group so child processes
  # (e.g. next-server under the Next CLI) never outlive the stop.
  for name in web worker api; do
    if [ -f "$RUN/$name.pid" ]; then
      pid="$(cat "$RUN/$name.pid")"
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
      for _ in $(seq 1 30); do kill -0 -- "-$pid" 2>/dev/null || break; sleep 0.5; done
      kill -KILL -- "-$pid" 2>/dev/null || true
      rm -f "$RUN/$name.pid"
    fi
  done
  if [ -f "$PGDATA/postmaster.pid" ]; then as_pg "$PG_BIN/pg_ctl" -D "$PGDATA" -m fast -w stop >/dev/null || true; fi
  log "stopped"
}

if [ "${1:-start}" = "stop" ]; then stop_all; exit 0; fi

command -v ffmpeg >/dev/null || die "ffmpeg is required (apt install ffmpeg / brew install ffmpeg)."
command -v node >/dev/null || die "Node.js 22+ is required."
ls /usr/share/fonts/truetype/noto/Noto*Arabic-Regular.ttf >/dev/null 2>&1 || [ -n "${MURAILEX_PDF_FONT:-}" ] \
  || die "Arabic PDF font missing (apt install fonts-noto-core fonts-dejavu-core, or set MURAILEX_PDF_FONT)."
mkdir -p "$DATA" "$RUN" "$LOG" "$DATA/objects" "$DATA/work"
chmod 700 "$DATA"

# ---- secrets (generated once, stored only on this machine) ------------------------------
SECRETS="$DATA/secrets.env"
if [ ! -f "$SECRETS" ]; then
  umask 077
  {
    echo "SECRET_KEY=$(head -c 48 /dev/urandom | base64 | tr -d '\n/+=')"
    echo "BOOTSTRAP_ADMIN_EMAIL=${MURAILEX_ADMIN_EMAIL:-admin@murailex.local}"
    echo "BOOTSTRAP_ADMIN_PASSWORD=$(head -c 24 /dev/urandom | base64 | tr -d '\n/+=')"
  } > "$SECRETS"
  log "created $SECRETS (contains the local admin login)"
fi
set -a; . "$SECRETS"; set +a

# ---- PostgreSQL ------------------------------------------------------------------------
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA"
  [ "$(id -u)" = 0 ] && chown postgres "$PGDATA" "$DATA" && chmod 711 "$DATA"
  as_pg "$PG_BIN/initdb" -D "$PGDATA" -U murailex --auth=trust -E UTF8 --locale=C.UTF-8 >"$LOG/initdb.log"
  log "initialised PostgreSQL cluster"
fi
if ! as_pg "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  as_pg "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/server.log" -w \
    -o "-p $PGPORT -k $PGDATA -c listen_addresses=127.0.0.1" start >/dev/null
fi
as_pg "$PG_BIN/psql" -h 127.0.0.1 -p "$PGPORT" -U murailex -d postgres -tAc \
  "select 1 from pg_database where datname='murailex'" | grep -q 1 \
  || as_pg "$PG_BIN/createdb" -h 127.0.0.1 -p "$PGPORT" -U murailex murailex

# ---- backend -----------------------------------------------------------------------------
if [ ! -x "$BACKEND/.venv/bin/python" ]; then
  log "creating Python environment (first run)"
  python3 -m venv "$BACKEND/.venv"
  "$BACKEND/.venv/bin/pip" install -q -r "$BACKEND/requirements.txt" -r "$BACKEND/requirements-local.txt"
fi

export ENVIRONMENT=local
export DATABASE_URL="postgresql+psycopg://murailex@127.0.0.1:$PGPORT/murailex"
export STORAGE_BACKEND=filesystem
export LOCAL_STORAGE_DIR="$DATA/objects"
export MURAILEX_WORK_DIR="$DATA/work"
export APP_BASE_URL="http://localhost:$WEB_PORT"
export COOKIE_SECURE=false
export PYTHONPATH="$BACKEND"

( cd "$BACKEND" && .venv/bin/alembic upgrade head >"$LOG/migrate.log" 2>&1 ) || die "database migration failed (see $LOG/migrate.log)"

port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

start_bg() { # name, port, logfile, command...
  local name="$1" port="$2" logfile="$3"; shift 3
  if [ -f "$RUN/$name.pid" ] && kill -0 "$(cat "$RUN/$name.pid")" 2>/dev/null; then return; fi
  [ "$port" = 0 ] || port_free "$port" || die "port $port is already in use by another process; stop it first ($name)."
  setsid nohup "$@" >>"$logfile" 2>&1 < /dev/null &
  echo $! > "$RUN/$name.pid"
}

start_bg api "$API_PORT" "$LOG/api.log" "$BACKEND/.venv/bin/uvicorn" app.main:app --app-dir "$BACKEND" --host 127.0.0.1 --port "$API_PORT"
start_bg worker 0 "$LOG/worker.log" "$BACKEND/.venv/bin/python" -m app.worker

# ---- frontend ------------------------------------------------------------------------------
if [ ! -d "$FRONTEND/node_modules" ]; then ( cd "$FRONTEND" && npm ci --no-audit --no-fund >"$LOG/npm.log" 2>&1 ); fi
if [ ! -f "$FRONTEND/.next/BUILD_ID" ] || [ -n "$(find "$FRONTEND/src" -newer "$FRONTEND/.next/BUILD_ID" -type f -print -quit)" ]; then
  log "building web app"
  ( cd "$FRONTEND" && BACKEND_INTERNAL_URL="http://127.0.0.1:$API_PORT" npm run build >"$LOG/build.log" 2>&1 ) || die "web build failed (see $LOG/build.log)"
fi
export BACKEND_INTERNAL_URL="http://127.0.0.1:$API_PORT"
( cd "$FRONTEND" && start_bg web "$WEB_PORT" "$LOG/web.log" "$FRONTEND/node_modules/.bin/next" start -p "$WEB_PORT" -H 127.0.0.1 )

for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1 && curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/login" 2>/dev/null && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$API_PORT/api/health" >/dev/null || die "API did not start (see $LOG/api.log)"
curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/login" || die "web app did not start (see $LOG/web.log)"
asset="$(curl -fsS "http://127.0.0.1:$WEB_PORT/login" | grep -o '/_next/static/[^"]*\.js' | head -1)"
[ -n "$asset" ] && curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT$asset" || die "web app is serving a stale or broken build (see $LOG/web.log)"

log "ready: http://localhost:$WEB_PORT"
log "login: $BOOTSTRAP_ADMIN_EMAIL  (password in $SECRETS)"
log "logs:  $LOG   stop: $0 stop"
