#!/usr/bin/env bash
# MURAILEX — one-command local stack (single machine, personal use).
#
#   murailex/local/run-local.sh            start (installs/initialises on first run)
#   murailex/local/run-local.sh stop       stop every process started by this script
#
# Everything stays on this machine: PostgreSQL cluster, evidence files and on-device Whisper
# ASR. Data lives in murailex/.local-data/ and survives restarts. The app is served over
# HTTPS on the private LAN (phones need HTTPS for the microphone) using a certificate from a
# local CA generated on this machine; nothing is exposed beyond the LAN by this script.
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
HTTPS_PORT="${MURAILEX_HTTPS_PORT:-8443}"
HTTP_PORT="${MURAILEX_HTTP_PORT:-8080}"
TLS="$DATA/tls"
RUN="$DATA/run"
LOG="$DATA/logs"

log() { printf '[murailex] %s\n' "$*"; }
die() { printf '[murailex] ERROR: %s\n' "$*" >&2; exit 1; }
warn() { printf '[murailex] WARNING: %s\n' "$*" >&2; }

PG_BIN="${PG_BIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/pg_ctl 2>/dev/null | sort -V | tail -1)")}"
[ -x "$PG_BIN/pg_ctl" ] || die "PostgreSQL server binaries (pg_ctl/initdb) not found. Install PostgreSQL 15+ or set PG_BIN."

as_pg() {
  # initdb/postgres refuse to run as root; use the system postgres account in that case.
  if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi
}

# A pid file is trusted only while that pid still runs the command recorded for the service:
# after a reboot or container restart pids are reused by unrelated processes.
svc_alive() { # name
  local f="$RUN/$1.pid" pid expect actual
  [ -f "$f" ] || return 1
  pid="$(head -1 "$f")"; expect="$(sed -n 2p "$f")"
  [ -n "$pid" ] && [ -n "$expect" ] || return 1
  actual="$(ps -o args= -p "$pid" 2>/dev/null || true)"
  [ -n "$actual" ] && [[ "$actual" == *"$expect"* ]]
}

svc_marker() { # text that appears in the service's command line while it runs
  case "$1" in
    api) echo "--port $API_PORT" ;;
    worker) echo "-m app.worker" ;;
    web) echo "next-server" ;;
    gateway) echo "lan-gateway.mjs" ;;
  esac
}

stop_all() {
  # Each service runs in its own process group; signal the whole group so child processes
  # (e.g. next-server under the Next CLI) never outlive the stop.
  for name in gateway web worker api; do
    if svc_alive "$name"; then
      pid="$(head -1 "$RUN/$name.pid")"
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
      for _ in $(seq 1 30); do kill -0 -- "-$pid" 2>/dev/null || break; sleep 0.5; done
      kill -KILL -- "-$pid" 2>/dev/null || true
    fi
    rm -f "$RUN/$name.pid"
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
"$BACKEND/.venv/bin/python" -c "import faster_whisper, sentencepiece, sherpa_onnx, pypdf" 2>/dev/null \
  || "$BACKEND/.venv/bin/pip" install -q -r "$BACKEND/requirements.txt" -r "$BACKEND/requirements-local.txt"

# On-device translation models (OPUS-MT, CC-BY-4.0): original Marian weights, pinned by SHA-256,
# converted once to CTranslate2 int8. Translation stays unavailable (not faked) if this fails.
MT_DIR="$DATA/models/mt"
install_mt() { # direction url sha256
  local dir="$MT_DIR/$1" zip="$MT_DIR/src/$1.zip"
  [ -f "$dir/model.bin" ] && return 0
  mkdir -p "$MT_DIR/src"
  log "installing on-device translation model $1 (first run)"
  if [ ! -f "$zip" ]; then
    curl -fsSL --max-time 1800 -o "$zip.part" "$2" && mv -f "$zip.part" "$zip" || rm -f "$zip.part"
  fi
  [ -f "$zip" ] && echo "$3  $zip" | sha256sum -c --quiet - || { warn "translation model $1: download or checksum failed; translation $1 unavailable"; rm -f "$zip"; return 0; }
  rm -rf "$MT_DIR/src/$1" && mkdir -p "$MT_DIR/src/$1" && unzip -qo "$zip" -d "$MT_DIR/src/$1"
  "$BACKEND/.venv/bin/ct2-opus-mt-converter" --model_dir "$MT_DIR/src/$1" --output_dir "$dir" --quantization int8 --force >"$LOG/mt-$1.log" 2>&1 \
    && cp "$MT_DIR/src/$1/source.spm" "$MT_DIR/src/$1/target.spm" "$MT_DIR/src/$1/LICENSE" "$MT_DIR/src/$1/README.md" "$dir/" \
    || { warn "translation model $1: conversion failed (see $LOG/mt-$1.log)"; rm -rf "$dir"; }
}
install_mt ar-en https://object.pouta.csc.fi/OPUS-MT-models/ar-en/opus-2019-12-18.zip 2406c939b175616789999f370a3f487e90cd018e4590e8679cf91ee8caff2416
install_mt en-ar https://object.pouta.csc.fi/Tatoeba-MT-models/eng-ara/opus-2021-02-23.zip 857a0d6383f4cb4b990a4915f3a21cb9ab9d00d8837d99ed73bd9f8a5df3af7a

# On-device speaker diarization models (sherpa-onnx releases), pinned by SHA-256:
# pyannote segmentation-3.0 ONNX (MIT, CNRS) and WeSpeaker ResNet34 VoxCeleb (CC-BY-4.0).
DIAR_DIR="$DATA/models/diar"
fetch_pinned() { # url dest sha256
  [ -f "$2" ] && echo "$3  $2" | sha256sum -c --quiet - 2>/dev/null && return 0
  curl -fsSL --max-time 900 -o "$2.part" "$1" && echo "$3  $2.part" | sha256sum -c --quiet - && mv -f "$2.part" "$2" && return 0
  rm -f "$2.part"; return 1
}
if [ ! -f "$DIAR_DIR/sherpa-onnx-pyannote-segmentation-3-0/model.onnx" ] || [ ! -f "$DIAR_DIR/wespeaker_en_voxceleb_resnet34_LM.onnx" ]; then
  log "installing on-device speaker diarization models (first run)"
  mkdir -p "$DIAR_DIR"
  REL=https://github.com/k2-fsa/sherpa-onnx/releases/download
  if fetch_pinned "$REL/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2" "$DIAR_DIR/seg.tar.bz2" 24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488 \
    && fetch_pinned "$REL/speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx" "$DIAR_DIR/wespeaker_en_voxceleb_resnet34_LM.onnx" e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012; then
    tar xjf "$DIAR_DIR/seg.tar.bz2" -C "$DIAR_DIR"
  else
    warn "diarization models: download or checksum failed; speakers will stay unattributed"
  fi
fi

export ENVIRONMENT=local
export DATABASE_URL="postgresql+psycopg://murailex@127.0.0.1:$PGPORT/murailex"
export STORAGE_BACKEND=filesystem
export LOCAL_STORAGE_DIR="$DATA/objects"
export MURAILEX_WORK_DIR="$DATA/work"
export APP_BASE_URL="https://localhost:$HTTPS_PORT"
export COOKIE_SECURE=true
export EVIDENCE_SIGNING_KEY_PATH="$DATA/signing/ed25519-private.pem"   # generated once, mode 600
export LOCAL_MT_DIR="$MT_DIR"
export LOCAL_DIAR_DIR="$DIAR_DIR"
export PYTHONPATH="$BACKEND"

( cd "$BACKEND" && .venv/bin/alembic upgrade head >"$LOG/migrate.log" 2>&1 ) || die "database migration failed (see $LOG/migrate.log)"

port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

start_bg() { # name, port, logfile, command...
  local name="$1" port="$2" logfile="$3"; shift 3
  if svc_alive "$name"; then return; fi
  [ "$port" = 0 ] || port_free "$port" || die "port $port is already in use by another process; stop it first ($name)."
  # New session/process group (portable: no util-linux setsid needed).
  nohup python3 -c 'import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' "$@" >>"$logfile" 2>&1 < /dev/null &
  # line 1: pid, line 2: a command fragment that identifies the service
  printf '%s\n%s\n' "$!" "$(svc_marker "$name")" > "$RUN/$name.pid"
}

start_bg api "$API_PORT" "$LOG/api.log" "$BACKEND/.venv/bin/uvicorn" app.main:app --app-dir "$BACKEND" --host 127.0.0.1 --port "$API_PORT"
# ASR is CPU-bound; run it at lower priority so the UI and API stay responsive while it works.
ready_count() { local n; n="$(grep -c 'local ASR model ready' "$LOG/worker.log" 2>/dev/null)" || true; echo "${n:-0}"; }
fail_count() { local n; n="$(grep -c 'local ASR model .* failed to load' "$LOG/worker.log" 2>/dev/null)" || true; echo "${n:-0}"; }
WORKER_READY_BASE=$(( $(ready_count) + 2 ))
WORKER_FAIL_BASE=$(fail_count)
if svc_alive worker; then WORKER_READY_BASE=0; fi
start_bg worker 0 "$LOG/worker.log" nice -n 10 "$BACKEND/.venv/bin/python" -m app.worker

# ---- frontend ------------------------------------------------------------------------------
if [ ! -d "$FRONTEND/node_modules" ]; then ( cd "$FRONTEND" && npm ci --no-audit --no-fund >"$LOG/npm.log" 2>&1 ); fi
if [ ! -f "$FRONTEND/.next/BUILD_ID" ] || [ -n "$(find "$FRONTEND/src" -newer "$FRONTEND/.next/BUILD_ID" -type f -print -quit)" ]; then
  # Never rebuild under a running server: it would keep serving references to replaced assets.
  if svc_alive web; then
    kill -TERM -- "-$(head -1 "$RUN/web.pid")" 2>/dev/null || true
    for _ in $(seq 1 30); do svc_alive web || break; sleep 0.5; done
    rm -f "$RUN/web.pid"
  fi
  log "building web app"
  ( cd "$FRONTEND" && BACKEND_INTERNAL_URL="http://127.0.0.1:$API_PORT" npm run build >"$LOG/build.log" 2>&1 ) || die "web build failed (see $LOG/build.log)"
fi
export BACKEND_INTERNAL_URL="http://127.0.0.1:$API_PORT"
( cd "$FRONTEND" && start_bg web "$WEB_PORT" "$LOG/web.log" "$FRONTEND/node_modules/.bin/next" start -p "$WEB_PORT" -H 127.0.0.1 )

# ---- private-LAN HTTPS gateway -----------------------------------------------------------
lan_ip() {
  if [ -n "${MURAILEX_LAN_IP:-}" ]; then echo "$MURAILEX_LAN_IP"; return; fi
  if command -v ip >/dev/null; then
    ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}' && return
  fi
  if command -v ipconfig >/dev/null; then ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null; return; fi
  hostname -I 2>/dev/null | awk '{print $1}'
}
LAN_IP="$(lan_ip || true)"
mkdir -p "$TLS"; chmod 700 "$TLS"
if [ ! -f "$TLS/murailex-local-ca.key" ]; then
  openssl req -x509 -newkey rsa:3072 -sha256 -days 3650 -nodes -keyout "$TLS/murailex-local-ca.key" \
    -out "$TLS/murailex-local-ca.crt" -subj "/CN=MURAILEX Local CA ($(hostname))" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" -addext "keyUsage=critical,keyCertSign,cRLSign" >/dev/null 2>&1 \
    || die "could not create the local certificate authority (openssl)."
  chmod 600 "$TLS/murailex-local-ca.key"
fi
SAN="DNS:localhost,IP:127.0.0.1"
[ -n "$LAN_IP" ] && SAN="$SAN,IP:$LAN_IP"
if [ ! -f "$TLS/server.crt" ] || [ "$(cat "$TLS/server.san" 2>/dev/null)" != "$SAN" ]; then
  openssl req -newkey rsa:2048 -nodes -keyout "$TLS/server.key" -out "$TLS/server.csr" -subj "/CN=MURAILEX" >/dev/null 2>&1
  printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature,keyEncipherment\nbasicConstraints=CA:FALSE\n' "$SAN" > "$TLS/server.ext"
  openssl x509 -req -in "$TLS/server.csr" -CA "$TLS/murailex-local-ca.crt" -CAkey "$TLS/murailex-local-ca.key" \
    -CAcreateserial -days 397 -sha256 -extfile "$TLS/server.ext" -out "$TLS/server.crt" >/dev/null 2>&1 \
    || die "could not issue the LAN certificate (openssl)."
  chmod 600 "$TLS/server.key"; echo "$SAN" > "$TLS/server.san"
  # a running gateway still holds the old certificate
  if svc_alive gateway; then kill -TERM -- "-$(head -1 "$RUN/gateway.pid")" 2>/dev/null || true; sleep 1; fi
  rm -f "$RUN/gateway.pid"
fi
start_bg gateway "$HTTPS_PORT" "$LOG/gateway.log" node "$HERE/lan-gateway.mjs" "$TLS" "$HTTPS_PORT" "$HTTP_PORT" "$WEB_PORT"

for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1 && curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/login" 2>/dev/null && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$API_PORT/api/health" >/dev/null || die "API did not start (see $LOG/api.log)"
curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/login" || die "web app did not start (see $LOG/web.log)"
asset="$(curl -fsS "http://127.0.0.1:$WEB_PORT/login" | grep -o '/_next/static/[^"]*\.js' | head -1)"
[ -n "$asset" ] && curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT$asset" || die "web app is serving a stale or broken build (see $LOG/web.log)"

for _ in $(seq 1 20); do curl -fsS --cacert "$TLS/murailex-local-ca.crt" -o /dev/null "https://localhost:$HTTPS_PORT/login" 2>/dev/null && break; sleep 0.5; done
curl -fsS --cacert "$TLS/murailex-local-ca.crt" -o /dev/null "https://localhost:$HTTPS_PORT/login" || die "LAN gateway did not start (see $LOG/gateway.log)"

# Do not announce "ready" until the worker has the ASR models in memory (first job starts at once).
log "loading on-device ASR models…"
for _ in $(seq 1 600); do
  [ "$(ready_count)" -ge "$WORKER_READY_BASE" ] && break
  [ "$(fail_count)" -gt "$WORKER_FAIL_BASE" ] && die "ASR model failed to load (see $LOG/worker.log)"
  sleep 1
done
[ "$(ready_count)" -ge "$WORKER_READY_BASE" ] || die "ASR models did not load within 10 minutes (see $LOG/worker.log)"

log "laptop: https://localhost:$HTTPS_PORT"
if [ -n "$LAN_IP" ]; then
  log "phone:  https://$LAN_IP:$HTTPS_PORT   (same Wi-Fi/LAN)"
  log "        trust once on the phone: http://$LAN_IP:$HTTP_PORT/murailex-local-ca.crt"
else
  log "phone:  no LAN address detected; set MURAILEX_LAN_IP=<this machine's LAN IP> and rerun"
fi
log "login: $BOOTSTRAP_ADMIN_EMAIL  (password in $SECRETS)"
log "logs:  $LOG   stop: $0 stop"
