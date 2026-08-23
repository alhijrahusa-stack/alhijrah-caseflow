import http from 'node:http';
import crypto from 'node:crypto';

const port = Number(process.env.PORT || 3000);
const required = ['DATABASE_URL'];
const optional = [
  'REDIS_URL',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_ENDPOINT'
];

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'"
  });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', requestId);

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, {
      status: 'ok',
      service: 'alhijrah-caseflow-api',
      version: '1.8.0',
      requestId
    });
  }

  if (req.method === 'GET' && url.pathname === '/ready') {
    const missing = required.filter((key) => !process.env[key]);
    return json(res, missing.length ? 503 : 200, {
      status: missing.length ? 'not-ready' : 'ready',
      service: 'alhijrah-caseflow-api',
      version: '1.8.0',
      requestId,
      checks: {
        requiredSecretsPresent: missing.length === 0,
        missing,
        optionalConfigured: Object.fromEntries(optional.map((key) => [key, Boolean(process.env[key])]))
      }
    });
  }

  if (req.method === 'GET' && url.pathname === '/') {
    return json(res, 200, {
      service: 'Alhijrah Caseflow',
      version: '1.8.0',
      status: 'runtime-ready',
      health: '/health',
      readiness: '/ready',
      requestId
    });
  }

  return json(res, 404, { error: 'NOT_FOUND', requestId });
});

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;
server.listen(port, '0.0.0.0', () => {
  console.log(`Alhijrah Caseflow runtime listening on ${port}`);
});
