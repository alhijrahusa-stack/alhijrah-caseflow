import "server-only";
import { sql } from "@/lib/db";
import type { Role } from "@/lib/domain";
import type { StaffSession } from "@/lib/auth";
import type { ActionInput } from "@/lib/actions";

export type ActionName = ActionInput["action"] | "upload_document" | "view_document";
export type PermissionScope = "ALL" | "ASSIGNED" | "NONE";
export type Permission = { resource: string | null; scope: PermissionScope; allowed: boolean };

/**
 * Canonical authorization lookup. permission_rules is the source of truth;
 * missing rules fail closed as NONE. UI visibility may mirror this result but
 * never grants access.
 */
export async function permissionFor(role: Role, action: ActionName): Promise<Permission> {
  const [row] = await sql()`
    select resource,scope
      from permission_rules
     where role=${role} and action=${action}
     limit 1`;
  const scope = (row?.scope as PermissionScope | undefined) ?? "NONE";
  return { resource: (row?.resource as string | undefined) ?? null, scope, allowed: scope !== "NONE" };
}

export type ClientScope = { ok: true; clientId: string } | { ok: false; status: 403 | 404; reason: string };

/**
 * Resolves client visibility. When an action-specific permission scope is
 * supplied it controls access; ordinary page access preserves the established
 * role model (admin/manager ALL, staff ASSIGNED).
 */
export async function clientScope(
  session: StaffSession,
  clientId: string,
  permissionScope?: PermissionScope,
): Promise<ClientScope> {
  const [c] = await sql()`select id,assigned_staff,deleted_at from clients where id=${clientId}`;
  if (!c) return { ok: false, status: 404, reason: "Client not found" };
  if (c.deleted_at && session.staff.role !== "admin") return { ok: false, status: 404, reason: "Client not found" };

  const scope = permissionScope ?? (session.staff.role === "staff" ? "ASSIGNED" : "ALL");
  if (scope === "NONE") return { ok: false, status: 403, reason: "Your role does not allow this action" };
  if (scope === "ASSIGNED" && c.assigned_staff !== session.staff.id) {
    return { ok: false, status: 403, reason: "This client is not assigned to you" };
  }
  return { ok: true, clientId };
}

/** Resolves the client that owns a child record, for scope checks. */
export async function clientOf(table: "tasks" | "appointments" | "documents" | "followups" | "client_preferences" | "assessments" | "audit_alerts", id: string) {
  const db = sql();
  const [row] = await db`select client_id from ${db(table)} where id=${id}`;
  return row ? { found: true as const, clientId: (row.client_id as string | null) ?? null } : { found: false as const, clientId: null };
}
