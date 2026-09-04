export const workflowStages = Object.freeze([
  'intake', 'awaiting_documents', 'documents_received', 'form_preparation',
  'internal_review', 'client_review', 'ready_to_file', 'filed',
  'receipt_received', 'rfe_notice', 'interview_scheduled', 'decision', 'closed',
]);

export const reviewStates = Object.freeze([
  'prepared', 'ready_for_review', 'under_review', 'changes_requested',
  'approved', 'ready_for_client', 'client_approved', 'ready_to_file',
]);

export const workflowTransitions = Object.freeze({
  intake: ['awaiting_documents', 'closed'],
  awaiting_documents: ['intake', 'documents_received', 'closed'],
  documents_received: ['awaiting_documents', 'form_preparation', 'closed'],
  form_preparation: ['documents_received', 'internal_review', 'closed'],
  internal_review: ['form_preparation', 'client_review', 'closed'],
  client_review: ['internal_review', 'ready_to_file', 'closed'],
  ready_to_file: ['client_review', 'filed', 'closed'],
  filed: ['receipt_received', 'rfe_notice', 'interview_scheduled', 'decision', 'closed'],
  receipt_received: ['rfe_notice', 'interview_scheduled', 'decision', 'closed'],
  rfe_notice: ['form_preparation', 'internal_review', 'filed', 'decision', 'closed'],
  interview_scheduled: ['rfe_notice', 'decision', 'closed'],
  decision: ['closed', 'rfe_notice'],
  closed: [],
});

export function canTransitionWorkflow(from, to) {
  if (from === to) return true;
  return Boolean(workflowTransitions[from]?.includes(to));
}

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

const serviceParticipants = Object.freeze({
  'I-130': ['beneficiary'],
  'I-864': ['sponsor'],
  'I-864A': ['sponsor', 'household_member'],
  'K-1': ['beneficiary'],
  'NVC': ['petitioner'],
  'CONSULAR': ['petitioner'],
});

const serviceForms = Object.freeze({
  'I-130': [['USCIS', 'I-130']],
  'I-485': [['USCIS', 'I-485']],
  'I-864': [['USCIS', 'I-864']],
  'I-864A': [['USCIS', 'I-864A']],
  'I-765': [['USCIS', 'I-765']],
  'I-131': [['USCIS', 'I-131']],
  'I-751': [['USCIS', 'I-751']],
  'N-400': [['USCIS', 'N-400']],
  'I-90': [['USCIS', 'I-90']],
  'DS-260': [['DOS', 'DS-260']],
  'K-1': [['USCIS', 'I-129F']],
  'ASYLUM': [['USCIS', 'I-589']],
  'BIA-APPEAL': [['EOIR', 'EOIR-26']],
  'I-601': [['USCIS', 'I-601']],
  'I-601A': [['USCIS', 'I-601A']],
  'VAWA': [['USCIS', 'I-360']],
  'U-VISA': [['USCIS', 'I-918']],
  'T-VISA': [['USCIS', 'I-914']],
  'SIJS': [['USCIS', 'I-360']],
  'TPS': [['USCIS', 'I-821']],
});

const serviceEvidence = Object.freeze({
  'I-130': [['RELATIONSHIP_EVIDENCE', 'relationship_evidence', 'Relationship evidence']],
  'I-485': [['ENTRY_RECORD', 'civil_document', 'Admission or parole record'], ['BIRTH_CERTIFICATE', 'civil_document', 'Birth certificate']],
  'I-864': [['TAX_TRANSCRIPT', 'financial_evidence', 'Most recent tax transcript'], ['CURRENT_INCOME', 'financial_evidence', 'Current income evidence']],
  'I-864A': [['HOUSEHOLD_INCOME', 'financial_evidence', 'Household member income evidence']],
  'I-765': [['ELIGIBILITY_EVIDENCE', 'civil_document', 'Employment authorization eligibility evidence']],
  'I-131': [['TRAVEL_EVIDENCE', 'civil_document', 'Travel document eligibility evidence']],
  'I-751': [['SHARED_LIFE_EVIDENCE', 'relationship_evidence', 'Shared life evidence']],
  'N-400': [['PERMANENT_RESIDENT_CARD', 'identity', 'Permanent resident card'], ['TRAVEL_HISTORY', 'civil_document', 'Travel history evidence']],
  'I-90': [['PERMANENT_RESIDENT_CARD', 'identity', 'Permanent resident card or replacement evidence']],
  'DS-260': [['CIVIL_DOCUMENTS', 'civil_document', 'Civil documents']],
  'NVC': [['NVC_CORRESPONDENCE', 'agency_notice', 'NVC correspondence'], ['CIVIL_DOCUMENTS', 'civil_document', 'Civil documents']],
  'CONSULAR': [['PETITION_APPROVAL', 'agency_notice', 'Petition approval notice'], ['CIVIL_DOCUMENTS', 'civil_document', 'Civil documents']],
  'K-1': [['RELATIONSHIP_EVIDENCE', 'relationship_evidence', 'Relationship and meeting evidence']],
  'ASYLUM': [['CLAIM_EVIDENCE', 'civil_document', 'Claim supporting evidence']],
  'EOIR': [['COURT_NOTICE', 'agency_notice', 'Court notice']],
  'REMOVAL': [['NOTICE_TO_APPEAR', 'agency_notice', 'Notice to Appear']],
  'DETENTION': [['DETENTION_RECORD', 'agency_notice', 'Detention record']],
  'BIA-APPEAL': [['WRITTEN_DECISION', 'agency_notice', 'Written decision']],
  'MTR': [['FINAL_ORDER', 'agency_notice', 'Final order and motion evidence']],
  'MTC': [['DECISION', 'agency_notice', 'Decision being challenged']],
  'I-601': [['INADMISSIBILITY_NOTICE', 'agency_notice', 'Government inadmissibility notice'], ['HARDSHIP_EVIDENCE', 'civil_document', 'Hardship evidence']],
  'I-601A': [['PETITION_APPROVAL', 'agency_notice', 'Approved petition notice'], ['HARDSHIP_EVIDENCE', 'civil_document', 'Hardship evidence']],
  'VAWA': [['QUALIFYING_RELATIONSHIP', 'relationship_evidence', 'Qualifying relationship evidence'], ['SUPPORTING_EVIDENCE', 'civil_document', 'Supporting evidence']],
  'U-VISA': [['LAW_ENFORCEMENT_CERTIFICATION', 'civil_document', 'Law enforcement certification']],
  'T-VISA': [['TRAFFICKING_EVIDENCE', 'civil_document', 'Trafficking supporting evidence']],
  'SIJS': [['STATE_COURT_ORDER', 'civil_document', 'Qualifying state court order']],
  'TPS': [['RESIDENCE_EVIDENCE', 'civil_document', 'Residence and physical presence evidence']],
  'PASSPORT': [['CURRENT_PASSPORT', 'identity', 'Current or expired passport']],
  'TRANSLATION': [['SOURCE_DOCUMENTS', 'translation', 'Documents to translate']],
  'NOTARY': [['DOCUMENTS_TO_NOTARIZE', 'other', 'Documents to notarize'], ['SIGNER_IDENTIFICATION', 'identity', 'Signer identification']],
  'POA': [['IDENTITY_AND_INSTRUCTIONS', 'identity', 'Principal identification and authority instructions']],
  'FLIGHT': [['TRAVEL_DOCUMENTS', 'identity', 'Passenger travel documents']],
});

/**
 * Versioned operational configuration for each supported service. It selects
 * work queues and official form candidates; it does not make an eligibility
 * or legal conclusion.
 */
export function serviceWorkflowFor(serviceCode) {
  const service = serviceCatalog.find(item => item.code === serviceCode);
  if (!service) return null;
  const participantRoles = serviceParticipants[service.code] || [];
  const documents = [
    { code: 'CLIENT_IDENTITY', category: 'identity', title: 'Client identity document', participant_role: null, required: true },
    ...(serviceEvidence[service.code] || []).map(([code, category, title]) => ({ code, category, title, participant_role: null, required: true })),
    ...participantRoles.map(role => ({ code: `${role.toUpperCase()}_IDENTITY`, category: 'identity', title: `${role.replaceAll('_', ' ')} identity document`, participant_role: role, required: true })),
  ];
  return Object.freeze({
    version: 1,
    service_code: service.code,
    participant_roles: Object.freeze([...participantRoles]),
    documents: Object.freeze(documents.map(item => Object.freeze(item))),
    forms: Object.freeze((serviceForms[service.code] || []).map(([authority, form_code]) => Object.freeze({ authority, form_code, participant_role: null, required: true }))),
    review_gates: Object.freeze(['participants_complete', 'documents_verified', 'forms_valid', 'evidence_complete', 'deadlines_resolved']),
  });
}

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
  const text = String(value);
  // Date.parse accepts rollover dates: "2026-02-31" parses fine and silently
  // means 2026-03-03. Round-tripping the parsed value back to YYYY-MM-DD
  // rejects any day that is not the day that was written -- which for a filing
  // deadline is the difference between a date and a missed date.
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw Object.assign(new Error('INVALID_DATE'), { status: 400 });
  }
  return text;
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
    legal_name_ar: cleanText(body.legal_name_ar, { max: 180 }),
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
    preferred_language: /^(arabic|ar|العربية)$/i.test(String(body.preferred_language || '')) ? 'Arabic' : 'English',
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
