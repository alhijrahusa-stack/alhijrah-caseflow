const field = (id, label, type = 'text', options = {}) => Object.freeze({ id, label, type, ...options });

const identity = Object.freeze({
  id: 'identity',
  title: 'Identity and contact',
  fields: [
    field('capacity', 'Are you the applicant, petitioner, beneficiary, or authorized contact?', 'select', { required: true, options: ['applicant', 'petitioner', 'beneficiary', 'authorized_contact'] }),
    field('legal_name', 'Legal name', 'text', { required: true }),
    field('date_of_birth', 'Date of birth', 'date', { required: true }),
    field('place_of_birth', 'Place of birth'),
    field('nationality', 'Nationality'),
    field('current_country', 'Current country of residence', 'country'),
    field('email', 'Email', 'email', { required: true }),
    field('phone', 'Phone or WhatsApp', 'phone', { required: true }),
    field('us_status', 'Current status in the United States', 'select', { options: ['outside_us', 'us_citizen', 'permanent_resident', 'nonimmigrant', 'parole', 'asylum_or_refugee', 'no_current_status', 'unknown'] }),
    field('a_number', 'A-Number, if any'),
  ],
});

const serviceFields = {
  'I-130': [
    field('petitioner_status', 'Petitioner status', 'select', { required: true, options: ['us_citizen', 'permanent_resident'] }),
    field('relationship', 'Relationship to beneficiary', 'select', { required: true, options: ['spouse', 'child', 'parent', 'sibling'] }),
    field('beneficiary_location', 'Is the beneficiary inside or outside the United States?', 'select', { required: true, options: ['inside_us', 'outside_us'] }),
    field('prior_petitions', 'Has any petition previously been filed for the beneficiary?', 'yes_no'),
  ],
  'I-485': [
    field('entry_method', 'Most recent manner of entry', 'select', { required: true, options: ['inspected_admitted', 'paroled', 'without_inspection', 'unknown'] }),
    field('i94_number', 'I-94 number, if any'),
    field('underlying_basis', 'Basis for adjustment', 'select', { required: true, options: ['family', 'employment', 'humanitarian', 'other'] }),
    field('court_proceedings', 'Are removal proceedings pending or prior?', 'yes_no', { riskFlag: true }),
  ],
  'I-864': [
    field('sponsor_household_size', 'Sponsor household size', 'number', { required: true }),
    field('sponsor_income', 'Current annual household income', 'currency', { required: true }),
    field('tax_years_available', 'Federal tax years available', 'multi_select', { options: ['latest', 'previous_1', 'previous_2'] }),
    field('joint_sponsor_needed', 'Will a joint sponsor be used?', 'yes_no'),
  ],
  'I-864A': [
    field('household_member_relationship', 'Relationship to sponsor', 'select', { required: true, options: ['spouse', 'child', 'parent', 'sibling', 'other_dependent'] }),
    field('same_residence', 'Does the household member share the sponsor residence?', 'yes_no', { required: true }),
    field('member_income', 'Household member annual income', 'currency', { required: true }),
  ],
  'I-765': [
    field('eligibility_category', 'Requested eligibility category', 'text', { required: true }),
    field('prior_ead', 'Was an EAD previously issued?', 'yes_no'),
    field('current_ead_expiration', 'Current EAD expiration date', 'date'),
  ],
  'I-131': [
    field('document_type', 'Travel document requested', 'select', { required: true, options: ['advance_parole', 'reentry_permit', 'refugee_travel_document'] }),
    field('planned_departure', 'Planned departure date', 'date'),
    field('travel_purpose', 'Purpose of travel', 'textarea', { required: true }),
  ],
  'I-751': [
    field('filing_basis', 'Filing basis', 'select', { required: true, options: ['joint', 'divorce_waiver', 'abuse_waiver', 'extreme_hardship'] }),
    field('card_expiration', 'Conditional resident card expiration', 'date', { required: true }),
    field('living_together', 'Are the spouses currently living together?', 'yes_no'),
  ],
  'N-400': [
    field('resident_since', 'Permanent resident since', 'date', { required: true }),
    field('travel_over_six_months', 'Any trip outside the United States lasting six months or more?', 'yes_no'),
    field('arrests_or_citations', 'Any arrest, citation, charge, or conviction?', 'yes_no', { riskFlag: true }),
    field('tax_compliance', 'Are all required tax returns filed?', 'yes_no'),
  ],
  'I-90': [
    field('replacement_reason', 'Reason for application', 'select', { required: true, options: ['expired_or_expiring', 'lost_stolen_destroyed', 'incorrect_data', 'name_change', 'never_received', 'other'] }),
    field('card_expiration', 'Card expiration date', 'date'),
  ],
  'DS-260': [
    field('nvc_case_number', 'NVC case number', 'text', { required: true }),
    field('invoice_id', 'Invoice ID number'),
    field('intended_us_address', 'Intended U.S. address', 'textarea'),
    field('prior_us_travel', 'Any prior U.S. travel?', 'yes_no'),
  ],
  'NVC': [
    field('nvc_case_number', 'NVC case number'),
    field('ceac_stage', 'Current CEAC stage', 'select', { options: ['fees', 'ds260', 'civil_documents', 'affidavit_of_support', 'documentarily_qualified', 'interview'] }),
    field('petitioner_domicile', 'Petitioner U.S. domicile evidence available?', 'yes_no'),
  ],
  'CONSULAR': [
    field('petition_receipt', 'Approved petition receipt number'),
    field('consulate', 'Assigned or expected U.S. embassy/consulate'),
    field('case_stage', 'Current consular case stage', 'text'),
  ],
  'K-1': [
    field('in_person_meeting', 'Have the parties met in person during the prior two years?', 'yes_no', { required: true }),
    field('meeting_date', 'Most recent in-person meeting date', 'date'),
    field('prior_marriages_ended', 'Have all prior marriages legally ended?', 'yes_no', { required: true }),
  ],
  'ASYLUM': [
    field('last_arrival_date', 'Most recent U.S. arrival date', 'date'),
    field('one_year_issue', 'Was the request started more than one year after arrival?', 'yes_no', { riskFlag: true }),
    field('protected_ground', 'Claimed protected ground', 'multi_select', { options: ['race', 'religion', 'nationality', 'political_opinion', 'particular_social_group'] }),
    field('court_case', 'Is the matter currently in immigration court?', 'yes_no', { riskFlag: true }),
  ],
  'EOIR': [
    field('a_number', 'A-Number', 'text', { required: true }),
    field('next_hearing', 'Next hearing date', 'date'),
    field('court_location', 'Immigration court location'),
    field('represented', 'Is an attorney or accredited representative currently entered?', 'yes_no'),
  ],
  'REMOVAL': [
    field('notice_to_appear', 'Was a Notice to Appear received?', 'yes_no', { required: true }),
    field('next_hearing', 'Next hearing date', 'date'),
    field('prior_removal_order', 'Any prior removal order?', 'yes_no', { riskFlag: true }),
  ],
  'DETENTION': [
    field('facility', 'Detention facility', 'text', { required: true }),
    field('detainee_a_number', 'Detainee A-Number', 'text', { required: true }),
    field('bond_hearing', 'Bond hearing scheduled?', 'yes_no'),
  ],
  'BIA-APPEAL': [
    field('decision_date', 'Immigration Judge decision date', 'date', { required: true }),
    field('appeal_deadline', 'Appeal deadline shown on decision', 'date', { required: true }),
    field('written_decision', 'Written decision available?', 'yes_no'),
  ],
  'MTR': [
    field('final_order_date', 'Final order date', 'date', { required: true }),
    field('motion_basis', 'Basis to reopen', 'textarea', { required: true }),
    field('prior_motion', 'Was a prior motion to reopen filed?', 'yes_no'),
  ],
  'MTC': [
    field('decision_date', 'Decision date', 'date', { required: true }),
    field('claimed_error', 'Claimed error of law or fact', 'textarea', { required: true }),
  ],
  'I-601': [
    field('inadmissibility_ground', 'Ground identified by the government', 'textarea', { required: true }),
    field('qualifying_relative', 'Qualifying relative', 'select', { options: ['spouse', 'parent', 'child', 'other'] }),
    field('prior_denial', 'Was a visa or benefit previously denied?', 'yes_no', { riskFlag: true }),
  ],
  'I-601A': [
    field('approved_petition', 'Approved underlying petition?', 'yes_no', { required: true }),
    field('nvc_fee_paid', 'Immigrant visa fee paid to NVC?', 'yes_no'),
    field('removal_proceedings', 'Any pending or prior removal proceedings?', 'yes_no', { riskFlag: true }),
  ],
  'VAWA': [
    field('abuser_status', 'Abuser immigration status', 'select', { options: ['us_citizen', 'permanent_resident', 'unknown'] }),
    field('relationship_to_abuser', 'Relationship to abuser', 'select', { required: true, options: ['spouse', 'parent', 'adult_child'] }),
    field('safe_contact_method', 'Safe contact method', 'text', { required: true }),
  ],
  'U-VISA': [
    field('qualifying_crime', 'Reported qualifying criminal activity'),
    field('law_enforcement_agency', 'Certifying law enforcement agency'),
    field('certification_status', 'I-918 Supplement B status', 'select', { options: ['not_requested', 'requested', 'signed', 'declined'] }),
  ],
  'T-VISA': [
    field('trafficking_type', 'Type of trafficking', 'select', { options: ['labor', 'sex', 'both'] }),
    field('law_enforcement_contact', 'Law enforcement contact, if any'),
    field('physical_presence', 'Current physical presence connected to trafficking?', 'yes_no'),
  ],
  'SIJS': [
    field('child_age', 'Child age', 'number', { required: true }),
    field('state_court_order', 'Qualifying state court order obtained?', 'yes_no'),
    field('marital_status', 'Child marital status', 'select', { options: ['unmarried', 'married'] }),
  ],
  'TPS': [
    field('designated_country', 'TPS-designated country', 'text', { required: true }),
    field('continuous_residence_date', 'Continuous residence start date', 'date'),
    field('prior_tps', 'Prior TPS registration?', 'yes_no'),
  ],
  'PASSPORT': [
    field('passport_country', 'Passport country', 'country', { required: true }),
    field('passport_expiration', 'Passport expiration date', 'date'),
    field('renewal_location', 'Country where renewal will be requested', 'country'),
  ],
  'TRANSLATION': [
    field('source_language', 'Source language', 'text', { required: true }),
    field('target_language', 'Target language', 'text', { required: true }),
    field('document_count', 'Number of documents', 'number', { required: true }),
  ],
  'NOTARY': [
    field('document_type', 'Document type', 'text', { required: true }),
    field('signer_count', 'Number of signers', 'number', { required: true }),
    field('signers_have_id', 'Do all signers have current identification?', 'yes_no'),
  ],
  'POA': [
    field('principal_location', 'Principal location', 'country', { required: true }),
    field('agent_location', 'Agent location', 'country', { required: true }),
    field('authority_scope', 'Requested authority scope', 'textarea', { required: true }),
  ],
  'FLIGHT': [
    field('departure_city', 'Departure city', 'text', { required: true }),
    field('destination_city', 'Destination city', 'text', { required: true }),
    field('travel_date', 'Travel date', 'date', { required: true }),
    field('passenger_count', 'Number of passengers', 'number', { required: true }),
  ],
};

const familyServiceCodes = new Set(['I-130', 'I-485', 'I-864', 'I-864A', 'DS-260', 'NVC', 'CONSULAR', 'K-1']);

const familySection = Object.freeze({
  id: 'family_members',
  title: 'Family members in this matter',
  description: 'Add only the people connected to this request. You can add or remove a person before submission.',
  fields: [
    field('family_members', 'Family members', 'repeatable_people', {
      maxItems: 20,
      personFields: [
        { id: 'legal_name', label: 'Legal name', type: 'text', required: true },
        { id: 'relationship', label: 'Relationship', type: 'select', required: true, options: ['spouse', 'child', 'parent', 'sibling', 'other'] },
        { id: 'date_of_birth', label: 'Date of birth', type: 'date' },
        { id: 'place_of_birth', label: 'Place of birth', type: 'text' },
      ],
    }),
  ],
});

export function intakeDefinition(serviceCode) {
  const specific = serviceFields[serviceCode];
  if (!specific) return null;
  const sections = [
    identity,
    ...(familyServiceCodes.has(serviceCode) ? [familySection] : []),
    { id: 'service_details', title: serviceCode + ' service details', fields: specific },
    {
      id: 'referral',
      title: 'Referral',
      fields: [
        field('referred', 'Were you referred by a person or office?', 'yes_no'),
        field('referrer_name', 'Referrer name', 'text', { visibleWhen: { field: 'referred', equals: true } }),
      ],
    },
  ];
  return {
    service_code: serviceCode,
    version: 1,
    sections,
  };
}

export const intakeServiceCodes = Object.freeze(Object.keys(serviceFields));

export function validateIntakeAnswers(definition, answers, { final = false } = {}) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw Object.assign(new Error('INVALID_INTAKE_ANSWERS'), { status: 400 });
  }
  const allowed = new Map(definition.sections.flatMap(section => section.fields).map(item => [item.id, item]));
  for (const [key, value] of Object.entries(answers)) {
    if (!allowed.has(key)) throw Object.assign(new Error('UNKNOWN_INTAKE_FIELD'), { status: 400 });
    if (typeof value === 'string' && value.length > 10000) throw Object.assign(new Error('INTAKE_VALUE_TOO_LARGE'), { status: 400 });
    const definition = allowed.get(key);
    if (definition.type === 'repeatable_people') {
      if (!Array.isArray(value) || value.length > (definition.maxItems || 20)) throw Object.assign(new Error('INVALID_REPEATABLE_GROUP'), { status: 400 });
      for (const person of value) {
        if (!person || typeof person !== 'object' || Array.isArray(person)) throw Object.assign(new Error('INVALID_REPEATABLE_GROUP'), { status: 400 });
        const personFields = new Set(definition.personFields.map(item => item.id));
        if (Object.keys(person).some(personKey => !personFields.has(personKey))) throw Object.assign(new Error('UNKNOWN_REPEATABLE_FIELD'), { status: 400 });
        if (Object.values(person).some(personValue => typeof personValue === 'string' && personValue.length > 500)) throw Object.assign(new Error('INTAKE_VALUE_TOO_LARGE'), { status: 400 });
      }
    }
  }
  if (final) {
    const missing = [];
    for (const item of allowed.values()) {
      const visible = !item.visibleWhen || answers[item.visibleWhen.field] === item.visibleWhen.equals;
      if (visible && item.required && (answers[item.id] === undefined || answers[item.id] === null || answers[item.id] === '')) missing.push(item.id);
      if (visible && item.type === 'repeatable_people') {
        for (const [index, person] of (answers[item.id] || []).entries()) {
          for (const personField of item.personFields.filter(personItem => personItem.required)) {
            if (!person[personField.id]) missing.push(`${item.id}.${index}.${personField.id}`);
          }
        }
      }
    }
    if (missing.length) throw Object.assign(new Error('INTAKE_REQUIRED_FIELDS_MISSING'), { status: 400, details: { fields: missing } });
  }
  return answers;
}
