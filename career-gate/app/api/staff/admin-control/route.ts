import { z } from "zod";
import { withStaff } from "@/lib/auth";
import { permissionFor, type ActionName } from "@/lib/authz";
import { STATUSES } from "@/lib/domain";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";
const id=z.uuid();
const opt=(n:number)=>z.string().trim().max(n).nullable().optional().transform(v=>v||null);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const status=z.enum(STATUSES);

const Input=z.discriminatedUnion("operation",[
  z.object({operation:z.literal("update_permission"),rule_id:id,scope:z.enum(["ALL","ASSIGNED","NONE"])}),
  z.object({operation:z.literal("update_staff_profile"),staff_id:id,phone:opt(40),date_of_birth:date,address_line1:opt(200),city:opt(100),state:opt(40),postal_code:opt(20),qualification:opt(200),job_title:opt(120),join_date:date,employment_type:z.enum(["full_time","part_time","contractor","temporary","other"]).nullable().optional(),department:opt(120)}),
  z.object({operation:z.literal("create_asset"),asset_code:z.string().trim().min(1).max(80),asset_type:z.enum(["phone","laptop","tablet","other"]),ownership:z.enum(["office","personal"]),brand:opt(100),model:opt(100),serial_number:opt(160),condition:z.enum(["new","good","fair","damaged","repair"]),note:opt(1000)}),
  z.object({operation:z.literal("assign_asset"),asset_id:id,staff_id:id,issue_condition:z.enum(["new","good","fair","damaged","repair"]).nullable().optional(),return_due_at:z.iso.datetime({offset:true}).nullable().optional(),note:opt(1000)}),
  z.object({operation:z.literal("return_asset"),assignment_id:id,return_condition:z.enum(["new","good","fair","damaged","repair"]),note:opt(1000)}),
  z.object({operation:z.literal("clone_workflow"),label:z.string().trim().min(1).max(120),note:opt(1000)}),
  z.object({operation:z.literal("update_workflow_rule"),version_id:id,status,label_en:z.string().trim().min(1).max(120),default_next_action:z.string().trim().min(1).max(500),sequence:z.number().int().min(1).max(32000),terminal:z.boolean(),active:z.boolean()}),
  z.object({operation:z.literal("set_workflow_transition"),version_id:id,from_status:status,to_status:status,enabled:z.boolean()}),
  z.object({operation:z.literal("set_workflow_entry"),version_id:id,status,enabled:z.boolean()}),
  z.object({operation:z.literal("publish_workflow"),version_id:id}),
]);

type In=z.infer<typeof Input>;
function requiredAction(i:In):ActionName{
  if(i.operation==="update_permission")return "configure_permissions";
  if(i.operation==="update_staff_profile")return "manage_staff_profile";
  if(i.operation==="create_asset"||i.operation==="assign_asset"||i.operation==="return_asset")return "manage_assets";
  return "configure_workflow";
}

async function audit(tx:Parameters<Parameters<typeof withStaff>[1]>[0],staffId:string,traceId:string,action:string,entityType:string,entityId:string|null,oldValue:unknown,newValue:unknown){
  await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
           values(null,${action},${staffId},${entityType},${entityId},${oldValue===undefined?null:tx.json(oldValue as never)},${newValue===undefined?null:tx.json(newValue as never)},${traceId})`;
}

export async function POST(req:Request){
  const traceId=traceIdFrom(req);
  const guard=await staffGuard(req,traceId,{mutation:true});
  if(guard.response)return guard.response;
  const parsed=Input.safeParse(await req.json().catch(()=>null));
  if(!parsed.success)return err("invalid_input",parsed.error.issues[0]?.message??"Invalid admin operation",400,traceId);
  const input=parsed.data;
  const session=guard.session;
  const permission=await permissionFor(session.staff.role,requiredAction(input));
  if(!permission.allowed)return err("forbidden","Your role does not allow this administrative action",403,traceId);

  try{
    const result=await withStaff(session,async(tx)=>{
      if(input.operation==="update_permission"){
        const [before]=await tx`select id,role,resource,action,scope from permission_rules where id=${input.rule_id} for update`;
        if(!before)throw new Error("NOT_FOUND");
        if(before.role==="admin"&&before.action==="configure_permissions"&&input.scope!=="ALL")throw new Error("ADMIN_PERMISSION_LOCKOUT");
        await tx`update permission_rules set scope=${input.scope},updated_by=${session.staff.id},updated_at=now() where id=${input.rule_id}`;
        await audit(tx,session.staff.id,traceId,"permission_updated","permission_rule",input.rule_id,{scope:before.scope},{role:before.role,resource:before.resource,action:before.action,scope:input.scope});
        return{changed:before.scope!==input.scope};
      }

      if(input.operation==="update_staff_profile"){
        const [before]=await tx`select id,phone,date_of_birth,address_line1,city,state,postal_code,qualification,job_title,join_date,employment_type,department from staff where id=${input.staff_id} for update`;
        if(!before)throw new Error("NOT_FOUND");
        const next={phone:input.phone??null,date_of_birth:input.date_of_birth??null,address_line1:input.address_line1??null,city:input.city??null,state:input.state??null,postal_code:input.postal_code??null,qualification:input.qualification??null,job_title:input.job_title??null,join_date:input.join_date??null,employment_type:input.employment_type??null,department:input.department??null};
        await tx`update staff set ${tx(next)} where id=${input.staff_id}`;
        await audit(tx,session.staff.id,traceId,"staff_profile_updated","staff",input.staff_id,before,next);
        return{changed:true};
      }

      if(input.operation==="create_asset"){
        const [row]=await tx`insert into assets(asset_code,asset_type,ownership,brand,model,serial_number,condition,note,created_by)
          values(${input.asset_code},${input.asset_type},${input.ownership},${input.brand??null},${input.model??null},${input.serial_number??null},${input.condition},${input.note??null},${session.staff.id}) returning id`;
        await audit(tx,session.staff.id,traceId,"asset_created","asset",row.id,null,{asset_code:input.asset_code,asset_type:input.asset_type,ownership:input.ownership});
        return{asset_id:row.id};
      }

      if(input.operation==="assign_asset"){
        const [asset]=await tx`select id,status,condition from assets where id=${input.asset_id} for update`;
        if(!asset)throw new Error("NOT_FOUND");
        if(!["available","returned"].includes(asset.status))throw new Error("ASSET_UNAVAILABLE");
        const [staff]=await tx`select id from staff where id=${input.staff_id} and active`;
        if(!staff)throw new Error("STAFF_NOT_FOUND");
        const [row]=await tx`insert into asset_assignments(asset_id,staff_id,issued_at,issued_by,issue_condition,return_due_at,status,note)
          values(${input.asset_id},${input.staff_id},now(),${session.staff.id},${input.issue_condition??asset.condition},${input.return_due_at??null},'in_use',${input.note??null}) returning id`;
        await audit(tx,session.staff.id,traceId,"asset_assigned","asset_assignment",row.id,null,{asset_id:input.asset_id,staff_id:input.staff_id,return_due_at:input.return_due_at??null});
        return{assignment_id:row.id};
      }

      if(input.operation==="return_asset"){
        const [before]=await tx`select id,asset_id,staff_id,status from asset_assignments where id=${input.assignment_id} for update`;
        if(!before)throw new Error("NOT_FOUND");
        if(before.status==="returned")return{changed:false};
        await tx`update asset_assignments set status='returned',returned_at=now(),returned_by=${session.staff.id},return_condition=${input.return_condition},note=coalesce(${input.note??null},note),updated_at=now() where id=${input.assignment_id}`;
        await audit(tx,session.staff.id,traceId,"asset_returned","asset_assignment",input.assignment_id,{status:before.status},{status:"returned",return_condition:input.return_condition});
        return{changed:true};
      }

      if(input.operation==="clone_workflow"){
        const [row]=await tx`select public.clone_workflow_version(${input.label},${input.note??null}) id`;
        await audit(tx,session.staff.id,traceId,"workflow_draft_created","workflow_version",row.id,null,{label:input.label});
        return{version_id:row.id};
      }

      const [version]=await tx`select id,status,version_no from workflow_versions where id=${input.version_id} for update`;
      if(!version)throw new Error("NOT_FOUND");
      if(version.status!=="draft"&&input.operation!=="publish_workflow")throw new Error("WORKFLOW_NOT_DRAFT");

      if(input.operation==="update_workflow_rule"){
        const [before]=await tx`select * from workflow_version_status_rules where version_id=${input.version_id} and status=${input.status}`;
        await tx`insert into workflow_version_status_rules(version_id,status,label_en,default_next_action,sequence,terminal,active)
          values(${input.version_id},${input.status},${input.label_en},${input.default_next_action},${input.sequence},${input.terminal},${input.active})
          on conflict(version_id,status) do update set label_en=excluded.label_en,default_next_action=excluded.default_next_action,sequence=excluded.sequence,terminal=excluded.terminal,active=excluded.active`;
        await audit(tx,session.staff.id,traceId,"workflow_draft_updated","workflow_version",input.version_id,before??null,{status:input.status,label_en:input.label_en,default_next_action:input.default_next_action,sequence:input.sequence,terminal:input.terminal,active:input.active});
        return{changed:true};
      }

      if(input.operation==="set_workflow_transition"){
        if(input.enabled)await tx`insert into workflow_version_transitions(version_id,from_status,to_status) values(${input.version_id},${input.from_status},${input.to_status}) on conflict do nothing`;
        else await tx`delete from workflow_version_transitions where version_id=${input.version_id} and from_status=${input.from_status} and to_status=${input.to_status}`;
        await audit(tx,session.staff.id,traceId,"workflow_draft_updated","workflow_version",input.version_id,null,{transition:[input.from_status,input.to_status],enabled:input.enabled});
        return{changed:true};
      }

      if(input.operation==="set_workflow_entry"){
        if(input.enabled)await tx`insert into workflow_version_entry_states(version_id,status) values(${input.version_id},${input.status}) on conflict do nothing`;
        else await tx`delete from workflow_version_entry_states where version_id=${input.version_id} and status=${input.status}`;
        await audit(tx,session.staff.id,traceId,"workflow_draft_updated","workflow_version",input.version_id,null,{entry_status:input.status,enabled:input.enabled});
        return{changed:true};
      }

      const [validation]=await tx`select public.publish_workflow_version(${input.version_id}) result`;
      await audit(tx,session.staff.id,traceId,"workflow_published","workflow_version",input.version_id,{status:version.status},{status:"published",validation:validation.result});
      return validation.result;
    });
    return ok(result,200,traceId);
  }catch(e){
    const m=e instanceof Error?e.message:"admin_operation_failed";
    if(m==="NOT_FOUND")return err("not_found","Resource not found",404,traceId);
    if(m==="ADMIN_PERMISSION_LOCKOUT")return err("forbidden","The admin permission-control rule cannot disable itself",409,traceId);
    if(m==="ASSET_UNAVAILABLE")return err("asset_unavailable","Asset is not available for assignment",409,traceId);
    if(m==="STAFF_NOT_FOUND")return err("staff_not_found","Active staff member not found",404,traceId);
    if(m==="WORKFLOW_NOT_DRAFT")return err("workflow_not_draft","Only a draft workflow can be edited",409,traceId);
    return err("admin_operation_failed",m,409,traceId);
  }
}
