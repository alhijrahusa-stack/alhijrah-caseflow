// Test harness for driving the API without a listening socket or a live
// Supabase/R2 backend.
//
// This module must be imported BEFORE src/server.js: it sets the environment
// the server reads at module-evaluation time and installs the fetch and S3
// stubs the server will later call.

import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';

export const APP_ORIGIN = 'https://caseflow.test';
export const INTERNAL_KEY = 'internal-test-key-0123456789';
const SUPABASE = 'https://project.supabase.test';

process.env.APP_BASE_URL = APP_ORIGIN;
process.env.CORS_ORIGINS = '';
process.env.INTERNAL_API_KEY = INTERNAL_KEY;
process.env.OWNER_EMAIL = 'owner@caseflow.test';
process.env.SUPABASE_URL = SUPABASE;
process.env.SUPABASE_ANON_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
process.env.R2_ENDPOINT = 'https://r2.test';
process.env.R2_ACCESS_KEY_ID = 'r2-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'r2-secret-key';
process.env.R2_BUCKET = 'caseflow-test';
process.env.RESEND_API_KEY = 'resend-test-key';
process.env.RESEND_FROM_EMAIL = 'ALHIJRAH SERVICES <caseflow@caseflow.test>';

// ---------------------------------------------------------------------------
// In-memory backend
// ---------------------------------------------------------------------------

const emptyTables = () => ({
  cases: [],
  documents: [],
  case_events: [],
  audit_events: [],
  clients: [],
  app_users: [],
  user_roles: [],
  case_assignments: [],
  client_access: [],
  teams: [],
  team_members: [],
  access_policies: [],
  record_access_grants: [],
  tasks: [],
  deadlines: [],
  legal_holds: [],
  document_requests: [],
  case_notes: [],
  case_messages: [],
  appointments: [],
  invoices: [],
  payments: [],
  alerts: [],
  retention_policies: [],
  intake_definitions: [],
  intake_submissions: [],
  service_catalog: [],
  people: [],
  client_people: [],
  case_people: [],
  form_role_assignments: [],
  person_history_records: [],
  family_relationships: [],
  participant_match_reviews: [],
  form_registry: [],
  form_versions: [],
  form_definitions: [],
  form_instances: [],
  form_rules: [],
  form_answers: [],
  form_findings: [],
  background_jobs: [],
  generated_artifacts: [],
  ai_review_runs: [],
  ai_findings: [],
  controlled_document_templates: [],
  form_update_alerts: [],
  office_settings: [{ singleton: true, office_name: 'ALHIJRAH SERVICES', default_language: 'English' }],
  communication_templates: [{ id: crypto.randomUUID(), template_key: 'case_opened', version: 1, subject_en: 'Your case is now open — {Case_Number}', subject_ar: 'تم فتح ملفكم — {Case_Number}', body_en: 'Your case has been opened successfully.', body_ar: 'تم فتح ملفكم بنجاح.', active: true }],
  outbound_communications: [],
  import_batches: [],
  import_rows: [],
});

export const backend = {
  tables: emptyTables(),
  users: new Map(),
  sessions: new Map(),
  objects: new Map(),
  authFailures: 0,
  sharedLoginAttempts: new Map(),
  adminProbes: 0,
  emails: [],
  clientNumber: 0,
  caseNumber: 0,
  restRequests: [],
  failNextUserDatabaseRequest: 0,
};

export function resetBackend() {
  backend.tables = emptyTables();
  backend.users = new Map();
  backend.sessions = new Map();
  backend.objects = new Map();
  backend.authFailures = 0;
  backend.sharedLoginAttempts = new Map();
  backend.adminProbes = 0;
  backend.emails = [];
  backend.clientNumber = 0;
  backend.caseNumber = 0;
  backend.restRequests = [];
  backend.failNextUserDatabaseRequest = 0;
}

export function addUser({ id = crypto.randomUUID(), email, password = 'correct-horse-battery', roles = [], status, confirmed = true, fullName } = {}) {
  const user = {
    id,
    email,
    password,
    app_metadata: { roles, ...(status ? { status } : {}) },
    user_metadata: fullName ? { full_name: fullName } : {},
    email_confirmed_at: confirmed ? new Date().toISOString() : null,
    confirmed_at: confirmed ? new Date().toISOString() : null,
  };
  backend.users.set(email, user);
  // main resolves the effective principal from app_users + user_roles, so a
  // test user has to exist there too.
  if (roles.length) {
    backend.tables.app_users.push({ auth_user_id: id, display_name: fullName || email, email, status: status === 'inactive' ? 'inactive' : 'active', preferred_language: 'English' });
    for (const role of roles) backend.tables.user_roles.push({ auth_user_id: id, role_code: role });
  }
  return user;
}

export function issueSession(user) {
  const accessToken = `access-${crypto.randomUUID()}`;
  backend.sessions.set(accessToken, user.email);
  return { access_token: accessToken, refresh_token: `refresh-${crypto.randomUUID()}`, expires_in: 3600, user: publicShape(user) };
}

function publicShape(user) {
  const { password, ...rest } = user;
  return rest;
}

function jsonResponse(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Minimal PostgREST semantics: `?col=eq.value`, `select`, `order`, `limit`,
// and `neq`. Enough to exercise the filters the API actually builds.
function applyFilters(rows, params) {
  let result = rows;
  for (const [key, raw] of params.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
    const [operator, ...rest] = raw.split('.');
    const value = rest.join('.');
    if (operator === 'eq') result = result.filter(row => String(row[key] ?? '') === value);
    else if (operator === 'neq') result = result.filter(row => String(row[key] ?? '') !== value);
    else if (operator === 'not') {
      const [nested, ...nestedRest] = rest;
      const nestedValue = nestedRest.join('.');
      if (nested === 'in') {
        const members = new Set(nestedValue.replace(/^\(|\)$/g, '').split(',').filter(Boolean));
        result = result.filter(row => !members.has(String(row[key] ?? '')));
      } else if (nested === 'eq') result = result.filter(row => String(row[key] ?? '') !== nestedValue);
    }
    else if (operator === 'ilike') {
      const needle = decodeURIComponent(value).toLowerCase();
      result = result.filter(row => String(row[key] ?? '').toLowerCase() === needle);
    } else if (operator === 'in') {
      const members = new Set(value.replace(/^\(|\)$/g, '').split(',').filter(Boolean));
      result = result.filter(row => members.has(String(row[key] ?? '')));
    } else if (operator === 'is') {
      if (value === 'null') result = result.filter(row => row[key] === null || row[key] === undefined);
      else if (value === 'true') result = result.filter(row => row[key] === true);
      else if (value === 'false') result = result.filter(row => row[key] === false);
    }
  }
  return result;
}

// PostgREST `or=(a.eq.x,b.in.(1,2))`, which the case scoping builds.
function applyOr(rows, expression) {
  if (!expression) return rows;
  const inner = expression.replace(/^\(|\)$/g, '');
  const clauses = [];
  let depth = 0;
  let current = '';
  for (const character of inner) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      clauses.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current) clauses.push(current);

  return rows.filter(row => clauses.some(clause => {
    const [column, operator, ...rest] = clause.split('.');
    const value = rest.join('.');
    if (operator === 'eq') return String(row[column] ?? '') === value;
    if (operator === 'ilike') return String(row[column] ?? '').toLowerCase().includes(decodeURIComponent(value).replaceAll('*', '').toLowerCase());
    if (operator === 'in') {
      const members = new Set(value.replace(/^\(|\)$/g, '').split(',').filter(Boolean));
      return members.has(String(row[column] ?? ''));
    }
    return false;
  }));
}

async function handleRest(url, init) {
  const table = url.pathname.replace('/rest/v1/', '');
  if(table==='rpc/consume_login_attempt'){
    const body=JSON.parse(init.body||'{}'),now=Date.now(),windowMs=Number(body.p_window_seconds||900)*1000,entry=backend.sharedLoginAttempts.get(body.p_key_hash);
    const next=!entry||now-entry.first>windowMs?{count:1,first:now}:{count:entry.count+1,first:entry.first};backend.sharedLoginAttempts.set(body.p_key_hash,next);
    return jsonResponse(200,[{allowed:next.count<=Number(body.p_limit||8),retry_after_seconds:Math.max(0,Math.ceil((next.first+windowMs-now)/1000))}]);
  }
  if(table==='rpc/clear_login_attempt'){
    const body=JSON.parse(init.body||'{}');backend.sharedLoginAttempts.delete(body.p_key_hash);return jsonResponse(200,true);
  }
  const rows = backend.tables[table];
  if (!rows) return jsonResponse(404, { message: `relation "${table}" does not exist`, hint: 'internal detail that must not leak' });
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : undefined;

  if (method === 'GET') {
    let result = applyFilters(rows, url.searchParams);
    if (url.searchParams.has('or')) result = applyOr(result, url.searchParams.get('or'));
    const order = url.searchParams.get('order');
    if (order) {
      const [column, direction] = order.split('.');
      result = [...result].sort((a, b) => String(b[column] ?? '').localeCompare(String(a[column] ?? '')));
      if (direction !== 'desc') result.reverse();
    }
    const limit = Number(url.searchParams.get('limit') || 0);
    if (limit > 0) result = result.slice(0, limit);
    return jsonResponse(200, result);
  }

  if (method === 'POST') {
    const inputs = Array.isArray(body) ? body : [body];
    const created = [];
    for (const input of inputs) {
    const record = { created_at: new Date().toISOString(), ...input };
    if (table === 'cases') {
      record.updated_at = record.updated_at || record.created_at;
      record.case_number ||= `AH-2026-${String(++backend.caseNumber).padStart(6, '0')}`;
      record.case_reference ||= record.case_number;
      record.opened_on ||= '2026-08-27';
    }
    if (table === 'clients') record.client_number ||= `AHC-2026-${String(++backend.clientNumber).padStart(6, '0')}`;
    if (table === 'documents' && rows.some(row => row.object_key === record.object_key)) {
      return jsonResponse(409, { code: '23505', message: 'duplicate key value violates unique constraint "documents_object_key_key"' });
    }
    rows.push(record);
    created.push(record);
    }
    return jsonResponse(201, created);
  }

  if (method === 'PATCH') {
    const matched = applyFilters(rows, url.searchParams);
    for (const row of matched) Object.assign(row, body);
    return jsonResponse(200, matched);
  }

  if (method === 'DELETE') {
    const matched = applyFilters(rows, url.searchParams);
    if (!url.searchParams.size) return jsonResponse(400, { message: 'refusing unfiltered delete' });
    backend.tables[table] = rows.filter(row => !matched.includes(row));
    return jsonResponse(204);
  }

  return jsonResponse(405, { message: 'method not allowed' });
}

async function handleAuth(url, init) {
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : undefined;
  const bearer = String(init.headers?.authorization || '').replace(/^Bearer /, '');

  if (url.pathname === '/auth/v1/token') {
    if (url.searchParams.get('grant_type') === 'password') {
      const user = backend.users.get(String(body.email || '').toLowerCase());
      if (!user || user.password !== body.password) {
        backend.authFailures += 1;
        return jsonResponse(400, { error_description: 'INVALID_CREDENTIALS' });
      }
      return jsonResponse(200, issueSession(user));
    }
    const email = [...backend.sessions.values()][0];
    const user = email ? backend.users.get(email) : null;
    if (!user) return jsonResponse(401, { message: 'invalid refresh token' });
    return jsonResponse(200, issueSession(user));
  }

  if (url.pathname === '/auth/v1/user') {
    const email = backend.sessions.get(bearer);
    if (!email) return jsonResponse(401, { message: 'invalid token' });
    const user = backend.users.get(email);
    if (method === 'PUT') {
      if (typeof body?.password === 'string') user.password = body.password;
      if (body?.data) user.user_metadata = { ...user.user_metadata, ...body.data };
    }
    return jsonResponse(200, publicShape(user));
  }

  if (url.pathname === '/auth/v1/logout') {
    backend.sessions.delete(bearer);
    return jsonResponse(204);
  }

  if (url.pathname === '/auth/v1/admin/users') {
    backend.adminProbes += 1;
    return jsonResponse(200, { users: [...backend.users.values()].map(publicShape) });
  }

  if (url.pathname === '/auth/v1/invite') {
    const email = String(body?.email || '').toLowerCase();
    if (backend.users.get(email)) return jsonResponse(422, { message: 'user already exists' });
    const user = {
      id: crypto.randomUUID(),
      email,
      password: 'correct-horse-battery',
      app_metadata: {},
      user_metadata: body?.data || {},
      email_confirmed_at: null,
      confirmed_at: null,
    };
    backend.users.set(email, user);
    return jsonResponse(200, publicShape(user));
  }

  if (url.pathname === '/auth/v1/recover') {
    const email = String(body?.email || '').toLowerCase();
    const user = backend.users.get(email);
    if (!user) return jsonResponse(200, {});
    backend.lastRecovery = { email, redirectTo: url.searchParams.get('redirect_to') };
    return jsonResponse(200, {});
  }

  const adminUser = url.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
  if (adminUser) {
    const user = [...backend.users.values()].find(entry => entry.id === decodeURIComponent(adminUser[1]));
    if (!user) return jsonResponse(404, { message: 'user not found' });
    if (method === 'PUT') {
      if (body?.app_metadata) user.app_metadata = body.app_metadata;
      if (body?.user_metadata) user.user_metadata = { ...user.user_metadata, ...body.user_metadata };
    }
    return jsonResponse(200, publicShape(user));
  }

  return jsonResponse(404, { message: 'not found' });
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.pathname.startsWith('/rest/v1/')) {
    const headers=Object.fromEntries(Object.entries(init.headers||{}).map(([name,value])=>[String(name).toLowerCase(),String(value)]));
    backend.restRequests.push({method:String(init.method||'GET').toUpperCase(),path:url.pathname,query:url.search,headers});
    if(headers.apikey==='anon-key'&&backend.failNextUserDatabaseRequest>0){
      backend.failNextUserDatabaseRequest-=1;
      return jsonResponse(403,{message:'synthetic user database denial'});
    }
    return handleRest(url, init);
  }
  if (url.pathname.startsWith('/auth/v1/')) return handleAuth(url, init);
  if (url.origin === 'https://api.resend.com' && url.pathname === '/emails') {
    const message = JSON.parse(init.body || '{}');
    backend.emails.push(message);
    return jsonResponse(200, { id: `email-${backend.emails.length}` });
  }
  throw new Error(`unexpected fetch to ${url.href}`);
};

// R2 is exercised through the SDK client the server constructs internally, so
// the stub goes on the prototype. getSignedUrl signs locally and is untouched.
S3Client.prototype.send = async function stubbedSend(command) {
  const name = command.constructor.name;
  const { Key } = command.input;
  if (name === 'HeadObjectCommand') {
    const object = backend.objects.get(Key);
    if (!object) {
      throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
    }
    return { ContentLength: object.size, ContentType: object.contentType };
  }
  if (name === 'DeleteObjectCommand') {
    backend.objects.delete(Key);
    return {};
  }
  if (name === 'GetObjectCommand') {
    const object = backend.objects.get(Key);
    if (!object) {
      throw Object.assign(new Error('NotFound'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    }
    return {
      Body: {
        async transformToByteArray() {
          return new Uint8Array(object.body || Buffer.alloc(object.size));
        },
      },
    };
  }
  if (name === 'PutObjectCommand') {
    const body = command.input.Body === undefined ? Buffer.alloc(command.input.ContentLength || 0) : Buffer.from(command.input.Body);
    backend.objects.set(Key, { size: body.length, contentType: command.input.ContentType, body });
    return {};
  }
  throw new Error(`unexpected S3 command ${name}`);
};

export function putObject(key, { size, contentType }) {
  backend.objects.set(key, { size, contentType, body: Buffer.alloc(size) });
}

// ---------------------------------------------------------------------------
// Request driver
// ---------------------------------------------------------------------------

function makeRequest({ method = 'GET', path = '/', headers = {}, body }) {
  const payload = body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const req = Readable.from(payload.length ? [payload] : []);
  req.method = method;
  req.url = path;
  req.headers = { host: 'caseflow.test', ...headers };
  req.socket = { remoteAddress: headers['x-test-ip'] || '203.0.113.10' };
  return req;
}

function makeResponse() {
  const state = { status: 0, headers: {}, chunks: [], ended: false };
  return {
    state,
    setHeader(name, value) { state.headers[String(name).toLowerCase()] = value; },
    getHeader(name) { return state.headers[String(name).toLowerCase()]; },
    writeHead(status, headers = {}) {
      if (state.ended) throw new Error('ERR_HTTP_HEADERS_SENT');
      state.status = status;
      for (const [name, value] of Object.entries(headers)) state.headers[String(name).toLowerCase()] = value;
      return this;
    },
    end(chunk) {
      if (chunk) state.chunks.push(chunk);
      state.ended = true;
    },
    destroy() { state.ended = true; state.destroyed = true; },
  };
}

// Bound lazily so this module can be imported before src/server.js finishes
// evaluating; the caller supplies the handler once.
export function driver(handle, respondToError) {
  return async function request(options) {
    const req = makeRequest(options);
    const res = makeResponse();
    try {
      await handle(req, res);
    } catch (error) {
      respondToError(req, res, error);
    }
    const raw = Buffer.concat(res.state.chunks.map(c => (Buffer.isBuffer(c) ? c : Buffer.from(String(c))))).toString('utf8');
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
    return { status: res.state.status, headers: res.state.headers, body, raw, cookies: res.state.headers['set-cookie'] || [] };
  };
}

// Headers a same-origin browser request carries, so tests exercise the real
// CSRF path rather than bypassing it.
export function browserHeaders(extra = {}) {
  return { origin: APP_ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...extra };
}

export function cookieHeader(setCookies) {
  return setCookies
    .map(entry => entry.split(';')[0])
    .filter(pair => !/=$/.test(pair))
    .join('; ');
}
