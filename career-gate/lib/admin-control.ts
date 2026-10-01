import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";

export type PermissionRuleRow = { id:string; role:"admin"|"manager"|"staff"; resource:string; action:string; scope:"ALL"|"ASSIGNED"|"NONE"; updated_at:string };
export type WorkflowVersionRow = { id:string; version_no:number; label:string; status:"draft"|"published"|"retired"; created_at:string; published_at:string|null; note:string|null };
export type WorkflowRuleRow = { version_id:string; status:string; label_en:string; default_next_action:string; sequence:number; terminal:boolean; active:boolean };
export type WorkflowTransitionRow = { version_id:string; from_status:string; to_status:string };
export type WorkflowEntryRow = { version_id:string; status:string };
export type AdminStaffRow = {
  id:string; staff_code:string|null; display_name:string; email:string|null; role:string; active:boolean; phone:string|null;
  date_of_birth:string|null; address_line1:string|null; city:string|null; state:string|null; postal_code:string|null;
  qualification:string|null; job_title:string|null; join_date:string|null; employment_type:string|null; department:string|null;
  photo_storage_path:string|null; commission_type:string; commission_value:number; eligible_for_round_robin:boolean;
};
export type AssetRow = { id:string; asset_code:string; asset_type:string; ownership:string; brand:string|null; model:string|null; serial_number:string|null; condition:string; status:string; note:string|null; assigned_staff:string|null; assigned_name:string|null; assignment_id:string|null; issued_at:string|null; return_due_at:string|null };
export type AdminHealth = {
  jobs:{ status:string; n:number }[];
  notifications:{ status:string; n:number }[];
  open_audit_alerts:number;
  unassigned_active_clients:number;
  overdue_tasks:number;
};

const str=(v:unknown)=>String(v);
const nullableStr=(v:unknown)=>v==null?null:String(v);
const bool=(v:unknown)=>Boolean(v);

export async function adminControlData(session: StaffSession) {
  return withStaff(session, async (tx) => {
    const permissions = await tx`select id,role,resource,action,scope,updated_at from permission_rules order by resource,action,role`;
    const versions = await tx`select id,version_no,label,status,created_at,published_at,note from workflow_versions order by version_no desc`;
    const rules = await tx`select version_id,status,label_en,default_next_action,sequence,terminal,active from workflow_version_status_rules order by version_id,sequence`;
    const transitions = await tx`select version_id,from_status,to_status from workflow_version_transitions order by version_id,from_status,to_status`;
    const entries = await tx`select version_id,status from workflow_version_entry_states order by version_id,status`;
    const staff = await tx`
      select id,staff_code,display_name,email,role,active,phone,date_of_birth,address_line1,city,state,postal_code,
             qualification,job_title,join_date,employment_type,department,photo_storage_path,
             commission_type,commission_value,eligible_for_round_robin
        from staff order by active desc,staff_code nulls last,display_name`;
    const assets = await tx`
      select a.id,a.asset_code,a.asset_type,a.ownership,a.brand,a.model,a.serial_number,a.condition,a.status,a.note,
             aa.id assignment_id,aa.staff_id assigned_staff,s.display_name assigned_name,aa.issued_at,aa.return_due_at
        from assets a
        left join lateral (
          select * from asset_assignments x where x.asset_id=a.id and x.status in ('assigned','in_use','maintenance')
          order by x.issued_at desc limit 1
        ) aa on true
        left join staff s on s.id=aa.staff_id
       order by case a.status when 'maintenance' then 0 when 'available' then 1 when 'assigned' then 2 when 'in_use' then 3 else 4 end,a.asset_code`;
    const jobHealth = await tx`select status,count(*)::int n from jobs group by status order by status`;
    const notificationHealth = await tx`select status,count(*)::int n from notifications group by status order by status`;
    const [{ n: openAudit }] = await tx`select count(*)::int n from audit_alerts where status='open'`;
    const [{ n: unassigned }] = await tx`select count(*)::int n from clients where deleted_at is null and current_status not in ('completed','cancelled') and assigned_staff is null`;
    const [{ n: overdue }] = await tx`select count(*)::int n from tasks where status in ('pending','in_progress') and due_at < now()`;

    const permissionRows:PermissionRuleRow[]=permissions.map((r)=>({
      id:str(r.id),role:str(r.role) as PermissionRuleRow["role"],resource:str(r.resource),action:str(r.action),scope:str(r.scope) as PermissionRuleRow["scope"],updated_at:str(r.updated_at),
    }));
    const versionRows:WorkflowVersionRow[]=versions.map((r)=>({
      id:str(r.id),version_no:Number(r.version_no),label:str(r.label),status:str(r.status) as WorkflowVersionRow["status"],created_at:str(r.created_at),published_at:nullableStr(r.published_at),note:nullableStr(r.note),
    }));
    const ruleRows:WorkflowRuleRow[]=rules.map((r)=>({
      version_id:str(r.version_id),status:str(r.status),label_en:str(r.label_en),default_next_action:str(r.default_next_action),sequence:Number(r.sequence),terminal:bool(r.terminal),active:bool(r.active),
    }));
    const transitionRows:WorkflowTransitionRow[]=transitions.map((r)=>({version_id:str(r.version_id),from_status:str(r.from_status),to_status:str(r.to_status)}));
    const entryRows:WorkflowEntryRow[]=entries.map((r)=>({version_id:str(r.version_id),status:str(r.status)}));
    const staffRows:AdminStaffRow[]=staff.map((r)=>({
      id:str(r.id),staff_code:nullableStr(r.staff_code),display_name:str(r.display_name),email:nullableStr(r.email),role:str(r.role),active:bool(r.active),phone:nullableStr(r.phone),date_of_birth:nullableStr(r.date_of_birth),address_line1:nullableStr(r.address_line1),city:nullableStr(r.city),state:nullableStr(r.state),postal_code:nullableStr(r.postal_code),qualification:nullableStr(r.qualification),job_title:nullableStr(r.job_title),join_date:nullableStr(r.join_date),employment_type:nullableStr(r.employment_type),department:nullableStr(r.department),photo_storage_path:nullableStr(r.photo_storage_path),commission_type:str(r.commission_type),commission_value:Number(r.commission_value),eligible_for_round_robin:bool(r.eligible_for_round_robin),
    }));
    const assetRows:AssetRow[]=assets.map((r)=>({
      id:str(r.id),asset_code:str(r.asset_code),asset_type:str(r.asset_type),ownership:str(r.ownership),brand:nullableStr(r.brand),model:nullableStr(r.model),serial_number:nullableStr(r.serial_number),condition:str(r.condition),status:str(r.status),note:nullableStr(r.note),assigned_staff:nullableStr(r.assigned_staff),assigned_name:nullableStr(r.assigned_name),assignment_id:nullableStr(r.assignment_id),issued_at:nullableStr(r.issued_at),return_due_at:nullableStr(r.return_due_at),
    }));
    const health:AdminHealth={
      jobs:jobHealth.map((r)=>({status:str(r.status),n:Number(r.n)})),
      notifications:notificationHealth.map((r)=>({status:str(r.status),n:Number(r.n)})),
      open_audit_alerts:Number(openAudit),unassigned_active_clients:Number(unassigned),overdue_tasks:Number(overdue),
    };
    return { permissions:permissionRows, workflow:{versions:versionRows,rules:ruleRows,transitions:transitionRows,entries:entryRows}, staff:staffRows, assets:assetRows, health };
  });
}
