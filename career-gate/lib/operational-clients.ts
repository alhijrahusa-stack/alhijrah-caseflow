import "server-only";
import type { ReviewStampData } from "@/components/staff/ReviewStamp";
import { ACCOUNT_NET_FEE } from "@/lib/accounting-schema";
import { type ClientStageFilter } from "@/lib/client-lifecycle-filters";
import { workflowFilter } from "@/lib/workflow-filters";
import { withStaff, type StaffSession } from "@/lib/auth";
import { registrySearchPredicate } from "@/lib/registry-search";
import { CURRENT_EMPLOYMENT_CONFIRMATION_SQL } from "@/lib/employment-registry-read";

export type ClientView = "active" | "completed" | "all";
export type OperationalClientRow = {
  id:string; ref:string; full_name:string; phone:string; email:string|null; city:string|null;
  current_status:string; next_step:string; start_date:string|null; created_at:string; updated_at:string;
  assigned_staff:string|null; assigned_name:string|null; site_code:string|null; site_name:string|null;
  job_id:string|null; job_title:string|null; shift_code:string|null; shift_name:string|null;
  payment_status:string|null; fee_amount:number|null; amazon_account_ready:boolean;
  is_urgent?:boolean; manager_review_id?:string|null; operational_location?:string; review_stamp?:ReviewStampData|null;
  employment_confirmation_id?:string|null; actual_start_date?:string|null;
  employment_site_code?:string|null; employment_site_name?:string|null; employment_site_address?:string|null;
  employment_job_title?:string|null; employment_shift_name?:string|null; employment_shift_days?:string|null; employment_shift_hours?:string|null;
  employment_confirmed_by_name?:string|null; employment_confirmed_at?:string|null;
};
export type OperationalClientExtraFilters={q?:string;status?:string;stage?:ClientStageFilter;assigned?:string;attention?:"documents";completedThisMonth?:boolean;
  urgent?:boolean;group?:"paperwork";year?:number;confirmation?:"confirmed"|"unconfirmed";sort?:"started_asc"|"started_desc"};

export async function operationalClientList(session:StaffSession, view:ClientView, page:number, pageSize:number, extra:OperationalClientExtraFilters={}){
  return withStaff(session, async(tx)=>{
    const urgent = extra.urgent || extra.stage === "urgent";
    const lifecycle = view === "active"
      ? urgent ? tx`c.current_status not in ('completed','cancelled')` : extra.stage === "worksite_change"
        ? tx`c.operational_location='worksite_change'` : tx`c.operational_location not in ('completed','cancelled','manager','deleted','worksite_change')`
      : view === "completed" ? tx`c.operational_location='completed'` : tx`true`;
    const stageFilter = extra.stage && extra.stage !== "urgent" ? workflowFilter(tx, extra.stage) : tx`true`;
    const employmentNeeded = view !== "active" || Boolean(extra.year || extra.confirmation || extra.sort);
    const employmentJoin = employmentNeeded ? tx`left join lateral (${tx.unsafe(CURRENT_EMPLOYMENT_CONFIRMATION_SQL)}) employment on true` : tx``;
    const employmentFields = employmentNeeded ? tx`employment.id employment_confirmation_id,employment.actual_start_date::text actual_start_date,
      employment.site_code employment_site_code,employment.site_name employment_site_name,employment.site_address employment_site_address,
      employment.job_title employment_job_title,employment.shift_name employment_shift_name,employment.shift_days employment_shift_days,employment.shift_hours employment_shift_hours,
      employment.confirmed_by_name employment_confirmed_by_name,employment.confirmed_at::text employment_confirmed_at` :
      tx`null::uuid employment_confirmation_id,null::text actual_start_date,null::text employment_site_code,null::text employment_site_name,
        null::text employment_site_address,null::text employment_job_title,null::text employment_shift_name,null::text employment_shift_days,null::text employment_shift_hours,
        null::text employment_confirmed_by_name,null::text employment_confirmed_at`;
    const term=extra.q?.trim().slice(0,100)??"";
    if(term)await tx`select set_config('pg_trgm.word_similarity_threshold','0.45',true)`;
    const where=tx`c.deleted_at is null and ${lifecycle} and ${stageFilter}
      ${urgent ? tx`and c.is_urgent and c.current_status not in ('completed','cancelled')` : tx``}
      ${extra.group === "paperwork" ? tx`and c.operational_location in ('payment_required','paperwork_pending')` : tx``}
      ${extra.year ? tx`and extract(year from employment.actual_start_date)::int=${extra.year}` : tx``}
      ${extra.confirmation === "confirmed" ? tx`and employment.id is not null` : extra.confirmation === "unconfirmed" ? tx`and employment.id is null` : tx``}
      ${extra.status?tx`and c.current_status=${extra.status}`:tx``}
      ${extra.completedThisMonth?tx`and c.current_status='completed' and exists (select 1 from activity_log l where l.client_id=c.id and l.action in ('status_changed','status_overridden') and l.new_value->>'status'='completed' and l.created_at>=date_trunc('month',now()))`:tx``}
      ${extra.attention==="documents"?tx`and exists (
        select 1 from documents d where d.client_id=c.id and d.status in ('needs_review','needs_reupload','rejected')
          and not exists (select 1 from documents n where n.client_id=d.client_id and n.doc_type=d.doc_type
            and (n.uploaded_at,n.id)>(d.uploaded_at,d.id))
      )`:tx``}
      ${extra.assigned==="none"?tx`and c.assigned_staff is null`:extra.assigned?tx`and c.assigned_staff=${extra.assigned}`:tx``}
      ${term?tx`and ${registrySearchPredicate(tx,term)}`:tx``}`;
    const [{total}] = await tx`select count(*)::int as total from clients c ${employmentJoin} where ${where}`;
    const maxPage = Math.max(1, Math.ceil(Number(total ?? 0) / pageSize));
    const safePage = Number.isSafeInteger(page) && page > 0 ? Math.min(page, maxPage) : 1;
    const order = extra.sort === "started_asc" ? tx`employment.actual_start_date asc nulls last,c.updated_at desc,c.id` :
      extra.sort === "started_desc" ? tx`employment.actual_start_date desc nulls last,c.updated_at desc,c.id` : tx`c.updated_at desc,c.id`;
    const rows = await tx`
      select c.id,c.ref,c.full_name,c.phone,c.email,c.city,c.current_status,c.next_step,c.start_date,c.created_at,c.updated_at::text as updated_at,c.assigned_staff,c.is_urgent,c.manager_review_id,c.operational_location,career_gate_private.client_review_stamp(c.id) as review_stamp,
             s.display_name as assigned_name,p.site_code,p.site_name,p.job_id,p.job_title,p.shift_code,p.shift_name,a.payment_status,${tx.unsafe(ACCOUNT_NET_FEE("a"))} fee_amount, career_gate_private.has_ready_gate_job_account(c.id) as amazon_account_ready,
             ${employmentFields}
      from clients c ${employmentJoin}
      left join staff s on s.id=c.assigned_staff
      left join lateral (
        select site_code,site_name,job_id,job_title,shift_code,shift_name from client_preferences p
        where p.client_id=c.id and p.rank='primary' order by p.preference_order limit 1
      ) p on true
      left join client_accounts a on a.client_id=c.id
      where ${where} order by ${order} limit ${pageSize} offset ${(safePage-1)*pageSize}`;
    return { rows:(rows as unknown as OperationalClientRow[]).map((r)=>({...r,fee_amount:r.fee_amount==null?null:Number(r.fee_amount)})), total:Number(total??0), page:safePage };
  });
}
