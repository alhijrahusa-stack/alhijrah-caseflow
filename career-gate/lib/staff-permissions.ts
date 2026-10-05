import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";

export async function permissionStaffDirectory(session: StaffSession) {
  if (session.staff.role === "staff") return [];
  return withStaff(session, async (tx) =>
    (await tx`
      select id,display_name,email,role,active,auth_user_id is not null as linked,
             staff_code,commission_type,commission_value,eligible_for_round_robin,
             permission_mode,custom_permissions,updated_at
      from staff
      order by active desc,staff_code nulls last,display_name
    `) as unknown as Array<{
      id: string;
      display_name: string;
      email: string | null;
      role: "admin" | "manager" | "staff";
      active: boolean;
      linked: boolean;
      staff_code: string | null;
      commission_type: "fixed" | "percent";
      commission_value: number;
      eligible_for_round_robin: boolean;
      permission_mode: "full" | "custom";
      custom_permissions: string[];
      updated_at: string;
    }>);
}
