import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";

export type OperationalActivityRow={id:string;client_id:string|null;action:string;staff_id:string|null;staff_name:string|null;client_ref:string|null;client_name:string|null;created_at:string};
export type OperationalActivityData={last_minute:number;last_five_minutes:number;buckets:{minute:string;n:number}[];recent:OperationalActivityRow[]};

export async function operationalActivity(session:StaffSession):Promise<OperationalActivityData>{
  return withStaff(session,async(tx)=>{
    const [summary]=await tx`select count(*) filter (where created_at>=now()-interval '1 minute')::int as last_minute,count(*) filter (where created_at>=now()-interval '5 minutes')::int as last_five_minutes from activity_log`;
    const buckets=await tx`select date_trunc('minute',created_at) as minute,count(*)::int as n from activity_log where created_at>=now()-interval '5 minutes' group by 1 order by 1`;
    const recent=await tx`select l.id,l.client_id,l.action,l.staff_id,s.display_name as staff_name,c.ref as client_ref,c.full_name as client_name,l.created_at from activity_log l left join staff s on s.id=l.staff_id left join clients c on c.id=l.client_id order by l.created_at desc,l.id desc limit 100`;
    return {
      last_minute:Number(summary?.last_minute??0),last_five_minutes:Number(summary?.last_five_minutes??0),
      buckets:buckets.map((r)=>({minute:String(r.minute),n:Number(r.n)})),
      recent:recent as unknown as OperationalActivityRow[],
    };
  });
}
