import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";

const OPEN_TASKS=["pending","in_progress"];

export type AssignmentTask={id:string;title:string;assigned_to:string|null;assigned_to_name:string|null;status:string;due_at:string|null};
export type AssignmentClient={id:string;ref:string;full_name:string;phone:string;email:string|null;pipeline_stage:string;assigned_staff:string|null;assigned_name:string|null;staff_code:string|null;site_code:string|null;site_name:string|null;shift_code:string|null;shift_name:string|null;open_tasks:AssignmentTask[];updated_at:string};

export async function assignmentData(session:StaffSession){
  return withStaff(session,async(tx)=>{
    const staff=await tx`select id,display_name,email,role,active,staff_code,commission_type,commission_value,eligible_for_round_robin from staff order by active desc,staff_code nulls last,display_name`;
    const clients=await tx`
      with primary_pref as (
        select distinct on (p.client_id) p.client_id,p.site_code,p.site_name,p.shift_code,p.shift_name
        from client_preferences p join clients c on c.id=p.client_id
        where c.deleted_at is null and c.current_status not in ('completed','cancelled') and p.rank='primary'
        order by p.client_id,p.preference_order
      ),
      task_json as (
        select t.client_id,jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'assigned_to',t.assigned_to,'assigned_to_name',s.display_name,'status',t.status,'due_at',t.due_at) order by t.due_at nulls last,t.created_at) as open_tasks
        from tasks t left join staff s on s.id=t.assigned_to join clients c on c.id=t.client_id
        where c.deleted_at is null and c.current_status not in ('completed','cancelled') and t.status=any(${OPEN_TASKS})
        group by t.client_id
      )
      select c.id,c.ref,c.full_name,c.phone,c.email,c.pipeline_stage,c.assigned_staff,s.display_name assigned_name,s.staff_code,c.updated_at,
             p.site_code,p.site_name,p.shift_code,p.shift_name,coalesce(t.open_tasks,'[]'::jsonb) as open_tasks
      from clients c left join staff s on s.id=c.assigned_staff left join primary_pref p on p.client_id=c.id left join task_json t on t.client_id=c.id
      where c.deleted_at is null and c.current_status not in ('completed','cancelled')
      order by c.assigned_staff nulls first,c.updated_at desc limit 1000`;
    const settings=await tx`select round_robin_enabled,cursor,updated_at from assignment_settings where singleton=true`;
    return {
      staff:(staff as unknown as Array<{id:string;display_name:string;email:string|null;role:string;active:boolean;staff_code:string|null;commission_type:"fixed"|"percent";commission_value:number;eligible_for_round_robin:boolean}>).map((s)=>({...s,commission_value:Number(s.commission_value)})),
      clients:(clients as unknown as AssignmentClient[]).map((c)=>({...c,open_tasks:Array.isArray(c.open_tasks)?c.open_tasks:[]})),
      settings:settings[0]?{round_robin_enabled:Boolean(settings[0].round_robin_enabled),cursor:Number(settings[0].cursor),updated_at:String(settings[0].updated_at)}:{round_robin_enabled:false,cursor:0,updated_at:""},
    };
  });
}
