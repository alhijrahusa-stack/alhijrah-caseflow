import assert from 'node:assert/strict';

const baseUrl = (process.env.PRODUCTION_URL || 'https://alhijrah-caseflow-production-716b.up.railway.app').replace(/\/$/, '');
const strictReady = process.env.STRICT_READY === '1';

async function request(path, options) {
  const response = await fetch(baseUrl + path, { redirect: 'error', signal: AbortSignal.timeout(15_000), ...options });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { response, data, text };
}

const health = await request('/health');
assert.equal(health.response.status, 200);
assert.equal(health.data.status, 'ok');
assert.match(health.data.version, /^\d+\.\d+\.\d+$/);

const root = await request('/');
assert.equal(root.response.status, 200);
assert.match(root.response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
assert.equal(root.response.headers.get('x-content-type-options'), 'nosniff');
assert.equal(root.response.headers.get('x-frame-options'), 'DENY');
assert.doesNotMatch(root.text, /SUPABASE_SERVICE_ROLE_KEY|R2_SECRET_ACCESS_KEY|INTERNAL_API_KEY/);

for (const path of ['/api/v1/clients', '/api/v1/portal', '/api/v1/billing/invoices', '/api/v1/reports/summary', '/api/v1/review-queue']) {
  const protectedRoute = await request(path);
  assert.equal(protectedRoute.response.status, 401, `${path} must reject an unauthenticated request`);
  assert.equal(protectedRoute.data.error, 'AUTHENTICATION_REQUIRED');
}

const ready = await request('/ready');
assert.ok([200, 503].includes(ready.response.status));
assert.equal(typeof ready.data.checks, 'object');
assert.equal(ready.data.checks.authorizationSchema, true, 'authorization migrations must be reachable');
if (strictReady) {
  assert.equal(ready.response.status, 200);
  assert.equal(ready.data.status, 'ready');
  assert.ok(Object.values(ready.data.checks).every(Boolean));
}

console.log(JSON.stringify({ ok: true, version: health.data.version, ready: ready.data.status, checks: ready.data.checks }));
