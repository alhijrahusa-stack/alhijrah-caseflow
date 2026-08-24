import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransitionWorkflow, cleanDate, cleanReviewState, cleanWorkflowStage, normalizeClientInput,
  normalizeTaskInput, serviceCatalog,
} from '../src/platform.js';

test('service catalog contains unique service codes and required categories', () => {
  const codes = serviceCatalog.map(service => service.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.deepEqual(new Set(serviceCatalog.map(service => service.category)), new Set([
    'family_uscis', 'consular_dos', 'humanitarian_complex', 'administrative',
  ]));
});

test('client input is normalized without fake defaults', () => {
  const client = normalizeClientInput({ legal_name: '  Jane Doe  ', email: 'JANE@EXAMPLE.COM' });
  assert.equal(client.legal_name, 'Jane Doe');
  assert.equal(client.email, 'jane@example.com');
  assert.equal(client.date_of_birth, null);
});

test('calendar dates and workflow values are strictly validated', () => {
  assert.equal(cleanDate('2026-08-24'), '2026-08-24');
  assert.throws(() => cleanDate('08/24/2026'), /INVALID_DATE/);
  assert.equal(cleanWorkflowStage('ready_to_file'), 'ready_to_file');
  assert.throws(() => cleanWorkflowStage('almost done'), /INVALID_WORKFLOW_STAGE/);
  assert.equal(cleanReviewState('under_review'), 'under_review');
});

test('tasks require a title and constrained status', () => {
  assert.throws(() => normalizeTaskInput({}), /REQUIRED_FIELD_MISSING/);
  assert.throws(() => normalizeTaskInput({ title: 'Review packet', status: 'done-ish' }), /INVALID_TASK_STATUS/);
  assert.equal(normalizeTaskInput({ title: ' Review packet ' }).title, 'Review packet');
});

test('workflow permits operational transitions and blocks silent stage skipping', () => {
  assert.equal(canTransitionWorkflow('intake', 'awaiting_documents'), true);
  assert.equal(canTransitionWorkflow('intake', 'filed'), false);
  assert.equal(canTransitionWorkflow('filed', 'rfe_notice'), true);
  assert.equal(canTransitionWorkflow('closed', 'intake'), false);
});
