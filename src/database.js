import { AsyncLocalStorage } from 'node:async_hooks';

const requestScope = new AsyncLocalStorage();
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publicApiKey = process.env.SUPABASE_ANON_KEY;

function databaseError(message, status = 503, internalDetails = null) {
  return Object.assign(new Error(message), { status, internalDetails });
}

async function postgrest(path, { method = 'GET', body, query = '' } = {}, credentials) {
  if (!supabaseUrl || !credentials?.apiKey || !credentials?.token) {
    throw databaseError('DATABASE_BOUNDARY_NOT_CONFIGURED');
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}${query}`, {
    method,
    headers: {
      apikey: credentials.apiKey,
      authorization: `Bearer ${credentials.token}`,
      'content-type': 'application/json',
      prefer: method === 'POST' || method === 'PATCH' ? 'return=representation' : '',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const error = databaseError('DATABASE_REQUEST_FAILED', response.status >= 500 ? 502 : response.status, data);
    error.databaseBoundary = credentials.boundary;
    throw error;
  }
  return data;
}

export function withSystemDatabase(operation) {
  if (!serviceRoleKey) throw databaseError('SYSTEM_DATABASE_NOT_CONFIGURED');
  return requestScope.run({ boundary: 'system' }, operation);
}

export function activateUserDatabase(accessToken) {
  const state = requestScope.getStore();
  if (!state) throw databaseError('DATABASE_REQUEST_SCOPE_MISSING');
  if (!publicApiKey || !accessToken || publicApiKey === serviceRoleKey || accessToken === serviceRoleKey) {
    throw databaseError('USER_DATABASE_NOT_CONFIGURED');
  }
  state.boundary = 'user';
  state.accessToken = accessToken;
}

export async function userDb(path, options = {}) {
  const state = requestScope.getStore();
  if (state?.boundary !== 'user' || !state.accessToken) throw databaseError('USER_DATABASE_CONTEXT_REQUIRED');
  return postgrest(path, options, { apiKey: publicApiKey, token: state.accessToken, boundary: 'user' });
}

export async function systemDb(path, options = {}) {
  return postgrest(path, options, { apiKey: serviceRoleKey, token: serviceRoleKey, boundary: 'system' });
}

// Compatibility boundary for existing route helpers. It never changes
// privilege and never retries: user context always uses userDb; explicitly
// established system context uses systemDb; missing context fails closed.
export async function scopedDb(path, options = {}) {
  const state = requestScope.getStore();
  if (state?.boundary === 'user') return userDb(path, options);
  if (state?.boundary === 'system') return systemDb(path, options);
  throw databaseError('DATABASE_REQUEST_SCOPE_MISSING');
}

export function databaseBoundary() {
  return requestScope.getStore()?.boundary || null;
}
