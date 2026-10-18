import { staffGuard } from "@/lib/staff-api";
import { withStaff } from "@/lib/auth";
import { ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 80;

export async function GET(req: Request) {
  const guard = await staffGuard(req, crypto.randomUUID(), { mutation: false });
  if (guard.response) return guard.response;

  const now = Date.now();
  const supplied = new URL(req.url).searchParams.get("since");
  const parsed = supplied ? Date.parse(supplied) : NaN;
  const start = Number.isFinite(parsed) ? parsed : now - HISTORY_WINDOW_MS;
  const floor = new Date(Math.max(Math.min(start, now), now - HISTORY_WINDOW_MS));
  const cutoff = new Date(now);

  // Postgres RLS restricts results to clients visible to the logged-in employee.
  const rows = await withStaff(guard.session, async tx => tx`
    select a.id, a.client_id, a.created_at, a.new_value->>'client_action' as action, c.full_name
    from activity_log a join clients c on c.id=a.client_id
    where a.action='appointment_updated'
      and a.new_value->>'client_action' in ('confirm','reschedule','cancel')
      and a.created_at >= ${floor}
      and a.created_at <= ${cutoff}
      and c.deleted_at is null
    order by a.created_at desc, a.id desc
    limit ${MAX_EVENTS}`);

  return ok({
    events: rows.reverse().map(r => ({
      id: String(r.id),
      clientId: String(r.client_id),
      at: new Date(r.created_at).toISOString(),
      action: String(r.action),
      name: String(r.full_name),
    })),
    serverTime: cutoff.toISOString(),
  });
}
