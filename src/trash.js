// Secure delete: what may be deleted, restored, or destroyed, and why not.
//
// Every rule here applies to the Owner exactly as it applies to anyone else.
// Owning the firm is authority over who may act; it is not authority to strand
// an R2 object, break a foreign key, void a legal hold, or shorten a retention
// period. The three destructive permissions live in access.js and are checked
// before any of this runs -- this module is the integrity layer underneath.

export const trashResourceTypes = Object.freeze(['client', 'case', 'document']);
export const trashFacets = Object.freeze(['record', 'image', 'version']);

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff']);

export function documentFacet(document) {
  if (document?.replaces_document_id) return 'version';
  if (imageTypes.has(String(document?.content_type || '').toLowerCase())) return 'image';
  return 'record';
}

// Every foreign key that points at the table, taken from the live schema rather
// than from memory. A client cascades into documents, alerts, tasks and more,
// so a raw DELETE would destroy document rows and strand their R2 objects --
// which is exactly why permanent delete never issues one.
const dependentTables = Object.freeze({
  client: Object.freeze([
    ['cases', 'client_id', 'CLIENT_HAS_CASES'],
    ['documents', 'client_id', 'CLIENT_HAS_DOCUMENTS'],
    ['invoices', 'client_id', 'CLIENT_HAS_INVOICES'],
    ['tasks', 'client_id', 'CLIENT_HAS_TASKS'],
    ['appointments', 'client_id', 'CLIENT_HAS_APPOINTMENTS'],
    ['document_requests', 'client_id', 'CLIENT_HAS_DOCUMENT_REQUESTS'],
    ['client_people', 'client_id', 'CLIENT_HAS_PARTICIPANTS'],
    ['client_access', 'client_id', 'CLIENT_HAS_PORTAL_ACCESS'],
    ['family_relationships', 'client_id', 'CLIENT_HAS_FAMILY_RECORDS'],
    ['outbound_communications', 'client_id', 'CLIENT_HAS_COMMUNICATIONS'],
    ['alerts', 'client_id', 'CLIENT_HAS_ALERTS'],
    ['import_rows', 'result_client_id', 'CLIENT_HAS_IMPORT_PROVENANCE'],
    ['import_rows', 'merge_client_id', 'CLIENT_HAS_IMPORT_PROVENANCE'],
  ]),
  // case_events is deliberately absent. It is append-only and every case has
  // one, so blocking on it would make no case ever purgeable -- and it is the
  // record the tombstone exists to preserve, not a dependent to protect.
  case: Object.freeze([
    ['documents', 'case_id', 'CASE_HAS_DOCUMENTS'],
    ['invoices', 'case_id', 'CASE_HAS_INVOICES'],
    ['form_instances', 'case_id', 'CASE_HAS_FORMS'],
    ['form_findings', 'case_id', 'CASE_HAS_FORM_FINDINGS'],
    ['generated_artifacts', 'case_id', 'CASE_HAS_GENERATED_ARTIFACTS'],
    ['ai_review_runs', 'case_id', 'CASE_HAS_AI_REVIEWS'],
    ['ai_findings', 'case_id', 'CASE_HAS_AI_FINDINGS'],
    ['background_jobs', 'case_id', 'CASE_HAS_BACKGROUND_JOBS'],
    ['outbound_communications', 'case_id', 'CASE_HAS_COMMUNICATIONS'],
    ['person_history_records', 'case_id', 'CASE_HAS_HISTORY_RECORDS'],
    ['participant_match_reviews', 'case_id', 'CASE_HAS_MATCH_REVIEWS'],
    ['intake_submissions', 'case_id', 'CASE_HAS_INTAKE'],
    ['case_people', 'case_id', 'CASE_HAS_PARTICIPANTS'],
    ['case_messages', 'case_id', 'CASE_HAS_MESSAGES'],
    ['case_notes', 'case_id', 'CASE_HAS_NOTES'],
    ['tasks', 'case_id', 'CASE_HAS_TASKS'],
    ['deadlines', 'case_id', 'CASE_HAS_DEADLINES'],
    ['appointments', 'case_id', 'CASE_HAS_APPOINTMENTS'],
    ['document_requests', 'case_id', 'CASE_HAS_DOCUMENT_REQUESTS'],
    ['case_assignments', 'case_id', 'CASE_HAS_ASSIGNMENTS'],
    ['form_role_assignments', 'case_id', 'CASE_HAS_FORM_ROLES'],
    ['import_rows', 'result_case_id', 'CASE_HAS_IMPORT_PROVENANCE'],
  ]),
  // These three keys are ON DELETE SET NULL. Nulling them would not orphan a
  // row, it would silently erase the citation that says where an answer or a
  // history entry came from, so they block instead.
  document: Object.freeze([
    ['documents', 'replaces_document_id', 'DOCUMENT_HAS_SUCCESSOR_VERSION'],
    ['form_answers', 'source_document_id', 'DOCUMENT_CITED_BY_FORM_ANSWER'],
    ['person_history_records', 'source_document_id', 'DOCUMENT_CITED_BY_HISTORY'],
  ]),
});

function missingRelation(error) {
  const code = error?.internalDetails?.code;
  return error?.status === 404 || code === '42P01' || /does not exist/i.test(String(error?.message || ''));
}

// A table the deployment does not have holds no rows, so it blocks nothing.
// Any other failure is a real error and must not be read as "no dependents".
async function countReferences(db, table, column, value) {
  try {
    // Soft-deleted dependents still hold the foreign key, so they still block a
    // permanent delete. Trash has to be emptied for the children first.
    const rows = await db(table, { query: `?${column}=eq.${encodeURIComponent(value)}&select=${column}&limit=200`, includeDeleted: true });
    return Array.isArray(rows) ? rows.length : 0;
  } catch (error) {
    if (missingRelation(error)) return 0;
    throw error;
  }
}

/**
 * Everything that would be orphaned or corrupted by destroying this record.
 * A non-empty result is a hard block, and it names the table and the count so
 * the reason returned to the user is verified rather than generic.
 */
export async function purgeBlockers(db, resourceType, resourceId) {
  const checks = dependentTables[resourceType] || [];
  const found = new Map();
  for (const [table, column, code] of checks) {
    const count = await countReferences(db, table, column, resourceId);
    if (!count) continue;
    const existing = found.get(code);
    if (existing) existing.count += count;
    else found.set(code, { code, table, column, count });
  }
  return [...found.values()];
}

/** An active legal hold on the record, on its case, or on its client. */
export async function activeLegalHold(db, { clientId, caseId }) {
  const targets = [];
  if (caseId) targets.push(`case_id.eq.${encodeURIComponent(caseId)}`);
  if (clientId) targets.push(`client_id.eq.${encodeURIComponent(clientId)}`);
  if (!targets.length) return null;
  try {
    const rows = await db('legal_holds', { query: `?active=eq.true&or=(${targets.join(',')})&select=id,reason,case_id,client_id&limit=1` });
    return rows?.[0] || null;
  } catch (error) {
    if (missingRelation(error)) return null;
    throw error;
  }
}

/**
 * Retention gates destruction, not removal from the active views. A record the
 * firm has committed to keeping for N days cannot be destroyed before then --
 * including by the Owner, who set the policy in the first place.
 */
export async function retentionBlock(db, recordType, createdAt, now = new Date()) {
  let policy;
  try {
    const rows = await db('retention_policies', { query: `?record_type=eq.${encodeURIComponent(recordType)}&select=*&limit=1` });
    policy = rows?.[0];
  } catch (error) {
    if (missingRelation(error)) return null;
    throw error;
  }
  if (!policy) return null;
  const days = Number(policy.retention_days);
  if (!Number.isFinite(days) || days <= 0) return null;
  const created = new Date(createdAt || 0);
  if (Number.isNaN(created.getTime())) return null;
  const releasesAt = new Date(created.getTime() + days * 86_400_000);
  if (releasesAt <= now) return null;
  return { record_type: recordType, retention_days: days, action: policy.action, releases_at: releasesAt.toISOString() };
}

/**
 * R2 ownership. The key is never taken from the request -- it is read off the
 * canonical row and then checked against the namespace that case's uploads are
 * written into, so a row whose key points somewhere else is refused rather than
 * followed.
 */
export function resolveDocumentObject(document) {
  const key = String(document?.object_key || '');
  if (!key) return { key: null, reason: 'DOCUMENT_HAS_NO_OBJECT' };
  const caseId = String(document?.case_id || '');
  if (!caseId) return { key: null, reason: 'DOCUMENT_NOT_LINKED_TO_CASE' };
  const expectedPrefix = `cases/${caseId}/`;
  if (!key.startsWith(expectedPrefix)) return { key: null, reason: 'DOCUMENT_OBJECT_OUTSIDE_CASE_NAMESPACE' };
  if (key.includes('..')) return { key: null, reason: 'INVALID_OBJECT_KEY' };
  return { key, reason: null };
}
