// A standalone stand-in for Supabase Auth + PostgREST, so the end-to-end suite
// drives the real server process against a real HTTP backend without touching
// a live project. It implements only the endpoints the API actually calls.

import http from 'node:http';
import crypto from 'node:crypto';

const users = new Map();
const sessions = new Map();
const tables = Object.fromEntries([
  'cases','documents','case_events','audit_events','clients','app_users','user_roles','case_assignments',
  'client_access','teams','team_members','access_policies','record_access_grants','tasks','deadlines',
  'legal_holds','document_requests','agency_requests','evidence_requirements','evidence_links','case_notes','case_messages','appointments','invoices','payments',
  'alerts','retention_policies','intake_definitions','intake_submissions','service_catalog','people',
  'client_people','case_people','form_role_assignments',
  'office_settings','communication_templates','outbound_communications',
  // The workspace probes these on load. Without them the run is green but the
  // server log carries DATABASE_REQUEST_FAILED for a table production has.
  'import_batches','import_rows','person_history_records','family_relationships',
  'participant_match_reviews','form_registry','form_versions','form_definitions',
  'form_instances','form_rules','form_answers','form_findings','background_jobs',
  'generated_artifacts','ai_review_runs','ai_findings','controlled_document_templates',
  'form_update_alerts',
].map(name => [name, []]));
tables.office_settings.push({ singleton:true, office_name:'ALHIJRAH SERVICES', default_language:'English' });
tables.communication_templates.push({ id:crypto.randomUUID(),template_key:'case_opened',version:1,subject_en:'Your case is now open — {Case_Number}',subject_ar:'تم فتح ملفكم — {Case_Number}',body_en:'Your case has been opened successfully.',body_ar:'تم فتح ملفكم بنجاح.',active:true });
let clientNumber = 0;
let caseNumber = 0;
const loginThrottles = new Map();

// The service catalogue is seeded by the core_platform migration in a real
// deployment, so the stub seeds it too and the workspace renders as it would.
const { serviceCatalog } = await import('../../src/platform.js');
for (const service of serviceCatalog) tables.service_catalog.push({ ...service, active: true });

function seed(email, roles, fullName) {
  const id = crypto.randomUUID();
  // main resolves the effective principal from app_users + user_roles.
  tables.app_users.push({ auth_user_id: id, display_name: fullName, email, status: 'active', preferred_language:'English' });
  for (const role of roles) tables.user_roles.push({ auth_user_id: id, role_code: role });
  users.set(email, {
    id,
    email,
    password: 'correct-horse-battery',
    app_metadata: { roles },
    user_metadata: { full_name: fullName },
    email_confirmed_at: new Date().toISOString(),
    confirmed_at: new Date().toISOString(),
  });
}

seed('manager@caseflow.test', ['case_manager'], 'Case Manager');
seed('auditor@caseflow.test', ['auditor'], 'Compliance Auditor');
seed('client@caseflow.test', ['client_owner'], 'Portal Client');
seed('owner@caseflow.test', ['owner'], 'Firm Owner');

function withoutPassword(user) {
  const { password, ...rest } = user;
  return rest;
}

function send(res, status, body) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

function filter(rows, params) {
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
    if (operator === 'ilike') return String(row[column] ?? '').toLowerCase().includes(decodeURIComponent(value).replaceAll('*','').toLowerCase());
    if (operator === 'in') {
      const members = new Set(value.replace(/^\(|\)$/g, '').split(',').filter(Boolean));
      return members.has(String(row[column] ?? ''));
    }
    return false;
  }));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://stub');
  const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : undefined;
  const bearer = String(req.headers.authorization || '').replace(/^Bearer /, '');

  if (url.pathname === '/auth/v1/token') {
    if (url.searchParams.get('grant_type') === 'password') {
      const user = users.get(String(body?.email || '').toLowerCase());
      if (!user || user.password !== body.password) return send(res, 400, { error_description: 'INVALID_CREDENTIALS' });
      const accessToken = `access-${crypto.randomUUID()}`;
      sessions.set(accessToken, user.email);
      return send(res, 200, { access_token: accessToken, refresh_token: `refresh-${crypto.randomUUID()}`, expires_in: 3600, user: withoutPassword(user) });
    }
    return send(res, 401, { message: 'invalid refresh token' });
  }

  if (url.pathname === '/auth/v1/user') {
    const email = sessions.get(bearer);
    if (!email) return send(res, 401, { message: 'invalid token' });
    return send(res, 200, withoutPassword(users.get(email)));
  }

  if (url.pathname === '/auth/v1/logout') {
    sessions.delete(bearer);
    return send(res, 204);
  }

  if (url.pathname === '/auth/v1/admin/users') {
    return send(res, 200, { users: [...users.values()].map(withoutPassword) });
  }

  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.replace('/rest/v1/', '');
    if (table === 'rpc/consume_login_attempt' && req.method === 'POST') {
      const now=Date.now(),windowMs=Number(body.p_window_seconds)*1000;
      let entry=loginThrottles.get(body.p_key_hash);
      if(!entry||now-entry.first>=windowMs)entry={count:0,first:now};
      entry.count+=1;loginThrottles.set(body.p_key_hash,entry);
      return send(res,200,{allowed:entry.count<=Number(body.p_limit),attempt_count:entry.count,retry_after_seconds:Math.max(0,Math.ceil((entry.first+windowMs-now)/1000))});
    }
    if (table === 'rpc/clear_login_attempt' && req.method === 'POST') {
      loginThrottles.delete(body.p_key_hash);
      return send(res,200,null);
    }
    const rows = tables[table];
    if (!rows) return send(res, 404, { message: `relation "${table}" does not exist` });

    if (req.method === 'GET') {
      let result = filter(rows, url.searchParams);
      if (url.searchParams.has('or')) result = applyOr(result, url.searchParams.get('or'));
      const order = url.searchParams.get('order');
      if (order) {
        const [column] = order.split('.');
        result = [...result].sort((a, b) => String(b[column] ?? '').localeCompare(String(a[column] ?? '')));
      }
      const limit = Number(url.searchParams.get('limit') || 0);
      if (limit > 0) result = result.slice(0, limit);
      return send(res, 200, result);
    }
    if (req.method === 'POST') {
      const record = { created_at: new Date().toISOString(), ...body };
      if (table === 'cases') {
        record.updated_at = record.updated_at || record.created_at;
        record.case_number ||= `AH-2026-${String(++caseNumber).padStart(6,'0')}`;
        record.case_reference ||= record.case_number;
        record.opened_on ||= '2026-08-27';
      }
      if (table === 'clients') record.client_number ||= `AHC-2026-${String(++clientNumber).padStart(6,'0')}`;
      rows.push(record);
      return send(res, 201, [record]);
    }
    if (req.method === 'PATCH') {
      const matched = filter(rows, url.searchParams);
      for (const row of matched) Object.assign(row, body);
      return send(res, 200, matched);
    }
    if (req.method === 'DELETE') {
      const matched = filter(rows, url.searchParams);
      tables[table] = rows.filter(row => !matched.includes(row));
      return send(res, 204);
    }
  }

  return send(res, 404, { message: 'not found' });
});

const port = Number(process.env.STUB_PORT || 54321);
server.listen(port, '127.0.0.1', () => console.log(`stub supabase on ${port}`));
