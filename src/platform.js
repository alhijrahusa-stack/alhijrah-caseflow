export const workflowStages = Object.freeze([
  'intake', 'awaiting_documents', 'documents_received', 'form_preparation',
  'internal_review', 'client_review', 'ready_to_file', 'filed',
  'receipt_received', 'rfe_notice', 'interview_scheduled', 'decision', 'closed',
]);

export const reviewStates = Object.freeze([
  'prepared', 'ready_for_review', 'under_review', 'changes_requested',
  'approved', 'ready_for_client', 'client_approved', 'ready_to_file',
]);

export const serviceCatalog = Object.freeze([
  ['family_uscis', 'I-130', 'Petition for Alien Relative'],
  ['family_uscis', 'I-485', 'Adjustment of Status'],
  ['family_uscis', 'I-864', 'Affidavit of Support'],
  ['family_uscis', 'I-864A', 'Household Member Contract'],
  ['family_uscis', 'I-765', 'Employment Authorization'],
  ['family_uscis', 'I-131', 'Travel Document'],
  ['family_uscis', 'I-751', 'Remove Conditions on Residence'],
  ['family_uscis', 'N-400', 'Naturalization'],
  ['family_uscis', 'I-90', 'Replace Permanent Resident Card'],
  ['consular_dos', 'DS-260', 'Immigrant Visa Application'],
  ['consular_dos', 'NVC', 'National Visa Center Processing'],
  ['consular_dos', 'CONSULAR', 'Consular Processing'],
  ['consular_dos', 'K-1', 'Fiancé Visa'],
  ['humanitarian_complex', 'ASYLUM', 'Asylum'],
  ['humanitarian_complex', 'EOIR', 'Immigration Court'],
  ['humanitarian_complex', 'REMOVAL', 'Removal Defense Intake'],
  ['humanitarian_complex', 'DETENTION', 'Immigration Detention'],
  ['humanitarian_complex', 'BIA-APPEAL', 'BIA Appeal'],
  ['humanitarian_complex', 'MTR', 'Motion to Reopen'],
  ['humanitarian_complex', 'MTC', 'Motion to Reconsider'],
  ['humanitarian_complex', 'I-601', 'Waiver of Inadmissibility'],
  ['humanitarian_complex', 'I-601A', 'Provisional Unlawful Presence Waiver'],
  ['humanitarian_complex', 'VAWA', 'VAWA Self-Petition'],
  ['humanitarian_complex', 'U-VISA', 'U Nonimmigrant Status'],
  ['humanitarian_complex', 'T-VISA', 'T Nonimmigrant Status'],
  ['humanitarian_complex', 'SIJS', 'Special Immigrant Juvenile Status'],
  ['humanitarian_complex', 'TPS', 'Temporary Protected Status'],
  ['administrative', 'PASSPORT', 'Passport Renewal'],
  ['administrative', 'TRANSLATION', 'Document Translation'],
  ['administrative', 'NOTARY', 'Notary Service'],
  ['administrative', 'POA', 'Power of Attorney'],
  ['administrative', 'FLIGHT', 'Flight Booking'],
].map(([category, code, name]) => Object.freeze({ category, code, name })));

const allowedPriorities = new Set(['low', 'normal', 'high', 'urgent']);
const allowedTaskStatuses = new Set(['open', 'in_progress', 'blocked', 'completed', 'cancelled']);

export function cleanText(value, { required = false, max = 255 } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) throw Object.assign(new Error('REQUIRED_FIELD_MISSING'), { status: 400 });
  if (text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw Object.assign(new Error('INVALID_TEXT_VALUE'), { status: 400 });
  }
  return text || null;
}

export function cleanEmail(value) {
  const email = cleanText(value, { max: 254 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('INVALID_EMAIL'), { status: 400 });
  return email?.toLowerCase() || null;
}

export function cleanDate(value, { required = false } = {}) {
  if (!value && !required) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || Number.isNaN(Date.parse(String(value) + 'T00:00:00Z'))) {
    throw Object.assign(new Error('INVALID_DATE'), { status: 400 });
  }
  return String(value);
}

export function cleanPriority(value = 'normal') {
  const priority = String(value);
  if (!allowedPriorities.has(priority)) throw Object.assign(new Error('INVALID_PRIORITY'), { status: 400 });
  return priority;
}

export function cleanTaskStatus(value = 'open') {
  const status = String(value);
  if (!allowedTaskStatuses.has(status)) throw Object.assign(new Error('INVALID_TASK_STATUS'), { status: 400 });
  return status;
}

export function cleanWorkflowStage(value = 'intake') {
  const stage = String(value);
  if (!workflowStages.includes(stage)) throw Object.assign(new Error('INVALID_WORKFLOW_STAGE'), { status: 400 });
  return stage;
}

export function cleanReviewState(value = 'prepared') {
  const state = String(value);
  if (!reviewStates.includes(state)) throw Object.assign(new Error('INVALID_REVIEW_STATE'), { status: 400 });
  return state;
}

export function normalizeClientInput(body) {
  return {
    legal_name: cleanText(body.legal_name, { required: true, max: 180 }),
    alternate_names: Array.isArray(body.alternate_names) ? body.alternate_names.map(v => cleanText(v, { max: 180 })).filter(Boolean).slice(0, 20) : [],
    date_of_birth: cleanDate(body.date_of_birth),
    place_of_birth: cleanText(body.place_of_birth, { max: 180 }),
    nationality: cleanText(body.nationality, { max: 100 }),
    current_country: cleanText(body.current_country, { max: 100 }),
    phone: cleanText(body.phone, { max: 40 }),
    whatsapp: cleanText(body.whatsapp, { max: 40 }),
    email: cleanEmail(body.email),
    physical_address: cleanText(body.physical_address, { max: 500 }),
    mailing_address: cleanText(body.mailing_address, { max: 500 }),
    postal_code: cleanText(body.postal_code, { max: 20 }),
    immigration_status: cleanText(body.immigration_status, { max: 120 }),
    a_number: cleanText(body.a_number, { max: 20 }),
    uscis_account_number: cleanText(body.uscis_account_number, { max: 20 }),
    passport_number: cleanText(body.passport_number, { max: 40 }),
    passport_country: cleanText(body.passport_country, { max: 100 }),
    passport_expiration: cleanDate(body.passport_expiration),
    preferred_language: cleanText(body.preferred_language, { max: 50 }) || 'English',
    operational_notes: cleanText(body.operational_notes, { max: 5000 }),
  };
}

export function normalizeTaskInput(body) {
  return {
    title: cleanText(body.title, { required: true, max: 200 }),
    description: cleanText(body.description, { max: 5000 }),
    case_id: body.case_id || null,
    client_id: body.client_id || null,
    assigned_user_id: body.assigned_user_id || null,
    due_date: cleanDate(body.due_date),
    priority: cleanPriority(body.priority),
    status: cleanTaskStatus(body.status),
  };
}
