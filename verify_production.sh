#!/usr/bin/env bash
set -euo pipefail

# Production verification script for alhijrah-caseflow
# Derived from actual application routes and security headers in src/server.js
#
# Usage: PROD_HOST=https://alhijrah-caseflow-production-716b.up.railway.app bash verify_production.sh

if [[ -z "${PROD_HOST:-}" ]]; then
  echo "FATAL: PROD_HOST is required (e.g. https://alhijrah-caseflow-production-716b.up.railway.app)" >&2
  exit 1
fi

PROD_HOST="${PROD_HOST%/}"
PASS=0
FAIL=0
MANUAL=0

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1" >&2; }
manual() { MANUAL=$((MANUAL + 1)); echo "  MANUAL: $1"; }

echo "=== Production Verification ==="
echo "Host: ${PROD_HOST}"
echo ""

# -------------------------------------------------------
# 1. Health check — GET /health (src/server.js:1083)
# -------------------------------------------------------
echo "[1] Health endpoint"
HEALTH=$(curl -fsS --connect-timeout 10 --max-time 30 "${PROD_HOST}/health" 2>/dev/null) || true
if echo "${HEALTH}" | node -e 'const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));if(d.status!=="ok")process.exit(1)' 2>/dev/null; then
  pass "/health returns status:ok"
else
  fail "/health did not return status:ok — got: ${HEALTH:-<empty>}"
fi

# -------------------------------------------------------
# 2. Readiness check — GET /ready (src/server.js:1084-1141)
# -------------------------------------------------------
echo "[2] Readiness endpoint"
READY_HTTP=$(curl -sS --connect-timeout 10 --max-time 60 -o /tmp/caseflow-ready.json -w '%{http_code}' "${PROD_HOST}/ready" 2>/dev/null) || true
if [[ "${READY_HTTP}" == "200" ]]; then
  pass "/ready returns HTTP 200"
else
  fail "/ready returned HTTP ${READY_HTTP} (expected 200)"
fi

if [[ -f /tmp/caseflow-ready.json ]]; then
  # Verify core checks are all true
  if node -e '
    const d=JSON.parse(require("fs").readFileSync("/tmp/caseflow-ready.json","utf8"));
    if(d.status!=="ready")process.exit(1);
    const required=["supabase","coreSchema","r2","internalAuth","userAuth","ownerAccount"];
    for(const k of required){if(!d.checks[k]){console.error("check failed:",k);process.exit(1)}}
  ' 2>/dev/null; then
    pass "/ready core checks all true (supabase, coreSchema, r2, internalAuth, userAuth, ownerAccount)"
  else
    fail "/ready one or more core checks failed"
  fi
fi

# -------------------------------------------------------
# 3. Deployed SHA verification (RAILWAY_GIT_COMMIT_SHA)
# -------------------------------------------------------
echo "[3] Deployed SHA"
if [[ -f /tmp/caseflow-ready.json ]]; then
  DEPLOYED_SHA=$(node -e 'const d=JSON.parse(require("fs").readFileSync("/tmp/caseflow-ready.json","utf8"));console.log(d.verification?.sha||"unknown")' 2>/dev/null)
  if [[ -n "${EXPECTED_SHA:-}" ]]; then
    if [[ "${DEPLOYED_SHA}" == "${EXPECTED_SHA}" ]]; then
      pass "Deployed SHA matches expected: ${DEPLOYED_SHA}"
    else
      fail "Deployed SHA ${DEPLOYED_SHA} does not match expected ${EXPECTED_SHA}"
    fi
  else
    echo "  INFO: Deployed SHA is ${DEPLOYED_SHA} (set EXPECTED_SHA to verify)"
  fi
else
  manual "Could not read /ready response to check SHA"
fi

# -------------------------------------------------------
# 4. Security headers (src/server.js:114 securityHeaders())
# -------------------------------------------------------
echo "[4] Security headers"
curl -sS --connect-timeout 10 --max-time 30 -D /tmp/caseflow-headers.txt -o /dev/null "${PROD_HOST}/" 2>/dev/null || true

check_header() {
  local name="$1"
  if grep -qi "^${name}:" /tmp/caseflow-headers.txt 2>/dev/null; then
    pass "Header present: ${name}"
  else
    fail "Header missing: ${name}"
  fi
}

check_header "content-security-policy"
check_header "strict-transport-security"
check_header "x-content-type-options"
check_header "x-frame-options"
check_header "referrer-policy"
check_header "permissions-policy"
check_header "cache-control"

# -------------------------------------------------------
# 5. Auth status — GET /api/v1/auth/status (src/server.js:1145)
# -------------------------------------------------------
echo "[5] Auth provisioning status"
AUTH_STATUS=$(curl -fsS --connect-timeout 10 --max-time 30 "${PROD_HOST}/api/v1/auth/status" 2>/dev/null) || true
if echo "${AUTH_STATUS}" | node -e '
  const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
  if(d.configured!==true||d.ownerProvisioned!==true||d.errorCode!==null)process.exit(1);
' 2>/dev/null; then
  pass "/api/v1/auth/status: configured=true, ownerProvisioned=true, no error"
else
  fail "/api/v1/auth/status unexpected response: ${AUTH_STATUS:-<empty>}"
fi

# -------------------------------------------------------
# 6. Unauthenticated API protection
# -------------------------------------------------------
echo "[6] Unauthenticated API protection"

# GET /api/v1/cases without session should be rejected (src/server.js authorize() gate)
CASES_HTTP=$(curl -sS --connect-timeout 10 --max-time 30 -o /dev/null -w '%{http_code}' "${PROD_HOST}/api/v1/cases" 2>/dev/null) || true
if [[ "${CASES_HTTP}" == "401" || "${CASES_HTTP}" == "403" ]]; then
  pass "GET /api/v1/cases without auth returns ${CASES_HTTP}"
else
  fail "GET /api/v1/cases without auth returned ${CASES_HTTP} (expected 401 or 403)"
fi

# GET /api/v1/clients without session should be rejected
CLIENTS_HTTP=$(curl -sS --connect-timeout 10 --max-time 30 -o /dev/null -w '%{http_code}' "${PROD_HOST}/api/v1/clients" 2>/dev/null) || true
if [[ "${CLIENTS_HTTP}" == "401" || "${CLIENTS_HTTP}" == "403" ]]; then
  pass "GET /api/v1/clients without auth returns ${CLIENTS_HTTP}"
else
  fail "GET /api/v1/clients without auth returned ${CLIENTS_HTTP} (expected 401 or 403)"
fi

# GET /api/v1/users without session should be rejected
USERS_HTTP=$(curl -sS --connect-timeout 10 --max-time 30 -o /dev/null -w '%{http_code}' "${PROD_HOST}/api/v1/users" 2>/dev/null) || true
if [[ "${USERS_HTTP}" == "401" || "${USERS_HTTP}" == "403" ]]; then
  pass "GET /api/v1/users without auth returns ${USERS_HTTP}"
else
  fail "GET /api/v1/users without auth returned ${USERS_HTTP} (expected 401 or 403)"
fi

# -------------------------------------------------------
# 7. Static asset serving
# -------------------------------------------------------
echo "[7] Static asset serving"
ROOT_HTTP=$(curl -sS --connect-timeout 10 --max-time 30 -o /tmp/caseflow-root.html -w '%{http_code}' "${PROD_HOST}/" 2>/dev/null) || true
if [[ "${ROOT_HTTP}" == "200" ]]; then
  pass "GET / returns HTTP 200"
else
  fail "GET / returned HTTP ${ROOT_HTTP}"
fi

if grep -q 'ALHIJRAH CASEFLOW' /tmp/caseflow-root.html 2>/dev/null; then
  pass "Root page contains expected application title"
else
  fail "Root page does not contain 'ALHIJRAH CASEFLOW'"
fi

# -------------------------------------------------------
# 8. Production runtime verification (Railway only)
# -------------------------------------------------------
echo "[8] Runtime verification (requires Railway environment)"
if [[ -f /tmp/caseflow-ready.json ]]; then
  VERIFY_STATUS=$(node -e '
    const d=JSON.parse(require("fs").readFileSync("/tmp/caseflow-ready.json","utf8"));
    const v=d.verification||{};
    console.log(v.status||"unknown");
  ' 2>/dev/null)
  if [[ "${VERIFY_STATUS}" == "complete" ]]; then
    pass "Runtime verification status: complete"
  elif [[ "${VERIFY_STATUS}" == "disabled" ]]; then
    echo "  INFO: Runtime verification disabled (non-Railway environment)"
  else
    fail "Runtime verification status: ${VERIFY_STATUS} (expected complete)"
  fi
else
  manual "Could not read /ready response for verification status"
fi

# -------------------------------------------------------
# 9. Checks requiring authenticated credentials
# -------------------------------------------------------
echo "[9] Authenticated checks"
manual "Document upload/download flow — requires valid session"
manual "Case CRUD operations — requires valid session"
manual "User management — requires owner session"
manual "Import center — requires valid session"

# -------------------------------------------------------
# Summary
# -------------------------------------------------------
echo ""
echo "=== Summary ==="
echo "  PASS:   ${PASS}"
echo "  FAIL:   ${FAIL}"
echo "  MANUAL: ${MANUAL}"
echo ""

if [[ ${FAIL} -gt 0 ]]; then
  echo "RESULT: FAILED (${FAIL} check(s) failed)" >&2
  exit 1
else
  echo "RESULT: PASSED (${PASS} automated, ${MANUAL} manual)"
  exit 0
fi
