import { withStaff } from "@/lib/auth";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { suggestSlots } from "@/lib/scheduling";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

/** Next three free slots from office availability minus appointments and blocks. */
export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const g = await staffGuard(req, traceId, { mutation: false });
  if (g.response) return g.response;
  const sp = new URL(req.url).searchParams;
  const resourceKey = sp.get("resource") ?? "office";
  if (!/^(office|staff:[0-9a-f-]{36})$/.test(resourceKey)) return err("invalid_input", "Invalid resource", 400, traceId);
  const duration = sp.get("duration") ? Number(sp.get("duration")) : undefined;
  if (duration !== undefined && !(duration >= 5 && duration <= 480)) return err("invalid_input", "Invalid duration", 400, traceId);
  const slots = await withStaff(g.session, (tx) =>
    suggestSlots(tx, { resourceKey, appointmentType: sp.get("type"), durationMinutes: duration, count: 3, days: 21 }));
  return ok({ slots, source: "Career Gate internal calendar" }, 200, traceId);
}
