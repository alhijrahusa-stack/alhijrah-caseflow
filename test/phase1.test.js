import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { addUser, backend, browserHeaders, cookieHeader, driver, resetBackend } from './helpers/harness.js';
import { handle, respondToError } from '../src/server.js';
import { resetAuthProvisioningCache, resetLoginThrottle } from '../src/auth.js';

const request = driver(handle, respondToError);

beforeEach(() => {
  resetBackend();
  resetLoginThrottle();
  resetAuthProvisioningCache();
  addUser({ email: 'manager@caseflow.test', roles: ['case_manager'], fullName: 'Case Manager' });
});

async function signIn() {
  const response = await request({ method: 'POST', path: '/api/v1/auth/login', headers: browserHeaders(), body: { email: 'manager@caseflow.test', password: 'correct-horse-battery' } });
  assert.equal(response.status, 200);
  return cookieHeader(response.cookies);
}

test('client and case numbers are generated, immutable, linked, and included in the opening email', async () => {
  const cookie = await signIn();
  const createdClient = await request({
    method: 'POST', path: '/api/v1/clients', headers: browserHeaders({ cookie }),
    body: { legal_name: 'Amina Hassan', legal_name_ar: 'أمينة حسن', email: 'amina@example.com', preferred_language: 'Arabic' },
  });
  assert.equal(createdClient.status, 201, createdClient.raw);
  const client = createdClient.body.data[0];
  assert.match(client.client_number, /^AHC-2026-\d{6}$/);

  const createdCase = await request({
    method: 'POST', path: '/api/v1/cases', headers: browserHeaders({ cookie }),
    body: { client_id: client.id, service_code: 'I-130', case_type: 'Petition for Alien Relative', priority: 'high' },
  });
  assert.equal(createdCase.status, 201, createdCase.raw);
  const caseRecord = createdCase.body.data[0];
  assert.match(caseRecord.case_number, /^AH-2026-\d{6}$/);
  assert.equal(caseRecord.case_reference, caseRecord.case_number);
  assert.equal(createdCase.body.communication.status, 'sent');
  assert.equal(backend.emails.length, 1);
  assert.match(backend.emails[0].subject, new RegExp(caseRecord.case_number));
  assert.match(backend.emails[0].html, /dir="rtl"/);
  assert.match(backend.emails[0].html, new RegExp(client.client_number));
  assert.equal(backend.tables.outbound_communications[0].client_id, client.id);
  assert.equal(backend.tables.outbound_communications[0].case_id, caseRecord.id);
  assert.equal(backend.tables.outbound_communications[0].status, 'sent');

  const clientNumberChange = await request({ method: 'PATCH', path: `/api/v1/clients/${client.id}`, headers: browserHeaders({ cookie }), body: { client_number: 'ALTERED', legal_name: client.legal_name } });
  assert.equal(clientNumberChange.status, 200);
  assert.equal(clientNumberChange.body.data[0].client_number, client.client_number);
  const caseNumberChange = await request({ method: 'PATCH', path: `/api/v1/cases/${caseRecord.id}`, headers: browserHeaders({ cookie }), body: { case_number: 'ALTERED' } });
  assert.equal(caseNumberChange.status, 400);
});

test('the case workspace resolves every Phase 1 surface through the canonical case and client', async () => {
  const cookie = await signIn();
  const clientResponse = await request({ method: 'POST', path: '/api/v1/clients', headers: browserHeaders({ cookie }), body: { legal_name: 'Workspace Client', preferred_language: 'English' } });
  const client = clientResponse.body.data[0];
  const caseResponse = await request({ method: 'POST', path: '/api/v1/cases', headers: browserHeaders({ cookie }), body: { client_id: client.id, service_code: 'N-400', case_type: 'Naturalization', priority: 'normal' } });
  const caseRecord = caseResponse.body.data[0];
  backend.tables.tasks.push({ id: '10000000-0000-4000-a000-000000000001', case_id: caseRecord.id, title: 'Collect evidence', status: 'open', priority: 'normal' });
  backend.tables.deadlines.push({ id: '20000000-0000-4000-a000-000000000002', case_id: caseRecord.id, title: 'Filing deadline', deadline_date: '2026-09-10', status: 'open' });
  backend.tables.case_notes.push({ id: '30000000-0000-4000-a000-000000000003', case_id: caseRecord.id, body: 'Internal note', visibility: 'internal' });

  const workspace = await request({ method: 'GET', path: `/api/v1/cases/${caseRecord.id}/workspace`, headers: browserHeaders({ cookie }) });
  assert.equal(workspace.status, 200, workspace.raw);
  assert.equal(workspace.body.data.case.id, caseRecord.id);
  assert.equal(workspace.body.data.case.client_id, client.id);
  assert.equal(workspace.body.data.client.id, client.id);
  assert.equal(workspace.body.data.client.client_number, client.client_number);
  for (const collection of ['people','assignments','tasks','deadlines','documents','document_requests','notes','appointments','intakes','messages','communications','invoices','payments','timeline','audit']) {
    assert.ok(Array.isArray(workspace.body.data[collection]), `${collection} must be a persisted workspace collection`);
  }
  assert.equal(workspace.body.data.tasks[0].title, 'Collect evidence');
  assert.equal(workspace.body.data.deadlines[0].deadline_date, '2026-09-10');
});

test('staff language preference persists per authenticated user', async () => {
  const cookie = await signIn();
  const update = await request({ method: 'PATCH', path: '/api/v1/profile/preferences', headers: browserHeaders({ cookie }), body: { display_name: 'مدير الملف', preferred_language: 'Arabic' } });
  assert.equal(update.status, 200, update.raw);
  const me = await request({ method: 'GET', path: '/api/v1/auth/me', headers: browserHeaders({ cookie }) });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.preferred_language, 'Arabic');
  assert.equal(me.body.user.display_name, 'مدير الملف');
  assert.ok(backend.tables.audit_events.some(event => event.action === 'profile_preferences_updated'));
});
