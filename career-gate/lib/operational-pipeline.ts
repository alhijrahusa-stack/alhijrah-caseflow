import "server-only";
import { ACCOUNT_NET_FEE } from "@/lib/accounting-schema";
import { withStaff, type StaffSession } from "@/lib/auth";
import type { OperationsClient, PipelineStage } from "@/lib/operations";

export async function activePipelineData(session:StaffSession):Promise<{stages:PipelineStage[];clients:OperationsClient[];exceptions:OperationsClient[]}>{
  return withStaff(session,async(tx)=>{
    const stagesRaw=await tx`select key,position,label_en,label_ar,color,terminal from pipeline_stages order by position`;
    const clientsRaw=await tx`
      select c.id,c.ref,c.full_name,c.phone,c.email,c.pipeline_stage,c.current_status,c.next_step,c.assigned_staff,c.created_at,c.updated_at,
             s.display_name assigned_name,s.staff_code,
             p.site_code,p.site_name,p.site_address,p.shift_code,p.shift_name,p.days shift_days,p.hours shift_hours,p.shift_period,p.auto_dispatched_at,p.pay_snapshot,
             a.payment_status,${tx.unsafe(ACCOUNT_NET_FEE("a"))} fee_amount
      from clients c
      left join staff s on s.id=c.assigned_staff
      left join lateral (
        select site_code,site_name,site_address,shift_code,shift_name,days,hours,shift_period,auto_dispatched_at,pay_snapshot
        from client_preferences p where p.client_id=c.id
        order by case p.rank when 'primary' then 0 else 1 end,p.preference_order limit 1
      ) p on true
      left join client_accounts a on a.client_id=c.id
      where c.deleted_at is null and c.current_status not in ('completed','cancelled')
      order by c.updated_at desc limit 1000`;
    const stages=stagesRaw as unknown as PipelineStage[];
    const terminal=new Set(stages.filter((s)=>s.terminal).map((s)=>s.key));
    const all=(clientsRaw as unknown as OperationsClient[]).map((c)=>({...c,fee_amount:c.fee_amount==null?null:Number(c.fee_amount)}));
    return { stages:stages.filter((s)=>!s.terminal), clients:all.filter((c)=>!terminal.has(c.pipeline_stage)), exceptions:all.filter((c)=>terminal.has(c.pipeline_stage)) };
  });
}
