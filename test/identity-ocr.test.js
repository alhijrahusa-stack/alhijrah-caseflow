import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { addUser, backend, browserHeaders, cookieHeader, driver, resetBackend } from './helpers/harness.js';
import { handle, respondToError } from '../src/server.js';
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
  assert.equal(confirmed.body.autofill.engine, 'tesseract.js');
  assert.equal(confirmed.body.data.passport_number, 'L898902C3');
  assert.equal(backend.tables.clients.length, 1);
  assert.ok(backend.tables.audit_events.some(event => event.action === 'identity_autofill_confirmed'));
});
