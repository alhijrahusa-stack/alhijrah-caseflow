import "server-only";
import { ACCOUNT_NET_FEE } from "@/lib/accounting-schema";
import { withStaff, type StaffSession } from "@/lib/auth";

export type ClientView = "active" | "completed" | "all";
export type OperationalClientRow = {
  id:string; ref:string; full_name:string; phone:string; email:string|null; city:string|null;
  current_status:string; next_step:string; start_date:string|null; created_at:string; updated_at:string;
  assigned_staff:string|null; assigned_name:string|null; site_code:string|null; site_name:string|null;
  job_id:string|null; job_title:string|null; shift_code:string|null; shift_name:string|null;
  payment_status:string|null; fee_amount:number|null;
};
export type OperationalClientExtraFilters={q?:string;status?:string;assigned?:string;attention?:"documents";completedThisMonth?:boolean};

export async function operationalClientList(session:StaffSession, view:ClientView, page:number, pageSize:number, extra:OperationalClientExtraFilters={}){
  return withStaff(session, async(tx)=>{
    const lifecycle = view === "active"
      ? tx`c.current_status not in ('completed','cancelled')`
      : view === "completed"
        ? tx`c.current_status = 'completed'`
        : tx`true`;
    const term=extra.q?.trim()??"";
    const like=`%${term.replace(/[\\%_]/g,(m)=>`\\${m}`)}%`;
    const where=tx`c.deleted_at is null and ${lifecycle}
      ${extra.status?tx`and c.current_status=${extra.status}`:tx``}
      ${extra.completedThisMonth?tx`and c.current_status='completed' and exists (select 1 from activity_log l where l.client_id=c.id and l.action in ('status_changed','status_overridden') and l.new_value->>'status'='completed' and l.created_at>=date_trunc('month',now()))`:tx``}
      ${extra.attention==="documents"?tx`and exists (
        select 1 from documents d
        where d.client_id=c.id and d.status in ('needs_review','needs_reupload','rejected')
          and not exists (
            select 1 from documents n
            where n.client_id=d.client_id and n.doc_type=d.doc_type
              and (n.uploaded_at,n.id)>(d.uploaded_at,d.id)
          )
      )`:tx``}
      ${extra.assigned==="none"?tx`and c.assigned_staff is null and c.current_status not in ('completed','cancelled')`:extra.assigned?tx`and c.assigned_staff=${extra.assigned}`:tx``}
      ${term?tx`and (c.ref ilike ${like} or c.full_name ilike ${like} or c.email ilike ${like} or c.phone like ${like})`:tx``}`;
    const [{total}] = await tx`select count(*)::int as total from clients c where ${where}`;
    // Keep the view on a real page if filters or records changed since navigation.
    const maxPage = Math.max(1, Math.ceil(Number(total ?? 0) / pageSize));
    const safePage = Number.isSafeInteger(page) && page > 0 ? Math.min(page, maxPage) : 1;
    const rows = await tx`
      select c.id,c.ref,c.full_name,c.phone,c.email,c.city,c.current_status,c.next_step,c.start_date,c.created_at,c.updated_at,c.assigned_staff,
             s.display_name as assigned_name,p.site_code,p.site_name,p.job_id,p.job_title,p.shift_code,p.shift_name,a.payment_status,${tx.unsafe(ACCOUNT_NET_FEE("a"))} fee_amount
      from clients c
      left join staff s on s.id=c.assigned_staff
      left join lateral (
        select site_code,site_name,job_id,job_title,shift_code,shift_name
        from client_preferences p where p.client_id=c.id and p.rank='primary'
        order by p.preference_order limit 1
      ) p on true
      left join client_accounts a on a.client_id=c.id
      where ${where}
      order by c.updated_at desc,c.id
      limit ${pageSize} offset ${(safePage-1)*pageSize}`;
    return { rows:(rows as unknown as OperationalClientRow[]).map((r)=>({...r,fee_amount:r.fee_amount==null?null:Number(r.fee_amount)})), total:Number(total??0), page:safePage };
  });
}
