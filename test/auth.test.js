import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasPermission,
  permissionsForRoles,
  principalFromUser,
  roleDefinitions,
  validateRoles,
} from '../src/auth.js';

test('all required production roles are defined', () => {
  assert.deepEqual(Object.keys(roleDefinitions), [
    'owner',
    'admin',
    'supervisor',
    'case_manager',
    'form_preparer',
    'document_reviewer',
    'translator',
    'attorney_accredited_representative',
    'billing',
    'auditor',
    'client_owner',
    'client_collaborator',
  ]);
});

test('owner has unrestricted access while client roles remain isolated', () => {
  assert.equal(hasPermission({ permissions: permissionsForRoles(['owner']) }, 'settings.manage'), true);
  assert.equal(hasPermission({ permissions: permissionsForRoles(['client_owner']) }, 'cases.manage'), false);
  assert.equal(hasPermission({ permissions: permissionsForRoles(['client_owner']) }, 'portal.intake'), true);
});

test('invalid and empty role assignments are rejected', () => {
  assert.throws(() => validateRoles([]), /AT_LEAST_ONE_ROLE_REQUIRED/);
  assert.throws(() => validateRoles(['owner', 'invented']), /INVALID_ROLE/);
  assert.deepEqual(validateRoles(['case_manager', 'case_manager']), ['case_manager']);
});

test('inactive and unassigned users cannot become principals', () => {
  assert.throws(
    () => principalFromUser({ id: '1', email: 'inactive@example.com', app_metadata: { roles: ['admin'], status: 'inactive' } }),
    /USER_INACTIVE/,
  );
  assert.throws(
    () => principalFromUser({ id: '2', email: 'none@example.com', app_metadata: {} }),
    /NO_ASSIGNED_ROLE/,
  );
});
