import { staffGuard } from "@/lib/staff-api";
import { withStaff } from "@/lib/auth";
import { ok } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(req:Request){
  const guard=await staffGuard(req,crypto.randomUUID(),{mutation:false});
  if(guard.response)return guard.response;
  const since=new URL(req.url).searchParams.get("since");
  const timestamp=since&&Number.isFinite(Date.parse(since))?new Date(since):new Date(Date.now()-60000);
  const floor=new Date(Math.max(timestamp.getTime(),Date.now()-10*60000));
  const rows=await withStaff(guard.session,async tx=>await tx`
    select a.id,a.client_id,a.created_at,a.new_value->>'client_action' as action,c.full_name
    from activity_log a join clients c on c.id=a.client_id
    where a.action='appointment_updated' and a.new_value->>'client_action' in ('confirm','reschedule','cancel')
      and a.created_at>${floor} and c.deleted_at is null
    order by a.created_at asc limit 40`);
  return ok({events:rows.map(r=>({id:String(r.id),clientId:String(r.client_id),at:new Date(r.created_at).toISOString(),action:String(r.action),name:String(r.full_name)})),serverTime:new Date().toISOString()});
}
