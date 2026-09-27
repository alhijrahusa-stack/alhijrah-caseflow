import "server-only";
import { sql } from "@/lib/db";
import type { Role } from "@/lib/domain";
import type { StaffSession } from "@/lib/auth";

const ALL: Role[] = ["admin", "manager", "staff"];
const MGMT: Role[] = ["admin", "manager"];
const ADMIN: Role[] = ["admin"];

/** Which roles may run each staff action. Client scope is checked separately. */
export const ACTION_ROLES = {
  create_client: MGMT,
  update_client: ALL,
  patch_client: ALL,
  update_status: MGMT,
  override_status: ADMIN,
  set_next_step: ALL,
  add_preference: MGMT,
  remove_preference: MGMT,
  schedule_appointment: MGMT,
  book_slot: MGMT,
  update_appointment: MGMT,
  add_note: ALL,
  add_task: ALL,
  update_task: ALL,
  complete_task: ALL,
  assign_staff: MGMT,
  mark_contacted: ALL,
  add_followup: ALL,
  complete_followup: ALL,
  verify_document: MGMT,
  reject_document: MGMT,
  request_reupload: MGMT,
  process_document: MGMT,
  update_assessment: MGMT,
  add_standard_assessments: MGMT,
  update_post_hire: MGMT,
  run_intake_agent: ALL,
  send_notification: MGMT,
  soft_delete_client: ADMIN,
  create_staff: ADMIN,
  update_staff_role: ADMIN,
  disable_staff: ADMIN,
  reactivate_staff: ADMIN,
  invite_staff: ADMIN,
  upsert_availability: MGMT,
  delete_availability: MGMT,
  add_blocked_period: MGMT,
  remove_blocked_period: MGMT,
  resolve_alert: MGMT,
  ignore_alert: MGMT,
  run_audit_scan: MGMT,
  upload_document: ALL,
  view_document: ALL,
} as const satisfies Record<string, Role[]>;

export type ActionName = keyof typeof ACTION_ROLES;

export function roleAllows(role: Role, action: ActionName) {
  return (ACTION_ROLES[action] as readonly Role[]).includes(role);
}

export type ClientScope = { ok: true; clientId: string } | { ok: false; status: 403 | 404; reason: string };

/** Admin: any client. Manager: any live client. Staff: live clients assigned to them. */
export async function clientScope(session: StaffSession, clientId: string): Promise<ClientScope> {
  const [c] = await sql()`select id, assigned_staff, deleted_at from clients where id = ${clientId}`;
  if (!c) return { ok: false, status: 404, reason: "Client not found" };
  if (c.deleted_at && session.staff.role !== "admin") return { ok: false, status: 404, reason: "Client not found" };
  if (session.staff.role === "staff" && c.assigned_staff !== session.staff.id) {
    return { ok: false, status: 403, reason: "This client is not assigned to you" };
  }
  return { ok: true, clientId };
}

/** Resolves the client that owns a child record, for scope checks. */
export async function clientOf(table: "tasks" | "appointments" | "documents" | "followups" | "client_preferences" | "assessments" | "audit_alerts", id: string) {
  const db = sql();
  const [row] = await db`select client_id from ${db(table)} where id = ${id}`;
  return row ? { found: true as const, clientId: (row.client_id as string | null) ?? null } : { found: false as const, clientId: null };
}
