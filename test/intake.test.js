import test from 'node:test';
import assert from 'node:assert/strict';
import { intakeDefinition, intakeServiceCodes, validateIntakeAnswers } from '../src/intake-definitions.js';
import { serviceCatalog } from '../src/platform.js';

test('every catalog service has a versioned service-specific intake', () => {
  assert.deepEqual(new Set(intakeServiceCodes), new Set(serviceCatalog.map(service => service.code)));
  for (const service of serviceCatalog) {
    const definition = intakeDefinition(service.code);
    assert.equal(definition.version, 1);
    assert.equal(definition.service_code, service.code);
    assert.ok(definition.sections.find(section => section.id === 'service_details').fields.length >= 2);
  }
});

test('family, court and administrative intakes do not share the same service questions', () => {
  const ids = code => intakeDefinition(code).sections.find(section => section.id === 'service_details').fields.map(field => field.id);
  assert.notDeepEqual(ids('I-130'), ids('EOIR'));
  assert.notDeepEqual(ids('EOIR'), ids('TRANSLATION'));
});

test('drafts allow partial answers while submission enforces required fields', () => {
  const definition = intakeDefinition('I-130');
  assert.deepEqual(validateIntakeAnswers(definition, { legal_name: 'Test' }), { legal_name: 'Test' });
  assert.throws(() => validateIntakeAnswers(definition, { legal_name: 'Test' }, { final: true }), /INTAKE_REQUIRED_FIELDS_MISSING/);
  assert.throws(() => validateIntakeAnswers(definition, { invented_field: true }), /UNKNOWN_INTAKE_FIELD/);
});

test('family intakes accept structured repeatable people and reject unknown fields', () => {
  const definition = intakeDefinition('I-130');
  assert.ok(definition.sections.some(section => section.id === 'family_members'));
  assert.doesNotThrow(() => validateIntakeAnswers(definition, {
    family_members: [{ legal_name: 'Person One', relationship: 'child', date_of_birth: '2015-01-01' }],
  }));
  assert.throws(() => validateIntakeAnswers(definition, {
    family_members: [{ legal_name: 'Person One', relationship: 'child', secret: 'no' }],
  }), /UNKNOWN_REPEATABLE_FIELD/);
});
