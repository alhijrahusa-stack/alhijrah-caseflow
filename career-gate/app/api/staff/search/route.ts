import { withStaff } from "@/lib/auth";
import { ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

/** Quick client search for the command palette (RLS-scoped, 8 results). */
export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const g = await staffGuard(req, traceId, { mutation: false });
  if (g.response) return g.response;
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return ok({ results: [] });
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const digits = q.replace(/\D/g, "");
  const results = await withStaff(g.session, (tx) => tx`
    select id, ref, full_name, current_status from clients
    where deleted_at is null and (ref ilike ${like} or full_name ilike ${like} or email ilike ${like}
      ${digits.length >= 3 ? tx`or phone like ${`%${digits}%`}` : tx``})
    order by updated_at desc limit 8`);
  return ok({ results });
}
