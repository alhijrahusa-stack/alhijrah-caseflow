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
});

export const backend = {
  tables: emptyTables(),
  users: new Map(),
  sessions: new Map(),
  objects: new Map(),
  authFailures: 0,
  adminProbes: 0,
};

export function resetBackend() {
  backend.tables = emptyTables();
  backend.users = new Map();
  backend.sessions = new Map();
  backend.objects = new Map();
  backend.authFailures = 0;
  backend.adminProbes = 0;
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
    backend.tables.app_users.push({ auth_user_id: id, display_name: fullName || email, email, status: status === 'inactive' ? 'inactive' : 'active' });
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
    if (operator === 'in') {
      const members = new Set(value.replace(/^\(|\)$/g, '').split(',').filter(Boolean));
      return members.has(String(row[column] ?? ''));
    }
    return false;
  }));
}

async function handleRest(url, init) {
  const table = url.pathname.replace('/rest/v1/', '');
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
    const record = { created_at: new Date().toISOString(), ...body };
    if (table === 'cases') record.updated_at = record.updated_at || record.created_at;
    if (table === 'documents' && rows.some(row => row.object_key === record.object_key)) {
      return jsonResponse(409, { code: '23505', message: 'duplicate key value violates unique constraint "documents_object_key_key"' });
    }
    rows.push(record);
    return jsonResponse(201, [record]);
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
  if (url.pathname.startsWith('/rest/v1/')) return handleRest(url, init);
  if (url.pathname.startsWith('/auth/v1/')) return handleAuth(url, init);
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
  if (name === 'PutObjectCommand') {
    backend.objects.set(Key, { size: command.input.ContentLength, contentType: command.input.ContentType });
    return {};
  }
  throw new Error(`unexpected S3 command ${name}`);
};

export function putObject(key, { size, contentType }) {
  backend.objects.set(key, { size, contentType });
}

// ---------------------------------------------------------------------------
// Request driver
// ---------------------------------------------------------------------------

function makeRequest({ method = 'GET', path = '/', headers = {}, body }) {
  const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const req = Readable.from(payload ? [Buffer.from(payload)] : []);
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
