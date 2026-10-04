import "server-only";
import { sql } from "@/lib/db";
import type { StaffSession } from "@/lib/auth";
import {
  isStaffPermission,
  normalizePermissions,
  type PermissionMode,
  type StaffPermission,
} from "@/lib/permissions";

export class StaffPermissionMutationError extends Error {
  constructor(
    readonly code: "forbidden" | "not_found" | "invalid_input",
    message: string,
    readonly status: 400 | 403 | 404,
  ) {
    super(message);
    this.name = "StaffPermissionMutationError";
  }
}

export type StaffPermissionMutation = {
  staffId: string;
  permissionMode: PermissionMode;
  permissions: string[];
  traceId: string;
  ipHash: string;
};

export async function updateStaffPermissions(session: StaffSession, input: StaffPermissionMutation) {
  if (input.permissionMode !== "full" && input.permissionMode !== "custom") {
    throw new StaffPermissionMutationError("invalid_input", "Invalid permission mode", 400);
  }
  if (input.permissions.some((permission) => !isStaffPermission(permission))) {
    throw new StaffPermissionMutationError("invalid_input", "Unknown permission key", 400);
  }
  const selected = input.permissionMode === "custom" ? normalizePermissions(input.permissions) : [];

  return sql().begin(async (tx) => {
    const [actor] = await tx`
      select id, role, active, permission_mode, permissions
      from staff where id = ${session.staff.id} for update`;
    if (!actor?.active || (actor.role !== "admin" && actor.role !== "manager")) {
      throw new StaffPermissionMutationError("forbidden", "Permission administration requires management access", 403);
    }
    const actorPermissions = (actor.permissions ?? []) as string[];
    const actorCanManage = actor.permission_mode === "full" || actorPermissions.includes("manage_staff_permissions");
    if (!actorCanManage) {
      throw new StaffPermissionMutationError("forbidden", "Your access profile does not allow permission administration", 403);
    }

    const [target] = await tx`
      select id, role, active, permission_mode, permissions
      from staff where id = ${input.staffId} for update`;
    if (!target) throw new StaffPermissionMutationError("not_found", "Staff member not found", 404);
    if (actor.role === "manager" && target.role === "admin") {
      throw new StaffPermissionMutationError("forbidden", "Managers cannot change an administrator access profile", 403);
    }

    const previousMode = target.permission_mode as PermissionMode;
    const previousPermissions = normalizePermissions((target.permissions ?? []) as string[]);
    const [updated] = await tx`
      update staff
      set permission_mode = ${input.permissionMode}, permissions = ${selected}, updated_at = now()
      where id = ${input.staffId}
      returning id, role, permission_mode, permissions`;

    await tx`
      insert into security_events (event, staff_id, ip_hash, route, detail, trace_id)
      values (
        'staff_permissions_updated',
        ${session.staff.id},
        ${input.ipHash},
        '/api/staff/permissions',
        ${tx.json({
          actor_staff_id: session.staff.id,
          target_staff_id: input.staffId,
          previous_role: target.role,
          new_role: updated.role,
          previous_permission_mode: previousMode,
          new_permission_mode: updated.permission_mode,
          previous_permissions: previousPermissions,
          new_permissions: normalizePermissions((updated.permissions ?? []) as string[]),
        })},
        ${input.traceId}
      )`;

    return {
      staff_id: String(updated.id),
      role: String(updated.role),
      permission_mode: updated.permission_mode as PermissionMode,
      permissions: normalizePermissions((updated.permissions ?? []) as string[]) as StaffPermission[],
    };
  });
}
