import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";

export type ClientView = "active" | "completed" | "all";
export type OperationalClientRow = {
  id:string; ref:string; full_name:string; phone:string; email:string|null; city:string|null;
  current_status:string; next_step:string; start_date:string|null; updated_at:string;
  assigned_staff:string|null; assigned_name:string|null; site_code:string|null; site_name:string|null;
  job_id:string|null; job_title:string|null; shift_code:string|null; shift_name:string|null;
  payment_status:string|null; fee_amount:number|null;
};

export async function operationalClientList(session:StaffSession, view:ClientView, page:number, pageSize:number){
  return withStaff(session, async(tx)=>{
    const lifecycle = view === "active"
      ? tx`c.current_status not in ('completed','cancelled')`
      : view === "completed"
        ? tx`c.current_status = 'completed'`
        : tx`true`;
    const [{total}] = await tx`select count(*)::int as total from clients c where c.deleted_at is null and ${lifecycle}`;
    const rows = await tx`
      select c.id,c.ref,c.full_name,c.phone,c.email,c.city,c.current_status,c.next_step,c.start_date,c.updated_at,c.assigned_staff,
             s.display_name as assigned_name,p.site_code,p.site_name,p.job_id,p.job_title,p.shift_code,p.shift_name,a.payment_status,a.fee_amount
      from clients c
      left join staff s on s.id=c.assigned_staff
      left join lateral (
        select site_code,site_name,job_id,job_title,shift_code,shift_name
        from client_preferences p where p.client_id=c.id and p.rank='primary'
        order by p.preference_order limit 1
      ) p on true
      left join client_accounts a on a.client_id=c.id
      where c.deleted_at is null and ${lifecycle}
      order by c.updated_at desc,c.id
      limit ${pageSize} offset ${(page-1)*pageSize}`;
    return { rows:(rows as unknown as OperationalClientRow[]).map((r)=>({...r,fee_amount:r.fee_amount==null?null:Number(r.fee_amount)})), total:Number(total??0) };
  });
}
