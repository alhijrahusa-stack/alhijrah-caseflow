import "server-only";
import { cache } from "react";
import { withStaff, type StaffSession } from "@/lib/auth";
import { G3_STAGES } from "@/lib/g3-stages";
import { teamWorkload } from "@/lib/operational-team";
import { systemHealth } from "@/lib/operational-dashboard";

export type ExecutiveSummary = {
  generated_at:string;
  stages:{id:string;label:string;labelAr:string;href:string;total:number;wait_hours:number|null}[];
  revenue_pending:number; document_blockers:number; conversion_rate:number|null;
  queues:{overdue_tasks:number;overdue_followups:number;unassigned_clients:number;completed_this_month:number};
  paid_total:number; completed:number; payment_pending:number; audit_alerts:number;
  priorities:{id:string;ref:string;full_name:string;kind:string;amount:number;href:string;age_days:number}[];
  team:{id:string;display_name:string;role:string;active_clients:number;open_tasks:number;overdue_tasks:number;followups_due:number}[];
  health:{status:"HEALTHY"|"DEGRADED"|"FAILED";db_ms:number;dead_jobs:number;failed_deliveries:number}|null;
};

export const executiveSummary=cache(async(session:StaffSession):Promise<ExecutiveSummary>=>{
  const [operational,team,system]=await Promise.all([
    withStaff(session,async tx=>{
      await tx`select set_config('statement_timeout','6500',true)`;
      const [groups,[totals],priorities]=await Promise.all([
        tx`select c.current_status status,count(*)::int total,
          sum(extract(epoch from(now()-coalesce(last_entry.entered_at,c.created_at)))/3600)::numeric age_hours
          from clients c left join lateral (
            select max(l.created_at) entered_at from activity_log l where l.client_id=c.id
              and l.action in ('status_changed','status_overridden') and l.new_value->>'status'=c.current_status
          ) last_entry on true where c.deleted_at is null and c.current_status<>'cancelled' group by c.current_status`,
        tx`with live as(select id,current_status from clients where deleted_at is null and current_status<>'cancelled'),
          last_outcome as(select distinct on(o.client_id) o.client_id,o.decision from appointment_outcomes o
            join live c on c.id=o.client_id order by o.client_id,o.recorded_at desc,o.appointment_id desc)
          select
            (select coalesce(sum(greatest(b.balance,0)),0) from client_account_balances b join live c on c.id=b.client_id)::numeric revenue_pending,
            (select coalesce(sum(b.amount_paid-b.refund_amount),0) from client_account_balances b join live c on c.id=b.client_id)::numeric paid_total,
            (select count(*) from live c where c.current_status=any(${[...G3_STAGES[4].statuses]}) and exists(
              select 1 from client_account_balances b where b.client_id=c.id and b.payment_status<>'paid'))::int payment_pending,
            (select count(*) from live c where c.current_status not in ('completed','cancelled') and exists(
              select 1 from documents d where d.client_id=c.id and d.status in ('needs_review','needs_reupload','rejected')
                and not exists(select 1 from documents n where n.client_id=d.client_id and n.doc_type=d.doc_type and (n.uploaded_at,n.id)>(d.uploaded_at,d.id))))::int document_blockers,
            (select round(100.0*count(*) filter(where decision='pass')/nullif(count(*) filter(where decision in('pass','fail')),0),1) from last_outcome) conversion_rate,
            (select count(*) from live where current_status='completed')::int completed,
            (select count(*) from audit_alerts where status='open')::int audit_alerts,
            (select count(*) from tasks t left join clients c on c.id=t.client_id where (c.id is null or c.deleted_at is null) and t.status in ('pending','in_progress') and t.due_at<now())::int overdue_tasks,
            (select count(*) from followups f join live c on c.id=f.client_id where c.current_status<>'completed' and f.status='open' and f.due_date<(now() at time zone 'America/Detroit')::date)::int overdue_followups,
            (select count(*) from clients c where c.deleted_at is null and c.current_status not in ('completed','cancelled') and c.assigned_staff is null)::int unassigned_clients,
            (select count(*) from live c where c.current_status='completed' and exists(select 1 from activity_log l where l.client_id=c.id and l.action in('status_changed','status_overridden') and l.new_value->>'status'='completed' and l.created_at>=date_trunc('month',now())))::int completed_this_month`,
        tx`with candidates as(
            select c.id,c.ref,c.full_name,'payment_overdue'::text kind,greatest(b.balance,0)::numeric amount,
              extract(epoch from(now()-o.recorded_at))/86400 age_days,3 priority
            from clients c join client_account_balances b on b.client_id=c.id
            join lateral(select recorded_at,decision from appointment_outcomes where client_id=c.id order by recorded_at desc limit 1)o on true
            where c.deleted_at is null and c.current_status=any(${[...G3_STAGES[4].statuses]}) and o.decision='pass'
              and b.balance>0 and o.recorded_at<now()-interval '3 days'
            union all
            select c.id,c.ref,c.full_name,'schedule_interview',0,extract(epoch from(now()-c.updated_at))/86400,2
              from clients c where c.deleted_at is null and c.current_status in('shift_selected','appointment_required')
                and not exists(select 1 from appointments a where a.client_id=c.id and a.status in('scheduled','confirmed','rescheduled'))
            union all
            select c.id,c.ref,c.full_name,'appointment_repair',0,extract(epoch from(now()-c.updated_at))/86400,4
              from clients c where c.deleted_at is null and c.current_status='appointment_scheduled'
                and not exists(select 1 from appointments a where a.client_id=c.id and a.status in('scheduled','confirmed','rescheduled','attended')
                  and not exists(select 1 from appointment_outcomes o where o.appointment_id=a.id))
            union all
            select c.id,c.ref,c.full_name,'document_review',0,extract(epoch from(now()-c.updated_at))/86400,1
              from clients c where c.deleted_at is null and c.current_status not in('completed','cancelled') and exists(
                select 1 from documents d where d.client_id=c.id and d.status in('needs_review','needs_reupload','rejected')
                  and not exists(select 1 from documents n where n.client_id=d.client_id and n.doc_type=d.doc_type and (n.uploaded_at,n.id)>(d.uploaded_at,d.id)))
          ) select * from(select distinct on(id) id,ref,full_name,kind,amount,age_days,priority from candidates order by id,priority desc) deduplicated order by priority desc,age_days desc,id limit 5`,
      ]);
      return {groups,totals,priorities};
    }),
    teamWorkload(session),
    systemHealth(session),
  ]);
  const n=(value:unknown)=>Number(value??0);
  const {totals}=operational;
  return {
    generated_at:new Date().toISOString(),
    stages:G3_STAGES.map(stage=>{
      const groups=operational.groups.filter(group=>(stage.statuses as readonly string[]).includes(String(group.status)));
      const total=groups.reduce((sum,group)=>sum+n(group.total),0);
      return {id:stage.id,label:stage.label,labelAr:stage.labelAr,href:stage.href,total,
        wait_hours:total?groups.reduce((sum,group)=>sum+n(group.age_hours),0)/total:null};
    }),
    queues:{overdue_tasks:n(totals.overdue_tasks),overdue_followups:n(totals.overdue_followups),unassigned_clients:n(totals.unassigned_clients),completed_this_month:n(totals.completed_this_month)},
    revenue_pending:n(totals.revenue_pending),document_blockers:n(totals.document_blockers),
    conversion_rate:totals.conversion_rate==null?null:n(totals.conversion_rate),paid_total:n(totals.paid_total),
    completed:n(totals.completed),payment_pending:n(totals.payment_pending),audit_alerts:n(totals.audit_alerts),
    priorities:operational.priorities.map(row=>({
      id:String(row.id),ref:String(row.ref),full_name:String(row.full_name),kind:String(row.kind),amount:n(row.amount),age_days:n(row.age_days),
      href:row.kind==='payment_overdue'?`/staff/accounting?q=${encodeURIComponent(String(row.ref))}`:`/staff/client/${row.id}${row.kind==='schedule_interview'||row.kind==='appointment_repair'?'?panel=appointment':'?tab=documents'}`,
    })),
    team:team.members.filter(member=>member.active).map(member=>({id:member.id,display_name:member.display_name,role:member.role,
      active_clients:member.active_clients,open_tasks:member.open_tasks,overdue_tasks:member.overdue_tasks,followups_due:member.followups_due})),
    health:system?{status:system.status,db_ms:system.db_ms,dead_jobs:system.queue.dead,failed_deliveries:system.failed_notifications_24h}:null,
  };
});
