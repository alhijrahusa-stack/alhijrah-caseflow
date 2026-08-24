import crypto from 'node:crypto';

export const roleDefinitions = Object.freeze({
  owner: ['*'],
  admin: ['dashboard.view', 'users.view', 'users.manage', 'clients.view', 'clients.manage', 'cases.view', 'cases.manage', 'documents.view', 'documents.manage', 'tasks.view', 'tasks.manage', 'workflows.manage', 'billing.view', 'billing.manage', 'audit.view', 'reports.view', 'settings.manage'],
  supervisor: ['dashboard.view', 'users.view', 'clients.view', 'clients.manage', 'cases.view', 'cases.manage', 'documents.view', 'documents.manage', 'tasks.view', 'tasks.manage', 'workflows.manage', 'audit.view', 'reports.view'],
  case_manager: ['dashboard.view', 'clients.view', 'clients.manage', 'cases.view', 'cases.manage', 'documents.view', 'documents.manage', 'tasks.view', 'tasks.manage', 'workflows.manage'],
  form_preparer: ['dashboard.view', 'clients.view', 'cases.view', 'cases.prepare', 'documents.view', 'documents.manage', 'tasks.view', 'tasks.manage'],
  document_reviewer: ['dashboard.view', 'clients.view', 'cases.view', 'documents.view', 'documents.review', 'tasks.view', 'tasks.manage'],
  translator: ['dashboard.view', 'clients.view', 'cases.view', 'documents.view', 'documents.translate', 'tasks.view', 'tasks.manage'],
  attorney_accredited_representative: ['dashboard.view', 'clients.view', 'clients.manage', 'cases.view', 'cases.manage', 'documents.view', 'documents.manage', 'documents.review', 'tasks.view', 'tasks.manage', 'workflows.manage', 'audit.view'],
  billing: ['dashboard.view', 'clients.view', 'cases.view', 'billing.view', 'billing.manage'],
  auditor: ['dashboard.view', 'clients.view', 'cases.view', 'documents.view', 'tasks.view', 'billing.view', 'audit.view', 'reports.view'],
  client_owner: ['portal.view', 'portal.intake', 'portal.documents', 'portal.messages'],
  client_collaborator: ['portal.view', 'portal.documents', 'portal.messages'],
});

const accessCookie = '__Host-caseflow_access';
const refreshCookie = '__Host-caseflow_refresh';
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY || serviceRoleKey;
const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();

function authError(message, status = 401) {
  return Object.assign(new Error(message), { status });
}

function parseCookies(req) {
  const values = {};
  for (const item of String(req.headers.cookie || '').split(';')) {
    const separator = item.indexOf('=');
    if (separator < 1) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    try { values[key] = decodeURIComponent(value); } catch { values[key] = ''; }
  }
  return values;
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
}

export function setSessionCookies(res, session) {
  const lifetime = Math.min(Math.max(Number(session.expires_in || 3600), 60), 3600);
  res.setHeader('set-cookie', [cookie(accessCookie, session.access_token, lifetime), cookie(refreshCookie, session.refresh_token, 60 * 60 * 24 * 30)]);
}

export function clearSessionCookies(res) {
  res.setHeader('set-cookie', [cookie(accessCookie, '', 0), cookie(refreshCookie, '', 0)]);
}

async function authRequest(path, { method = 'GET', body, token, admin = false } = {}) {
  if (!supabaseUrl || !serviceRoleKey || !anonKey) throw authError('AUTH_PROVIDER_NOT_CONFIGURED', 503);
  const apiKey = admin ? serviceRoleKey : anonKey;
  const response = await fetch(`${supabaseUrl}/auth/v1${path}`, {
    method,
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${token || apiKey}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!response.ok) {
    const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : response.status;
    throw authError(data?.msg || data?.message || data?.error_description || 'AUTH_REQUEST_FAILED', status);
  }
  return data;
}

export async function signInWithPassword(email, password) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail) || typeof password !== 'string' || password.length < 8 || password.length > 256) {
    throw authError('INVALID_CREDENTIALS', 400);
  }
  return authRequest('/token?grant_type=password', { method: 'POST', body: { email: normalizedEmail, password } });
}

export async function refreshSession(refreshToken) {
  if (!refreshToken) throw authError('SESSION_EXPIRED');
  return authRequest('/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshToken } });
}

export async function revokeSession(accessToken) {
  if (!accessToken) return;
  try { await authRequest('/logout', { method: 'POST', token: accessToken }); } catch (error) {
    if (error.status >= 500) throw error;
  }
}

async function getUser(accessToken) {
  if (!accessToken) throw authError('AUTHENTICATION_REQUIRED');
  return authRequest('/user', { token: accessToken });
}

export function permissionsForRoles(roles) {
  const permissionSet = new Set();
  for (const role of roles) for (const permission of roleDefinitions[role] || []) permissionSet.add(permission);
  return permissionSet;
}

export function hasPermission(principal, permission) {
  return principal?.permissions?.has('*') || principal?.permissions?.has(permission);
}

export function validateRoles(roles) {
  if (!Array.isArray(roles) || !roles.length) throw authError('AT_LEAST_ONE_ROLE_REQUIRED', 400);
  const unique = [...new Set(roles.map(value => String(value || '').trim()))];
  if (unique.some(role => !roleDefinitions[role])) throw authError('INVALID_ROLE', 400);
  return unique;
}

export function principalFromUser(user) {
  const metadata = user.app_metadata || {};
  const rawRoles = Array.isArray(metadata.roles) ? metadata.roles : [];
  const roles = rawRoles.filter(role => roleDefinitions[role]);
  if (ownerEmail && String(user.email || '').toLowerCase() === ownerEmail && !roles.includes('owner')) roles.push('owner');
  if (metadata.status === 'inactive') throw authError('USER_INACTIVE', 403);
  if (!roles.length) throw authError('NO_ASSIGNED_ROLE', 403);
  return {
    id: user.id,
    email: user.email,
    displayName: user.user_metadata?.full_name || user.email,
    roles,
    permissions: permissionsForRoles(roles),
    authType: 'session',
  };
}

export async function authenticateSession(req, res) {
  const cookies = parseCookies(req);
  let accessToken = cookies[accessCookie];
  try {
    return principalFromUser(await getUser(accessToken));
  } catch (error) {
    if (!cookies[refreshCookie] || error.status !== 401) throw error;
    const session = await refreshSession(cookies[refreshCookie]);
    setSessionCookies(res, session);
    accessToken = session.access_token;
    return principalFromUser(session.user || await getUser(accessToken));
  }
}

export function sessionTokens(req) {
  const cookies = parseCookies(req);
  return { accessToken: cookies[accessCookie], refreshToken: cookies[refreshCookie] };
}

export function assertSameOrigin(req) {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method || '')) return;
  if (req.headers['x-api-key']) return;
  const origin = req.headers.origin;
  if (!origin) {
    if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') throw authError('CROSS_SITE_REQUEST_BLOCKED', 403);
    return;
  }
  const forwardedProtocol = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProtocol || (String(req.headers.host || '').startsWith('localhost') ? 'http' : 'https');
  const expected = process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL).origin : `${protocol}://${req.headers.host}`;
  if (new URL(origin).origin !== expected) throw authError('CROSS_SITE_REQUEST_BLOCKED', 403);
}

export async function getAuthProvisioningStatus() {
  try {
    const data = await authRequest('/admin/users?page=1&per_page=200', { admin: true });
    const users = Array.isArray(data?.users) ? data.users : [];
    const hasOwner = users.some(user => user.app_metadata?.roles?.includes('owner') || (ownerEmail && String(user.email || '').toLowerCase() === ownerEmail));
    return { configured: true, userCount: users.length, ownerProvisioned: hasOwner };
  } catch (error) {
    return { configured: false, userCount: 0, ownerProvisioned: false, error: error.message };
  }
}

export async function listAuthUsers() {
  const data = await authRequest('/admin/users?page=1&per_page=1000', { admin: true });
  return (data?.users || []).map(user => ({
    id: user.id,
    email: user.email,
    display_name: user.user_metadata?.full_name || '',
    roles: (user.app_metadata?.roles || []).filter(role => roleDefinitions[role]),
    status: user.app_metadata?.status || (user.confirmed_at ? 'active' : 'invited'),
    last_sign_in_at: user.last_sign_in_at,
    created_at: user.created_at,
  }));
}

export async function inviteAuthUser({ email, displayName, roles }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw authError('VALID_EMAIL_REQUIRED', 400);
  const validatedRoles = validateRoles(roles);
  const invited = await authRequest('/invite', { method: 'POST', admin: true, body: { email: normalizedEmail, data: { full_name: String(displayName || '').trim().slice(0, 120) } } });
  await authRequest(`/admin/users/${encodeURIComponent(invited.id)}`, { method: 'PUT', admin: true, body: { app_metadata: { ...(invited.app_metadata || {}), roles: validatedRoles, status: 'invited' } } });
  return { id: invited.id, email: invited.email, roles: validatedRoles, status: 'invited' };
}

export async function updateAuthUser(userId, { displayName, roles, status }) {
  if (!/^[0-9a-f-]{36}$/i.test(String(userId || ''))) throw authError('INVALID_USER_ID', 400);
  const body = {};
  if (displayName !== undefined) body.user_metadata = { full_name: String(displayName || '').trim().slice(0, 120) };
  if (roles !== undefined || status !== undefined) {
    const current = await authRequest(`/admin/users/${encodeURIComponent(userId)}`, { admin: true });
    body.app_metadata = { ...(current.app_metadata || {}) };
    if (roles !== undefined) body.app_metadata.roles = validateRoles(roles);
    if (status !== undefined) {
      if (!['active', 'inactive', 'invited'].includes(status)) throw authError('INVALID_USER_STATUS', 400);
      body.app_metadata.status = status;
    }
  }
  if (!Object.keys(body).length) throw authError('NO_VALID_FIELDS', 400);
  const user = await authRequest(`/admin/users/${encodeURIComponent(userId)}`, { method: 'PUT', admin: true, body });
  return { id: user.id, email: user.email, display_name: user.user_metadata?.full_name || '', roles: user.app_metadata?.roles || [], status: user.app_metadata?.status || 'active' };
}

export function internalPrincipal() {
  return { id: null, email: null, displayName: 'Internal API', roles: ['owner'], permissions: new Set(['*']), authType: 'internal' };
}

export function safeAuditContext(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return { request_id: req.headers['x-request-id'] || crypto.randomUUID(), ip: forwarded || req.socket?.remoteAddress || null, user_agent: String(req.headers['user-agent'] || '').slice(0, 300) };
}
