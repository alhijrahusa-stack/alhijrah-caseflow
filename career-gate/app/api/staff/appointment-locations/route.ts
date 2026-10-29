import { withStaff } from "@/lib/auth";
import { ok } from "@/lib/http";
import { staffGuard } from "@/lib/staff-api";
import { traceIdFrom } from "@/lib/obs";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: false });
  if (guard.response) return guard.response;
  const locations = await withStaff(guard.session, tx => tx`
    select id, code, display_city, facility_type, street_address, city, state, zip_code
    from public.appointment_locations where active order by display_city, code`);
  return ok({ locations }, 200, traceId);
}
