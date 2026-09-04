import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { addUser, backend, browserHeaders, cookieHeader, driver, resetBackend } from './helpers/harness.js';
import { handle, respondToError, runProductionVerification } from '../src/server.js';
import { resetAuthProvisioningCache, resetLoginThrottle } from '../src/auth.js';
import { parseMrzFromText, shutdownIdentityOcr } from '../src/identity-ocr.js';

const request = driver(handle, respondToError);
const line1 = 'P<USAERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
const line2 = 'L898902C36USA7408122F1204159<<<<<<<<<<<<<<<8';

async function signIn() {
  const response = await request({
    method: 'POST', path: '/api/v1/auth/login', headers: browserHeaders(),
    body: { email: 'manager@caseflow.test', password: 'correct-horse-battery' },
  });
  assert.equal(response.status, 200);
  return cookieHeader(response.cookies);
}

async function identityImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="800">
    <rect width="1800" height="800" fill="white"/>
    <text x="60" y="120" font-family="DejaVu Sans Mono" font-size="56" fill="black">PASSPORT</text>
    <text x="60" y="220" font-family="DejaVu Sans Mono" font-size="38" fill="black">UNITED STATES OF AMERICA</text>
    <text x="60" y="650" font-family="DejaVu Sans Mono" font-size="47" letter-spacing="1" fill="black">${line1.replaceAll('<', '&lt;')}</text>
    <text x="60" y="730" font-family="DejaVu Sans Mono" font-size="47" letter-spacing="1" fill="black">${line2.replaceAll('<', '&lt;')}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

beforeEach(() => {
  resetBackend();
  resetLoginThrottle();
  resetAuthProvisioningCache();
  addUser({ email: 'manager@caseflow.test', roles: ['case_manager'], fullName: 'Case Manager' });
});

after(async () => shutdownIdentityOcr());

test('MRZ parser validates ICAO TD3 data and maps client fields', () => {
  const parsed = parseMrzFromText(`${line1}\n${line2}`);
  assert.equal(parsed.result.valid, true);
  assert.equal(parsed.result.format, 'TD3');
  assert.equal(parsed.result.documentNumber, 'L898902C3');
  assert.equal(parsed.correction_required, false);
  assert.equal(parsed.corrected_result, null);
});

test('MRZ parser never promotes an autocorrected OCR candidate as raw truth', () => {
  // The library's documented autocorrection applies only where the field type
  // is constrained. Corrupt a numeric birth-date character (0 -> O), not an
  // alphanumeric document-number character, so this exercises a real repair.
  const corrupted = 'L898902C36USA74O8122F1204159<<<<<<<<<<<<<<<8';
  const parsed = parseMrzFromText(`${line1}\n${corrupted}`);
  assert.ok(parsed);
  assert.equal(parsed.result?.valid, false);
  assert.equal(parsed.correction_required, true);
  assert.equal(parsed.corrected_result?.valid, true);
  assert.equal(parsed.corrected_result?.documentNumber, 'L898902C3');
  assert.equal(parsed.corrected_result?.fields?.birthDate, '740812');
});

test('real OCR requires review before it autofills and saves a client', async () => {
  const cookie = await signIn();
  const image = await identityImage();
  const extracted = await request({
    method: 'POST',
    path: `/api/v1/identity/ocr?filename=passport.png&size_bytes=${image.length}`,
    headers: browserHeaders({ cookie, 'content-type': 'image/png', 'content-length': String(image.length) }),
    body: image,
  });
  assert.equal(extracted.status, 200, extracted.raw);
  assert.equal(extracted.body.result.engine, 'tesseract.js');
  assert.equal(extracted.body.result.mrz.detected, true);
  assert.equal(extracted.body.result.mrz.valid, true);
  assert.equal(extracted.body.result.fields.passport_number, 'L898902C3');
  assert.match(extracted.body.extraction_id,/^[0-9a-f-]{36}$/);
  assert.equal(backend.tables.document_extractions[0].status,'pending_review');
  assert.equal(backend.tables.document_extracted_fields.find(field=>field.field_path==='passport_number').extracted_value,'L898902C3');

  const unconfirmed = await request({
    method: 'POST', path: '/api/v1/identity/confirm', headers: browserHeaders({ cookie }),
    body: { extraction_token: extracted.body.extraction_token, fields: extracted.body.result.fields },
  });
  assert.equal(unconfirmed.status, 400);
  assert.equal(unconfirmed.body.error, 'HUMAN_CONFIRMATION_REQUIRED');

  const confirmed = await request({
    method: 'POST', path: '/api/v1/identity/confirm', headers: browserHeaders({ cookie }),
    body: { extraction_token: extracted.body.extraction_token, fields: extracted.body.result.fields, confirmed: true },
  });
  assert.equal(confirmed.status, 200, confirmed.raw);
  assert.equal(confirmed.body.autofill.human_confirmed, true);
  assert.equal(confirmed.body.autofill.canonical_commit, true);
  assert.equal(confirmed.body.autofill.engine, 'tesseract.js');
  assert.equal(confirmed.body.data.passport_number, 'L898902C3');
  assert.equal(backend.tables.clients.length, 1);
  assert.equal(backend.tables.document_extractions[0].status,'confirmed');
  assert.equal(backend.tables.document_extracted_fields.find(field=>field.field_path==='passport_number').verification_status,'accepted');
  const passportFact=backend.tables.verified_canonical_fields.find(field=>field.field_path==='passport_number');
  assert.equal(passportFact.field_value,'L898902C3');
  assert.equal(passportFact.source_extraction_id,extracted.body.extraction_id);
  assert.equal(passportFact.verified_by,backend.tables.app_users[0].auth_user_id);
  const facts=await request({method:'GET',path:`/api/v1/clients/${confirmed.body.data.id}/verified-fields`,headers:browserHeaders({cookie})});
  assert.equal(facts.status,200,facts.raw);
  assert.ok(facts.body.data.some(field=>field.field_path==='passport_number'));
  assert.ok(backend.tables.audit_events.some(event => event.action === 'identity_autofill_confirmed'));
  const replay=await request({method:'POST',path:'/api/v1/identity/confirm',headers:browserHeaders({cookie}),body:{extraction_token:extracted.body.extraction_token,fields:extracted.body.result.fields,confirmed:true}});
  assert.equal(replay.status,410);
});

test('document OCR stays linked to its source and cannot classify without human confirmation',async()=>{
  const cookie=await signIn(),image=await identityImage(),caseId='30000000-0000-4000-a000-000000000003',clientId='40000000-0000-4000-a000-000000000004';backend.tables.cases.push({id:caseId,client_id:clientId,archived_at:null});backend.tables.clients.push({id:clientId,legal_name:'OCR Client',archived_at:null});
  const upload=await request({method:'POST',path:`/api/v1/documents/upload?case_id=${caseId}&filename=passport.png&size_bytes=${image.length}`,headers:browserHeaders({cookie,'content-type':'image/png','content-length':String(image.length)}),body:image});assert.equal(upload.status,201,upload.raw);const documentId=upload.body.data[0].id;
  const extracted=await request({method:'POST',path:`/api/v1/documents/${documentId}/ocr`,headers:browserHeaders({cookie}),body:{}});assert.equal(extracted.status,200,extracted.raw);assert.equal(extracted.body.source_document_id,documentId);assert.equal(extracted.body.result.fields.passport_number,'L898902C3');assert.equal(extracted.body.human_confirmation_required,true);
  const refused=await request({method:'POST',path:`/api/v1/documents/${documentId}/ocr/confirm`,headers:browserHeaders({cookie}),body:{review_token:extracted.body.review_token,category:'identity'}});assert.equal(refused.status,400);assert.equal(backend.tables.documents[0].category,null);
  const confirmed=await request({method:'POST',path:`/api/v1/documents/${documentId}/ocr/confirm`,headers:browserHeaders({cookie}),body:{review_token:extracted.body.review_token,category:'identity',fields:extracted.body.result.fields,confirmed:true}});assert.equal(confirmed.status,200,confirmed.raw);assert.equal(confirmed.body.ocr.source_document_id,documentId);assert.equal(confirmed.body.ocr.human_confirmed,true);assert.equal(confirmed.body.ocr.canonical_commit,true);assert.equal(backend.tables.documents[0].category,'identity');assert.equal(backend.tables.document_extractions[0].document_id,documentId);assert.equal(backend.tables.document_extractions[0].source_sha256,backend.tables.documents[0].content_checksum);assert.equal(backend.tables.document_extractions[0].status,'confirmed');assert.equal(backend.tables.verified_canonical_fields.find(field=>field.field_path==='passport_number').source_document_id,documentId);const history=await request({method:'GET',path:`/api/v1/documents/${documentId}/ocr`,headers:browserHeaders({cookie})});assert.equal(history.status,200,history.raw);assert.equal(history.body.data[0].id,extracted.body.extraction_id);assert.ok(history.body.data[0].fields.some(field=>field.field_path==='passport_number'));assert.ok(backend.tables.case_events.some(row=>row.event_type==='document_ocr_confirmed'&&row.payload.document_id===documentId));
});

test('background identity processing detects canonical conflicts and creates an exact review action',async()=>{
  const cookie=await signIn(),image=await identityImage(),caseId='31000000-0000-4000-a000-000000000003',clientId='41000000-0000-4000-a000-000000000004';
  backend.tables.cases.push({id:caseId,client_id:clientId,archived_at:null});backend.tables.clients.push({id:clientId,legal_name:'Conflict Client',archived_at:null});backend.tables.verified_canonical_fields.push({id:'51000000-0000-4000-a000-000000000005',client_id:clientId,subject_type:'client',subject_id:clientId,field_path:'passport_number',field_value:'DIFFERENT1',revision:1,status:'current'});
  const upload=await request({method:'POST',path:`/api/v1/documents/upload?case_id=${caseId}&filename=passport.png&size_bytes=${image.length}&category=identity`,headers:browserHeaders({cookie,'content-type':'image/png','content-length':String(image.length)}),body:image});assert.equal(upload.status,201,upload.raw);
  const job=backend.tables.background_jobs.find(item=>item.id===upload.body.processing.job_id);for(let attempt=0;attempt<200&&job.status!=='succeeded';attempt++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(job.status,'succeeded',job.last_error_code);const document=backend.tables.documents.find(item=>item.id===upload.body.data[0].id),extraction=backend.tables.document_extractions.find(item=>item.document_id===document.id);assert.equal(document.automation_status,'CONFLICT');assert.ok(extraction.raw_result.candidate_validation.conflicts.some(item=>item.field_path==='passport_number'));assert.ok(backend.tables.tasks.some(item=>item.automation_key===`document:${document.id}:v1`&&item.title==='Resolve conflicting identity fields'));
});

test('production verification exercises R2, metadata linkage, OCR, and client autofill without residue', async () => {
  backend.tables.cases.push({
    id: '10000000-0000-4000-a000-000000000001',
    client_id: '20000000-0000-4000-a000-000000000002',
    archived_at: null,
  });

  const result = await runProductionVerification(true);

  assert.equal(result.status, 'complete');
  assert.equal(result.documentUpload, true, JSON.stringify(result.errors));
  assert.equal(result.identityOcr, true, JSON.stringify(result.errors));
  assert.equal(result.clientAutofill, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, {});
  assert.equal(backend.objects.size, 0);
  assert.equal(backend.tables.documents.length, 0);
  assert.equal(backend.tables.clients.length, 0);
});
