import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";

export async function teamDirectory(session: StaffSession) {
  return withStaff(session, async (tx) =>
    (await tx`
      select id, display_name, email, role, active, auth_user_id is not null as linked,
             staff_code, legacy_code, access_scope,
             commission_type, commission_value, eligible_for_round_robin
      from staff
      order by active desc, staff_code nulls last, display_name
    `) as unknown as {
      id: string;
      display_name: string;
      email: string | null;
      role: string;
      active: boolean;
      linked: boolean;
      staff_code: string | null;
      legacy_code: string | null;
      access_scope: "full" | "assigned_only";
      commission_type: "fixed" | "percent";
      commission_value: number;
      eligible_for_round_robin: boolean;
    }[]);
}
