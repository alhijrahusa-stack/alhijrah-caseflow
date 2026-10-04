import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";
import type { PermissionMode, StaffPermission } from "@/lib/permissions";

export type StaffPermissionDirectoryRow = {
  id: string;
  display_name: string;
  email: string | null;
  role: "admin" | "manager" | "staff";
  active: boolean;
  staff_code: string | null;
  permission_mode: PermissionMode;
  permissions: StaffPermission[];
};

export async function staffPermissionDirectory(session: StaffSession): Promise<StaffPermissionDirectoryRow[]> {
  if (session.staff.role === "staff") return [];
  return withStaff(session, async (tx) =>
    (await tx`
      select id, display_name, email, role, active, staff_code, permission_mode, permissions
      from staff
      order by active desc, staff_code nulls last, display_name
    `).map((row) => ({
      id: String(row.id),
      display_name: String(row.display_name),
      email: row.email ? String(row.email) : null,
      role: row.role as StaffPermissionDirectoryRow["role"],
      active: Boolean(row.active),
      staff_code: row.staff_code ? String(row.staff_code) : null,
      permission_mode: row.permission_mode as PermissionMode,
      permissions: (row.permissions ?? []) as StaffPermission[],
    })),
  );
}
