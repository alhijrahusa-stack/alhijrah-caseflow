import { withStaff } from "@/lib/auth";
import { ACCOUNT_NET_FEE } from "@/lib/accounting-schema";
import { ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

/** Quick client search by file, name, email or phone. Results are RLS-scoped. */
export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const g = await staffGuard(req, traceId, { mutation: false });
  if (g.response) return g.response;
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return ok({ results: [] });
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const digits = q.replace(/\D/g, "");
  const results = await withStaff(g.session, (tx) => tx`
    select c.id,c.ref,c.full_name,c.phone,c.email,c.current_status,c.pipeline_stage,c.next_step,
           s.display_name as assigned_name,s.staff_code,
           p.site_code,p.shift_code,a.payment_status,${tx.unsafe(ACCOUNT_NET_FEE("a"))} fee_amount
    from clients c
    left join staff s on s.id=c.assigned_staff
    left join lateral (
      select site_code,shift_code from client_preferences p
      where p.client_id=c.id
      order by case p.rank when 'primary' then 0 else 1 end,p.preference_order
      limit 1
    ) p on true
    left join client_accounts a on a.client_id=c.id
    where c.deleted_at is null and (
      c.ref ilike ${like} or c.full_name ilike ${like} or c.email ilike ${like}
      ${digits.length >= 3 ? tx`or c.phone like ${`%${digits}%`}` : tx``}
    )
    order by
      case when lower(c.ref)=lower(${q}) then 0
           when lower(coalesce(c.email,''))=lower(${q}) then 1
           when regexp_replace(coalesce(c.phone,''),'\D','','g')=${digits} and ${digits.length >= 7} then 2
           else 3 end,
      c.updated_at desc
    limit 8`);
  return ok({ results });
}
