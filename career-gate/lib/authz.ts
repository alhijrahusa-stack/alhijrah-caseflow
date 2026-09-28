import "server-only";
import { sql } from "@/lib/db";
import type { Role } from "@/lib/domain";
import type { StaffSession } from "@/lib/auth";

const ALL: Role[] = ["super_admin", "admin", "manager", "staff"];
const SUPER: Role[] = ["super_admin"];

/** All active staff currently have operational access. Identity/security administration is super-admin only. */
export const ACTION_ROLES = {
  create_client: ALL,
  update_client: ALL,
  patch_client: ALL,
  update_status: ALL,
  override_status: SUPER,
  set_next_step: ALL,
  add_preference: ALL,
  remove_preference: ALL,
  schedule_appointment: ALL,
  book_slot: ALL,
  update_appointment: ALL,
  add_note: ALL,
  add_task: ALL,
  update_task: ALL,
  complete_task: ALL,
  assign_staff: ALL,
  mark_contacted: ALL,
  add_followup: ALL,
  complete_followup: ALL,
  verify_document: ALL,
  reject_document: ALL,
  request_reupload: ALL,
  process_document: ALL,
  update_assessment: ALL,
  add_standard_assessments: ALL,
  update_post_hire: ALL,
  run_intake_agent: ALL,
  send_notification: ALL,
  soft_delete_client: SUPER,
  create_staff: SUPER,
  update_staff_role: SUPER,
  update_staff_access_scope: SUPER,
  disable_staff: SUPER,
  reactivate_staff: SUPER,
  invite_staff: SUPER,
  upsert_availability: ALL,
  delete_availability: ALL,
  add_blocked_period: ALL,
  remove_blocked_period: ALL,
  resolve_alert: ALL,
  ignore_alert: ALL,
  run_audit_scan: ALL,
  upload_document: ALL,
  view_document: ALL,
} as const satisfies Record<string, Role[]>;

export type ActionName = keyof typeof ACTION_ROLES;

export function roleAllows(role: Role, action: ActionName) {
  return (ACTION_ROLES[action] as readonly Role[]).includes(role);
}

export type ClientScope = { ok: true; clientId: string } | { ok: false; status: 403 | 404; reason: string };

/** Access scope is data-driven. Super admin always has full access. */
export async function clientScope(session: StaffSession, clientId: string): Promise<ClientScope> {
  const [c] = await sql()`select id, assigned_staff, deleted_at from clients where id = ${clientId}`;
  if (!c) return { ok: false, status: 404, reason: "Client not found" };
  if (c.deleted_at && session.staff.role !== "super_admin") return { ok: false, status: 404, reason: "Client not found" };
  if (session.staff.role === "super_admin" || session.staff.access_scope === "full") return { ok: true, clientId };
  if (c.assigned_staff !== session.staff.id) return { ok: false, status: 403, reason: "This client is not assigned to you" };
  return { ok: true, clientId };
}

/** Resolves the client that owns a child record, for scope checks. */
export async function clientOf(table: "tasks" | "appointments" | "documents" | "followups" | "client_preferences" | "assessments" | "audit_alerts", id: string) {
  const db = sql();
  const [row] = await db`select client_id from ${db(table)} where id = ${id}`;
  return row ? { found: true as const, clientId: (row.client_id as string | null) ?? null } : { found: false as const, clientId: null };
}
