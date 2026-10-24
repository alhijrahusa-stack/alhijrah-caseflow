/**
 * EVENT -> ENTITY -> CLIENT_ID -> AFFECTED RESOURCE.
 *
 * The single source of truth for which UI resources a database change or a
 * staff mutation invalidates. Pure and isomorphic: the realtime listener, the
 * mutation hook and the regression tests all read the same graph, so a surface
 * can never disagree with the listener about what a change touches.
 *
 * Nothing here refreshes a route. A route refresh is a recovery fallback and
 * lives in the client bus, which uses `describeChange` returning null as its
 * signal that granularity was unavailable.
 */

/** Tables the staff realtime channels subscribe to. */
export const REALTIME_ENTITIES = [
  "clients",
  "client_preferences",
  "client_accounts",
  "appointments",
  "tasks",
  "followups",
  "notes",
  "documents",
  "audit_alerts",
  "client_import_cases",
] as const;
export type RealtimeEntity = (typeof REALTIME_ENTITIES)[number];

/**
 * UI-facing resources. A resource is a slice a surface renders, not a table:
 * `next_action` and `readiness` are derived, and several tables feed them.
 */
export const RESOURCES = [
  "client_identity",
  "preferences",
  "account",
  "appointments",
  "tasks",
  "followups",
  "notes",
  "documents",
  "alerts",
  "import_cases",
  "assessments",
  "readiness",
  "next_action",
  "activity",
  "attention",
  "finance",
  "placement",
  "pipeline",
] as const;
export type Resource = (typeof RESOURCES)[number];

/**
 * The dependency graph. Every entity names the resources a row change in it
 * invalidates, including the derived ones, so ONE CLIENT -> ONE ACCOUNT ->
 * ONE WORKFLOW -> ONE NEXT ACTION stays coherent: anything that can move the
 * next action lists `next_action`.
 */
export const ENTITY_RESOURCES: Record<RealtimeEntity, readonly Resource[]> = {
  clients: ["client_identity", "next_action", "activity", "pipeline", "placement", "attention"],
  client_preferences: ["preferences", "next_action", "activity"],
  client_accounts: ["account", "finance", "next_action", "activity"],
  appointments: ["appointments", "next_action", "activity", "attention"],
  tasks: ["tasks", "next_action", "activity", "attention"],
  followups: ["followups", "next_action", "activity", "attention"],
  notes: ["notes", "activity"],
  documents: ["documents", "readiness", "next_action", "activity"],
  audit_alerts: ["alerts", "attention"],
  client_import_cases: ["import_cases", "activity"],
};

function isEntity(table: string): table is RealtimeEntity {
  return (REALTIME_ENTITIES as readonly string[]).includes(table);
}

/** Resources a row change in `table` invalidates; empty for an unknown table. */
export function resourcesForEntity(table: string): readonly Resource[] {
  return isEntity(table) ? ENTITY_RESOURCES[table] : [];
}

/**
 * Staff mutations, grouped by the resource set each one invalidates. The keys
 * are the `action` values POSTed to /api/staff/action plus the non-action
 * mutations (document upload, financial writes, operations) that reach the
 * same resources.
 */
export const MUTATION_RESOURCES: Record<string, readonly Resource[]> = {
  // Client record and workflow position
  create_client: ["client_identity", "pipeline", "attention", "next_action", "activity"],
  update_client: ["client_identity", "next_action", "activity"],
  patch_client: ["client_identity", "next_action", "activity"],
  update_status: ["client_identity", "pipeline", "placement", "next_action", "attention", "activity"],
  override_status: ["client_identity", "pipeline", "placement", "next_action", "attention", "activity"],
  set_next_step: ["client_identity", "next_action", "activity"],
  assign_staff: ["client_identity", "pipeline", "activity"],
  soft_delete_client: ["client_identity", "pipeline", "attention", "activity"],
  archive: ["client_identity", "pipeline", "attention", "next_action", "activity"],
  restore: ["client_identity", "pipeline", "attention", "next_action", "activity"],
  move_stage: ["client_identity", "pipeline", "placement", "next_action", "activity"],
  reassign_client: ["client_identity", "pipeline", "tasks", "attention", "activity"],
  bulk_assign: ["client_identity", "pipeline", "attention", "activity"],

  // Preferences
  add_preference: ["preferences", "next_action", "activity"],
  remove_preference: ["preferences", "next_action", "activity"],

  // Appointments
  schedule_appointment: ["appointments", "next_action", "attention", "activity"],
  book_slot: ["appointments", "next_action", "attention", "activity"],
  update_appointment: ["appointments", "next_action", "attention", "activity"],
  appointment_decision: ["appointments", "pipeline", "client_identity", "next_action", "finance", "attention", "activity"],

  // Notes
  add_note: ["notes", "activity"],

  // Tasks -- TASK COMPLETE -> task, next action, dashboard attention, activity
  add_task: ["tasks", "next_action", "attention", "activity"],
  update_task: ["tasks", "next_action", "attention", "activity"],
  complete_task: ["tasks", "next_action", "attention", "activity"],

  // Contact and follow-ups
  mark_contacted: ["client_identity", "followups", "next_action", "attention", "activity"],
  add_followup: ["followups", "next_action", "attention", "activity"],
  complete_followup: ["followups", "next_action", "attention", "activity"],

  // DOCUMENT REVIEW -> document, readiness, next action, activity
  upload_document: ["documents", "readiness", "next_action", "activity"],
  verify_document: ["documents", "readiness", "next_action", "activity"],
  reject_document: ["documents", "readiness", "next_action", "activity"],
  request_reupload: ["documents", "readiness", "next_action", "activity"],
  process_document: ["documents", "readiness", "next_action", "activity"],

  // Requirements, assessments and post-hire all feed readiness and the next action
  create_requirement: ["readiness", "next_action", "activity"],
  update_requirement: ["readiness", "next_action", "activity"],
  update_assessment: ["assessments", "readiness", "next_action", "activity"],
  add_standard_assessments: ["assessments", "readiness", "next_action", "activity"],
  // A post-hire item is also a requirement: migration 019 syncs the two.
  update_post_hire: ["placement", "readiness", "next_action", "activity"],

  // PAYMENT -> ledger, account, finance KPI, activity
  record_transaction: ["account", "finance", "next_action", "activity"],
  apply_discount: ["account", "finance", "next_action", "activity"],
  update_commission: ["account", "finance", "activity"],
  record_application_completion: ["account", "finance", "placement", "next_action", "activity"],

  // PLACEMENT CONFIRMATION -> lifecycle, Active Candidates removal,
  // Completed & Working insertion, activity, commission eligibility
  confirm_started: ["placement", "pipeline", "client_identity", "account", "finance", "next_action", "activity"],

  // Alerts
  resolve_alert: ["alerts", "attention", "activity"],
  ignore_alert: ["alerts", "attention", "activity"],
  run_audit_scan: ["alerts", "attention"],

  // Intake and import
  run_intake_agent: ["client_identity", "readiness", "next_action", "activity"],
  import_case: ["import_cases", "client_identity", "readiness", "next_action", "activity"],
  intake_submit: ["import_cases", "client_identity", "readiness", "next_action", "activity"],
  send_notification: ["activity"],
};

/** Resources a named mutation invalidates; empty when the name is unmapped. */
export function resourcesForMutation(action: string): readonly Resource[] {
  return MUTATION_RESOURCES[action] ?? [];
}

/** A postgres_changes payload, narrowed to the parts the graph reads. */
export type ChangePayload = {
  table?: string;
  eventType?: string;
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

/**
 * CLIENT_ID for a row change. `clients` rows carry it as `id`; every other
 * entity carries `client_id`. A delete only populates `old`, so both sides are
 * read. Returns null when the row cannot be attributed to a client -- the
 * caller must then treat the change as unscoped.
 */
export function clientIdFromPayload(payload: ChangePayload): string | null {
  const rows = [payload.new, payload.old];
  const key = payload.table === "clients" ? "id" : "client_id";
  for (const row of rows) {
    if (!row) continue;
    const direct = uuid(row[key]);
    if (direct) return direct;
  }
  // A table that is normally client-scoped may still expose the client through
  // `client_id` on one side only (e.g. a reparented import case).
  for (const row of rows) {
    if (!row) continue;
    const fallback = uuid(row.client_id);
    if (fallback) return fallback;
  }
  return null;
}

export type ResourceChange = {
  entity: RealtimeEntity;
  event: "INSERT" | "UPDATE" | "DELETE";
  clientId: string | null;
  resources: readonly Resource[];
};

/**
 * EVENT -> ENTITY -> CLIENT_ID -> AFFECTED RESOURCE for one realtime payload.
 *
 * Returns null when the payload cannot be resolved to a known entity. Null is
 * the only condition under which a caller may fall back to a route refresh:
 * granularity was genuinely unavailable, so the targeted path cannot be taken.
 */
export function describeChange(payload: ChangePayload): ResourceChange | null {
  const table = payload.table;
  if (!table || !isEntity(table)) return null;
  const resources = ENTITY_RESOURCES[table];
  if (resources.length === 0) return null;
  const raw = (payload.eventType ?? "").toUpperCase();
  const event = raw === "INSERT" || raw === "UPDATE" || raw === "DELETE" ? raw : "UPDATE";
  return { entity: table, event, clientId: clientIdFromPayload(payload), resources };
}

/** True when any resource in `changed` is one the surface renders. */
export function affects(rendered: readonly Resource[], changed: readonly Resource[]): boolean {
  return changed.some((r) => rendered.includes(r));
}

/**
 * AFFECTED RESOURCE -> the data a surface must refetch to show it.
 *
 * Keys are client-file slice names plus the three derived payloads
 * (`requirements`, `nextAction`, `account`). The client computes the request
 * from the resources it renders; the server reads exactly those and nothing
 * else, so a change to one entity costs one scoped query set.
 */
export const RESOURCE_PAYLOADS: Record<Resource, readonly string[]> = {
  client_identity: ["client", "employment", "authorization"],
  preferences: ["preferences"],
  account: ["account"],
  appointments: ["appointments"],
  tasks: ["tasks"],
  followups: ["followups", "contacts"],
  notes: ["notes"],
  documents: ["documents", "extractions"],
  alerts: ["alerts"],
  import_cases: ["client", "documents"],
  assessments: ["assessments"],
  readiness: ["requirements", "postHire"],
  next_action: ["nextAction"],
  // The client file's insight timeline: the log, the last agent run and the
  // notification record all move together.
  activity: ["activity", "agentRun", "notifications"],
  attention: [],
  finance: ["account"],
  placement: ["client"],
  pipeline: ["client"],
};

/** Derived payload keys the client file does not read as a plain slice. */
export const DERIVED_PAYLOADS = ["requirements", "nextAction", "account"] as const;
export type DerivedPayload = (typeof DERIVED_PAYLOADS)[number];

export function isDerivedPayload(key: string): key is DerivedPayload {
  return (DERIVED_PAYLOADS as readonly string[]).includes(key);
}

/** Deduplicated payload keys for a resource set, order preserved. */
export function payloadsForResources(resources: readonly Resource[]): string[] {
  const out: string[] = [];
  for (const r of resources) for (const key of RESOURCE_PAYLOADS[r] ?? []) if (!out.includes(key)) out.push(key);
  return out;
}
