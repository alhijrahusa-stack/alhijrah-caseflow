import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";

export type WorkspaceClient={id:string;ref:string;full_name:string;current_status:string;pipeline_stage:string;next_step:string;next_action_due_at:string|null;waiting_condition:string|null;readiness_percent:number|null;missing_count:number;updated_at:string};
export type WorkspaceTask={id:string;client_id:string;client_ref:string;client_name:string;title:string;description:string|null;due_at:string|null;status:string};
export type WorkspaceAppointment={id:string;client_id:string;client_ref:string;client_name:string;appointment_type:string;scheduled_at:string;status:string;location:string|null};
export type WorkspaceFollowup={id:string;client_id:string;client_ref:string;client_name:string;due_date:string;reason:string;status:string};
export type WorkspaceReview={id:string;client_id:string;client_ref:string;client_name:string;doc_type:string;file_name:string;status:string;uploaded_at:string};
export type WorkspaceCommission={id:string;client_id:string;client_ref:string;client_name:string;amount:number;status:string;created_at:string};
export type StaffWorkspaceData={clients:WorkspaceClient[];tasks:WorkspaceTask[];appointments:WorkspaceAppointment[];followups:WorkspaceFollowup[];reviews:WorkspaceReview[];commissions:WorkspaceCommission[]};
const s=(v:unknown)=>String(v);const ns=(v:unknown)=>v==null?null:String(v);

export async function staffWorkspaceData(session:StaffSession):Promise<StaffWorkspaceData>{
  return withStaff(session,async(tx)=>{
    const clients=await tx`
      select c.id,c.ref,c.full_name,c.current_status,c.pipeline_stage,c.next_step,c.next_action_due_at,c.waiting_condition,c.updated_at,
             r.readiness_percent,r.missing_count
        from clients c
        left join client_readiness r on r.client_id=c.id
       where c.deleted_at is null and c.current_status not in ('completed','cancelled') and c.assigned_staff=${session.staff.id}
       order by c.next_action_due_at nulls last,c.updated_at desc limit 250`;
    const tasks=await tx`
      select t.id,t.client_id,c.ref client_ref,c.full_name client_name,t.title,t.description,t.due_at,t.status
        from tasks t join clients c on c.id=t.client_id and c.deleted_at is null
       where t.status in ('pending','in_progress') and (t.assigned_to=${session.staff.id} or (t.assigned_to is null and c.assigned_staff=${session.staff.id}))
       order by t.due_at nulls last,t.created_at limit 250`;
    const appointments=await tx`
      select a.id,a.client_id,c.ref client_ref,c.full_name client_name,a.appointment_type,a.scheduled_at,a.status,a.location
        from appointments a join clients c on c.id=a.client_id and c.deleted_at is null
       where a.status in ('scheduled','confirmed','rescheduled') and a.scheduled_at>=now()-interval '12 hours'
         and (a.assigned_staff=${session.staff.id} or (a.assigned_staff is null and c.assigned_staff=${session.staff.id}))
       order by a.scheduled_at limit 100`;
    const followups=await tx`
      select f.id,f.client_id,c.ref client_ref,c.full_name client_name,f.due_date,f.reason,f.status
        from followups f join clients c on c.id=f.client_id and c.deleted_at is null
       where f.status='open' and c.assigned_staff=${session.staff.id}
       order by f.due_date,f.created_at limit 150`;
    const reviews=await tx`
      select distinct on(d.client_id,d.doc_type) d.id,d.client_id,c.ref client_ref,c.full_name client_name,d.doc_type,d.file_name,d.status,d.uploaded_at
        from documents d join clients c on c.id=d.client_id and c.deleted_at is null
       where c.assigned_staff=${session.staff.id} and d.status in ('needs_review','needs_reupload','rejected')
       order by d.client_id,d.doc_type,d.uploaded_at desc,d.id desc limit 150`;
    const commissions=await tx`
      select cm.id,cm.client_id,c.ref client_ref,c.full_name client_name,cm.amount,cm.status,cm.created_at
        from commissions cm join clients c on c.id=cm.client_id
       where cm.employee_id=${session.staff.id} and cm.status not in ('cancelled','reversed')
       order by case cm.status when 'eligible' then 0 when 'approved' then 1 when 'pending' then 2 else 3 end,cm.created_at desc limit 100`;
    return{
      clients:clients.map(r=>({id:s(r.id),ref:s(r.ref),full_name:s(r.full_name),current_status:s(r.current_status),pipeline_stage:s(r.pipeline_stage),next_step:s(r.next_step),next_action_due_at:ns(r.next_action_due_at),waiting_condition:ns(r.waiting_condition),readiness_percent:r.readiness_percent==null?null:Number(r.readiness_percent),missing_count:Number(r.missing_count??0),updated_at:s(r.updated_at)})),
      tasks:tasks.map(r=>({id:s(r.id),client_id:s(r.client_id),client_ref:s(r.client_ref),client_name:s(r.client_name),title:s(r.title),description:ns(r.description),due_at:ns(r.due_at),status:s(r.status)})),
      appointments:appointments.map(r=>({id:s(r.id),client_id:s(r.client_id),client_ref:s(r.client_ref),client_name:s(r.client_name),appointment_type:s(r.appointment_type),scheduled_at:s(r.scheduled_at),status:s(r.status),location:ns(r.location)})),
      followups:followups.map(r=>({id:s(r.id),client_id:s(r.client_id),client_ref:s(r.client_ref),client_name:s(r.client_name),due_date:s(r.due_date),reason:s(r.reason),status:s(r.status)})),
      reviews:reviews.map(r=>({id:s(r.id),client_id:s(r.client_id),client_ref:s(r.client_ref),client_name:s(r.client_name),doc_type:s(r.doc_type),file_name:s(r.file_name),status:s(r.status),uploaded_at:s(r.uploaded_at)})),
      commissions:commissions.map(r=>({id:s(r.id),client_id:s(r.client_id),client_ref:s(r.client_ref),client_name:s(r.client_name),amount:Number(r.amount),status:s(r.status),created_at:s(r.created_at)})),
    };
  });
}
