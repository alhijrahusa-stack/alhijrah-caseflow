import http from 'node:http';
import crypto from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const port = Number(process.env.PORT || 3000);
const version = '1.9.0';
const service = 'alhijrah-caseflow-api';

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const internalApiKey = process.env.INTERNAL_API_KEY;
const r2Bucket = process.env.R2_BUCKET;
const r2Endpoint = process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);

const r2 = r2Endpoint && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
  ? new S3Client({
      region: 'auto',
      endpoint: r2Endpoint,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    })
  : null;

function securityHeaders() {
  return {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'strict-transport-security': 'max-age=31536000; includeSubDomains'
  };
}

function json(res, status, body, extra = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...securityHeaders(),
    ...extra
  });
  res.end(JSON.stringify(body));
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  const allowed = (process.env.CORS_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
  if (!origin || !allowed.length || !allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-api-key,x-request-id',
    'access-control-max-age': '86400',
    vary: 'Origin'
  };
}

async function readJson(req, maxBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('PAYLOAD_TOO_LARGE'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('INVALID_JSON'), { status: 400 });
  }
}

function requireInternalAuth(req) {
  if (!internalApiKey) throw Object.assign(new Error('API_NOT_CONFIGURED'), { status: 503 });
  const supplied = req.headers['x-api-key'];
  if (typeof supplied !== 'string') throw Object.assign(new Error('UNAUTHORIZED'), { status: 401 });
  const a = Buffer.from(supplied);
  const b = Buffer.from(internalApiKey);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw Object.assign(new Error('UNAUTHORIZED'), { status: 401 });
}

async function supabase(path, { method = 'GET', body, query = '' } = {}) {
  if (!supabaseUrl || !supabaseServiceKey) throw Object.assign(new Error('SUPABASE_NOT_CONFIGURED'), { status: 503 });
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}${query}`, {
    method,
    headers: {
      apikey: supabaseServiceKey,
      authorization: `Bearer ${supabaseServiceKey}`,
      'content-type': 'application/json',
      prefer: method === 'POST' ? 'return=representation' : method === 'PATCH' ? 'return=representation' : ''
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    const err = new Error('DATABASE_REQUEST_FAILED');
    err.status = response.status >= 500 ? 502 : response.status;
    err.details = data;
    throw err;
  }
  return data;
}

function safeObjectKey(input) {
  const cleaned = String(input || '').replace(/[^a-zA-Z0-9._/-]/g, '_').replace(/\.\./g, '_');
  if (!cleaned || cleaned.startsWith('/')) throw Object.assign(new Error('INVALID_OBJECT_KEY'), { status: 400 });
  return cleaned;
}

async function handle(req, res) {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', requestId);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const cors = corsHeaders(req);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...securityHeaders(), ...cors });
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { status: 'ok', service, version, requestId }, cors);
  }

  if (req.method === 'GET' && url.pathname === '/ready') {
    const checks = {
      supabase: Boolean(supabaseUrl && supabaseServiceKey),
      r2: Boolean(r2 && r2Bucket),
      internalAuth: Boolean(internalApiKey)
    };
    const ready = checks.supabase && checks.r2 && checks.internalAuth;
    return json(res, ready ? 200 : 503, { status: ready ? 'ready' : 'not-ready', service, version, checks, requestId }, cors);
  }

  if (req.method === 'GET' && url.pathname === '/') {
    return json(res, 200, {
      service: 'Alhijrah Caseflow',
      version,
      status: 'online',
      endpoints: ['/health', '/ready', '/api/v1/cases', '/api/v1/documents/presign'],
      requestId
    }, cors);
  }

  if (url.pathname.startsWith('/api/')) requireInternalAuth(req);

  if (req.method === 'GET' && url.pathname === '/api/v1/cases') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 100);
    const data = await supabase('cases', { query: `?select=*&order=created_at.desc&limit=${limit}` });
    return json(res, 200, { data, requestId }, cors);
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/cases') {
    const body = await readJson(req);
    if (!body.client_name || !body.case_type) throw Object.assign(new Error('client_name_and_case_type_required'), { status: 400 });
    const record = {
      id: crypto.randomUUID(),
      client_name: String(body.client_name).trim(),
      case_type: String(body.case_type).trim(),
      status: String(body.status || 'intake').trim(),
      priority: String(body.priority || 'normal').trim(),
      assigned_to: body.assigned_to || null,
      notes: body.notes || null
    };
    const data = await supabase('cases', { method: 'POST', body: record });
    return json(res, 201, { data, requestId }, cors);
  }

  const caseMatch = url.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})$/i);
  if (caseMatch && req.method === 'GET') {
    const data = await supabase('cases', { query: `?id=eq.${encodeURIComponent(caseMatch[1])}&select=*` });
    if (!Array.isArray(data) || data.length === 0) return json(res, 404, { error: 'CASE_NOT_FOUND', requestId }, cors);
    return json(res, 200, { data: data[0], requestId }, cors);
  }

  if (caseMatch && req.method === 'PATCH') {
    const body = await readJson(req);
    const allowed = ['client_name', 'case_type', 'status', 'priority', 'assigned_to', 'notes'];
    const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(patch).length) throw Object.assign(new Error('NO_VALID_FIELDS'), { status: 400 });
    patch.updated_at = new Date().toISOString();
    const data = await supabase('cases', { method: 'PATCH', query: `?id=eq.${encodeURIComponent(caseMatch[1])}`, body: patch });
    return json(res, 200, { data, requestId }, cors);
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/documents/presign') {
    if (!r2 || !r2Bucket) throw Object.assign(new Error('R2_NOT_CONFIGURED'), { status: 503 });
    const body = await readJson(req);
    const filename = safeObjectKey(body.filename || 'document.bin').split('/').pop();
    const caseId = body.case_id ? String(body.case_id) : 'unassigned';
    const key = safeObjectKey(`cases/${caseId}/${crypto.randomUUID()}-${filename}`);
    const command = new PutObjectCommand({
      Bucket: r2Bucket,
      Key: key,
      ContentType: String(body.content_type || 'application/octet-stream'),
      Metadata: body.case_id ? { case_id: String(body.case_id) } : undefined
    });
    const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 900 });
    return json(res, 200, { key, upload_url: uploadUrl, expires_in: 900, requestId }, cors);
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/documents/download-url') {
    if (!r2 || !r2Bucket) throw Object.assign(new Error('R2_NOT_CONFIGURED'), { status: 503 });
    const body = await readJson(req);
    const key = safeObjectKey(body.key);
    const downloadUrl = await getSignedUrl(r2, new GetObjectCommand({ Bucket: r2Bucket, Key: key }), { expiresIn: 300 });
    return json(res, 200, { download_url: downloadUrl, expires_in: 300, requestId }, cors);
  }

  if (req.method === 'DELETE' && url.pathname === '/api/v1/documents') {
    if (!r2 || !r2Bucket) throw Object.assign(new Error('R2_NOT_CONFIGURED'), { status: 503 });
    const body = await readJson(req);
    const key = safeObjectKey(body.key);
    await r2.send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: key }));
    return json(res, 200, { deleted: true, key, requestId }, cors);
  }

  return json(res, 404, { error: 'NOT_FOUND', requestId }, cors);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    const requestId = res.getHeader('x-request-id') || crypto.randomUUID();
    const status = Number(err.status || 500);
    if (status >= 500) console.error(`[${requestId}]`, err.message, err.details || '');
    json(res, status, {
      error: err.message || 'INTERNAL_ERROR',
      ...(status < 500 && err.details ? { details: err.details } : {}),
      requestId
    }, corsHeaders(req));
  });
});

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;
server.listen(port, '0.0.0.0', () => {
  console.log(`Alhijrah Caseflow ${version} listening on ${port}`);
});
