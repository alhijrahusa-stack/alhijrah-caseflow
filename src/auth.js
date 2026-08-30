import crypto from 'node:crypto';

export const roleDefinitions = Object.freeze({
  owner: ['*'],
  admin: ['dashboard.view', 'users.view', 'users.manage', 'clients.view', 'clients.manage', 'cases.view', 'cases.manage', 'cases.prepare', 'documents.view', 'documents.manage', 'documents.review', 'tasks.view', 'tasks.manage', 'workflows.manage', 'billing.view', 'billing.manage', 'audit.view', 'reports.view', 'imports.manage', 'settings.manage'],
  supervisor: ['dashboard.view', 'users.view', 'clients.view', 'clients.manage', 'cases.view', 'cases.manage', 'cases.prepare', 'documents.view', 'documents.manage', 'documents.review', 'tasks.view', 'tasks.manage', 'workflows.manage', 'audit.view', 'reports.view', 'imports.manage'],
  case_manager: ['dashboard.view', 'clients.view', 'clients.manage', 'cases.view', 'cases.manage', 'cases.prepare', 'documents.view', 'documents.manage', 'tasks.view', 'tasks.manage', 'workflows.manage'],
  form_preparer: ['dashboard.view', 'clients.view', 'cases.view', 'cases.prepare', 'documents.view', 'documents.manage', 'tasks.view', 'tasks.manage'],
  document_reviewer: ['dashboard.view', 'clients.view', 'cases.view', 'documents.view', 'documents.review', 'tasks.view', 'tasks.manage'],
  translator: ['dashboard.view', 'clients.view', 'cases.view', 'documents.view', 'documents.translate', 'tasks.view', 'tasks.manage'],
  attorney_accredited_representative: ['dashboard.view', 'clients.view', 'clients.manage', 'cases.view', 'cases.manage', 'cases.prepare', 'documents.view', 'documents.manage', 'documents.review', 'tasks.view', 'tasks.manage', 'workflows.manage', 'audit.view'],
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
const appBaseUrl = process.env.APP_BASE_URL?.replace(/\/$/, '');
const productionAppUrl = 'https://alhijrah-caseflow-production-716b.up.railway.app';

export function activationRedirectUrl() {
  try {
    const configured = new URL(appBaseUrl || '');
    if (configured.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(configured.hostname)) {
      return configured.origin;
    }
  } catch {}
  return productionAppUrl;
}

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

// A small local bound protects one process from a burst; the authoritative
// counter is the atomic PostgreSQL RPC below, shared by every replica.
const loginAttempts = new Map();
const maxLoginAttempts = 8;
const loginWindowMs = 15 * 60 * 1000;
const maxTrackedIdentities = 10_000;

export function loginThrottleKey(email, req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req?.socket?.remoteAddress || 'unknown';
  return `${ip}|${String(email || '').trim().toLowerCase()}`;
}

function sharedThrottleHash(key){
  const secret=process.env.LOGIN_THROTTLE_SECRET||serviceRoleKey;
  if(!secret)throw authError('AUTH_THROTTLE_NOT_CONFIGURED',503);
  return crypto.createHmac('sha256',secret).update(key).digest('hex');
}

async function throttleRpc(name,body){
  if(!supabaseUrl||!serviceRoleKey)throw authError('AUTH_THROTTLE_NOT_CONFIGURED',503);
  const response=await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:serviceRoleKey,authorization:`Bearer ${serviceRoleKey}`,'content-type':'application/json'},body:JSON.stringify(body)});
  const text=await response.text();let data;try{data=text?JSON.parse(text):null}catch{data=null}
  if(!response.ok)throw authError('AUTH_THROTTLE_UNAVAILABLE',503);
  return Array.isArray(data)?data[0]:data;
}

async function consumeSharedLoginAttempt(key){
  const result=await throttleRpc('consume_login_attempt',{p_key_hash:sharedThrottleHash(key),p_limit:maxLoginAttempts,p_window_seconds:Math.floor(loginWindowMs/1000)});
  if(result?.allowed!==true)throw authError('TOO_MANY_LOGIN_ATTEMPTS',429);
}

async function clearSharedLoginAttempts(key){
  await throttleRpc('clear_login_attempt',{p_key_hash:sharedThrottleHash(key)});
}

function consumeLoginAttempt(key, now = Date.now()) {
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.first > loginWindowMs) {
    loginAttempts.set(key, { count: 1, first: now });
    // Bound memory against an attacker rotating identities.
    if (loginAttempts.size > maxTrackedIdentities) loginAttempts.delete(loginAttempts.keys().next().value);
    return;
  }
  entry.count += 1;
  if (entry.count > maxLoginAttempts) throw authError('TOO_MANY_LOGIN_ATTEMPTS', 429);
}

export function clearLoginAttempts(key) {
  loginAttempts.delete(key);
}

export function resetLoginThrottle() {
  loginAttempts.clear();
}

export async function signInWithPassword(email, password, req) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const throttleKey = loginThrottleKey(normalizedEmail, req);
  // Count before validating, so malformed submissions are not a free probe.
  consumeLoginAttempt(throttleKey);
  // The shared boundary is identity-wide, so changing source IP or moving to
  // another replica cannot multiply the effective allowance. The database
  // stores only the HMAC, never the submitted email.
  await consumeSharedLoginAttempt(normalizedEmail);
  if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail) || typeof password !== 'string' || password.length < 8 || password.length > 256) {
    throw authError('INVALID_CREDENTIALS', 400);
  }
  const session = await authRequest('/token?grant_type=password', { method: 'POST', body: { email: normalizedEmail, password } });
  clearLoginAttempts(throttleKey);
  await clearSharedLoginAttempts(normalizedEmail);
  return session;
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
  // Bootstrap owner by email, but only for a confirmed address. Without the
  // confirmation check, anyone able to self-register OWNER_EMAIL on the
  // Supabase project would be handed the '*' permission.
  const emailConfirmed = Boolean(user.email_confirmed_at || user.confirmed_at);
  if (ownerEmail && emailConfirmed && String(user.email || '').toLowerCase() === ownerEmail && !roles.includes('owner')) roles.push('owner');
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

function parseOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

// Origins a state-changing browser request may legitimately carry: the app's
// own origin plus any explicitly configured cross-origin client.
export function trustedOrigins(req) {
  const origins = new Set();
  const configured = parseOrigin(process.env.APP_BASE_URL || '');
  if (configured) origins.add(configured);
  for (const entry of String(process.env.CORS_ORIGINS || '').split(',')) {
    const origin = parseOrigin(entry.trim());
    if (origin) origins.add(origin);
  }
  // Fall back to the request's own Host only when nothing is configured. Host
  // is client-supplied, so deriving the expected origin from it makes the
  // comparison a tautology; it exists solely so local development works.
  if (!configured && req?.headers?.host) {
    const forwardedProtocol = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const host = String(req.headers.host);
    const protocol = forwardedProtocol || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https');
    const derived = parseOrigin(`${protocol}://${host}`);
    if (derived) origins.add(derived);
  }
  return origins;
}

export function assertSameOrigin(req) {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method || '')) return;
  // Internal machine-to-machine callers authenticate with a bearer secret a
  // browser cannot attach cross-site, so CSRF does not apply to them.
  if (req.headers['x-api-key']) return;

  const fetchSite = req.headers['sec-fetch-site'];
  const origin = req.headers.origin;

  if (!origin) {
    // Fail closed. A cookie-authenticated browser always sends at least one of
    // Origin or Sec-Fetch-Site on a state-changing request; a caller sending
    // neither is a non-browser client (which must use x-api-key) or a stripped
    // cross-site request.
    if (!fetchSite || fetchSite !== 'same-origin') throw authError('CROSS_SITE_REQUEST_BLOCKED', 403);
    return;
  }

  // A malformed or opaque Origin (sandboxed iframes and cross-origin redirects
  // both send the literal "null") is untrusted, not a server error.
  const requestOrigin = parseOrigin(origin);
  if (!requestOrigin || !trustedOrigins(req).has(requestOrigin)) throw authError('CROSS_SITE_REQUEST_BLOCKED', 403);
}

// /health, /ready and /api/v1/auth/status are unauthenticated and each used to
// issue a fresh service-role admin listing, letting any anonymous caller drive
// unbounded privileged traffic at the auth provider. Cache the probe so the
// admin API is hit at most once per TTL regardless of request volume.
let provisioningCache = null;
const provisioningTtlMs = 30_000;

export function resetAuthProvisioningCache() {
  provisioningCache = null;
}

export async function getAuthProvisioningStatus({ now = Date.now() } = {}) {
  if (provisioningCache && now - provisioningCache.at < provisioningTtlMs) return provisioningCache.value;
  const value = await probeAuthProvisioning();
  provisioningCache = { at: now, value };
  return value;
}

async function probeAuthProvisioning() {
  try {
    const data = await authRequest('/admin/users?page=1&per_page=1000', { admin: true });
    const users = Array.isArray(data?.users) ? data.users : [];
    const hasOwner = users.some(user => {
      const confirmed = Boolean(user.email_confirmed_at || user.confirmed_at);
      const active = user.app_metadata?.status === 'active';
      const assigned = user.app_metadata?.roles?.includes('owner')
        || (ownerEmail && String(user.email || '').toLowerCase() === ownerEmail);
      return confirmed && active && assigned;
    });
    return { configured: true, userCount: users.length, ownerProvisioned: hasOwner };
  } catch (error) {
    const errorCode = error.status === 401 || error.status === 403
      ? 'AUTH_ADMIN_KEY_REJECTED'
      : error.status === 404
        ? 'AUTH_ENDPOINT_NOT_FOUND'
        : error.status >= 500
          ? 'AUTH_PROVIDER_UNAVAILABLE'
          : 'AUTH_PROVIDER_CHECK_FAILED';
    return { configured: false, userCount: 0, ownerProvisioned: false, errorCode };
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

export async function inviteAuthUser({ email, displayName, roles, redirectTo = activationRedirectUrl() }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw authError('VALID_EMAIL_REQUIRED', 400);
  const validatedRoles = validateRoles(roles);
  const redirect = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
  const invited = await authRequest(`/invite${redirect}`, { method: 'POST', admin: true, body: { email: normalizedEmail, data: { full_name: String(displayName || '').trim().slice(0, 120) } } });
  await authRequest(`/admin/users/${encodeURIComponent(invited.id)}`, { method: 'PUT', admin: true, body: { app_metadata: { ...(invited.app_metadata || {}), roles: validatedRoles, status: 'invited' } } });
  resetAuthProvisioningCache();
  return { id: invited.id, email: invited.email, roles: validatedRoles, status: 'invited' };
}

export async function ensureConfiguredOwnerInvitation() {
  if (!ownerEmail) return { invited: false, reason: 'OWNER_EMAIL_NOT_CONFIGURED' };
  const data = await authRequest('/admin/users?page=1&per_page=1000', { admin: true });
  const existing = (data?.users || []).find(user => String(user.email || '').toLowerCase() === ownerEmail);
  if (existing) {
    if (existing.app_metadata?.status === 'invited') {
      const resent = await resendConfiguredOwnerActivation();
      return { invited: false, resent: true, userId: resent.userId, redirectTo: resent.redirectTo };
    }
    return { invited: false, reason: 'OWNER_ACCOUNT_EXISTS' };
  }
  const invited = await inviteAuthUser({ email: ownerEmail, displayName: 'Owner', roles: ['owner'] });
  return { invited: true, userId: invited.id };
}

export async function resendConfiguredOwnerActivation() {
  if (!ownerEmail) throw authError('OWNER_EMAIL_NOT_CONFIGURED', 503);
  const data = await authRequest('/admin/users?page=1&per_page=1000', { admin: true });
  const existing = (data?.users || []).find(user => String(user.email || '').toLowerCase() === ownerEmail);
  if (!existing) throw authError('OWNER_ACCOUNT_NOT_FOUND', 404);
  const roles = [...new Set([...(existing.app_metadata?.roles || []).filter(role => roleDefinitions[role]), 'owner'])];
  await authRequest(`/admin/users/${encodeURIComponent(existing.id)}`, {
    method: 'PUT',
    admin: true,
    body: { app_metadata: { ...(existing.app_metadata || {}), roles, status: 'invited' } },
  });
  const redirectTo = activationRedirectUrl();
  await authRequest(`/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: 'POST',
    body: { email: ownerEmail },
  });
  resetAuthProvisioningCache();
  return { sent: true, userId: existing.id, redirectTo };
}

export async function acceptInvitedUser({ accessToken, password }, req) {
  if (typeof accessToken !== 'string' || accessToken.length < 20 || accessToken.length > 8192) {
    throw authError('INVALID_INVITATION', 400);
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw authError('PASSWORD_REQUIREMENTS_NOT_MET', 400);
  }
  const user = await getUser(accessToken);
  const roles = (user.app_metadata?.roles || []).filter(role => roleDefinitions[role]);
  if (!roles.length || user.app_metadata?.status !== 'invited') throw authError('INVALID_INVITATION', 403);
  await authRequest('/user', { method: 'PUT', token: accessToken, body: { password } });
  await authRequest(`/admin/users/${encodeURIComponent(user.id)}`, {
    method: 'PUT',
    admin: true,
    body: { app_metadata: { ...(user.app_metadata || {}), roles, status: 'active' } },
  });
  resetAuthProvisioningCache();
  return signInWithPassword(user.email, password, req);
}

export async function getAuthUser(userId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(userId || ''))) throw authError('INVALID_USER_ID', 400);
  const user = await authRequest(`/admin/users/${encodeURIComponent(userId)}`, { admin: true });
  return {
    id: user.id,
    email: user.email,
    roles: (user.app_metadata?.roles || []).filter(role => roleDefinitions[role]),
    status: user.app_metadata?.status || 'active',
  };
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
