import { z } from "zod";
import { withStaff } from "@/lib/auth";
import { permissionFor, type ActionName } from "@/lib/authz";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime="nodejs";
const id=z.uuid();
const money=z.number().finite().min(0).max(1_000_000);
const Conditions=z.object({require_account_paid:z.boolean().optional(),required_client_status:z.string().trim().max(80).optional(),require_no_open_tasks:z.boolean().optional()}).strict();
const Input=z.discriminatedUnion("operation",[
  z.object({operation:z.literal("set_staff_eligibility"),staff_id:id,eligible:z.boolean()}),
  z.object({operation:z.literal("create_rule"),rule_key:z.string().trim().min(1).max(120),commission_type:z.enum(["fixed","percent"]),commission_value:money,trigger_event:z.enum(["client.completed","payment.satisfied"]),basis:z.enum(["total_charged","total_paid"]),approval_required:z.boolean(),conditions:Conditions,eligible_roles:z.array(z.enum(["admin","manager","staff"])).max(3),eligible_staff:z.array(id).max(100)}),
  z.object({operation:z.literal("activate_rule"),rule_id:id}),
  z.object({operation:z.literal("evaluate_client"),client_id:id}),
  z.object({operation:z.literal("approve_commission"),commission_id:id}),
  z.object({operation:z.literal("mark_commission_paid"),commission_id:id,payment_reference:z.string().trim().min(1).max(200)}),
  z.object({operation:z.literal("cancel_commission"),commission_id:id,reason:z.string().trim().min(1).max(500)}),
]);
type In=z.infer<typeof Input>;
function action(i:In):ActionName{
  if(i.operation==="set_staff_eligibility"||i.operation==="create_rule"||i.operation==="activate_rule")return "manage_commission_rules";
  if(i.operation==="evaluate_client")return "evaluate_commission";
  if(i.operation==="approve_commission")return "approve_commission";
  if(i.operation==="mark_commission_paid")return "mark_commission_paid";
  return "cancel_commission";
}
async function audit(tx:Parameters<Parameters<typeof withStaff>[1]>[0],clientId:string|null,staffId:string,traceId:string,act:string,entityType:string,entityId:string|null,oldValue:unknown,newValue:unknown){
  await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
           values(${clientId},${act},${staffId},${entityType},${entityId},${oldValue===undefined?null:tx.json(oldValue as never)},${newValue===undefined?null:tx.json(newValue as never)},${traceId})`;
}

export async function POST(req:Request){
  const traceId=traceIdFrom(req);
  const guard=await staffGuard(req,traceId,{mutation:true});
  if(guard.response)return guard.response;
  const parsed=Input.safeParse(await req.json().catch(()=>null));
  if(!parsed.success)return err("invalid_input",parsed.error.issues[0]?.message??"Invalid commission operation",400,traceId);
  const input=parsed.data;const session=guard.session;
  const p=await permissionFor(session.staff.role,action(input));
  if(!p.allowed)return err("forbidden","Your role does not allow this commission action",403,traceId);

  try{
    const result=await withStaff(session,async(tx)=>{
      if(input.operation==="set_staff_eligibility"){
        const [before]=await tx`select id,commission_eligible from staff where id=${input.staff_id} for update`;
        if(!before)throw new Error("STAFF_NOT_FOUND");
        await tx`update staff set commission_eligible=${input.eligible} where id=${input.staff_id}`;
        await audit(tx,null,session.staff.id,traceId,"staff_profile_updated","staff",input.staff_id,{commission_eligible:before.commission_eligible},{commission_eligible:input.eligible});
        return{changed:Boolean(before.commission_eligible)!==input.eligible};
      }
      if(input.operation==="create_rule"){
        if(input.commission_type==="percent"&&input.commission_value>100)throw new Error("INVALID_PERCENT");
        await tx`lock table commission_rules in share row exclusive mode`;
        const [{version}]=await tx`select coalesce(max(version),0)::int+1 version from commission_rules where rule_key=${input.rule_key}`;
        const [row]=await tx`insert into commission_rules(rule_key,version,status,commission_type,commission_value,trigger_event,basis,conditions,eligible_roles,eligible_staff,approval_required,created_by)
          values(${input.rule_key},${version},'draft',${input.commission_type},${input.commission_value},${input.trigger_event},${input.basis},${tx.json(input.conditions as never)},${input.eligible_roles},${input.eligible_staff},${input.approval_required},${session.staff.id}) returning id,version`;
        await audit(tx,null,session.staff.id,traceId,"commission_created","commission_rule",row.id,null,{rule_key:input.rule_key,version:row.version,status:"draft"});
        return{rule_id:row.id,version:row.version};
      }
      if(input.operation==="activate_rule"){
        const [rule]=await tx`select * from commission_rules where id=${input.rule_id} for update`;
        if(!rule)throw new Error("RULE_NOT_FOUND");
        if(rule.status==="active")return{changed:false};
        if(rule.status!=="draft")throw new Error("RULE_NOT_DRAFT");
        await tx`update commission_rules set status='retired',updated_at=now(),effective_to=coalesce(effective_to,now()) where rule_key=${rule.rule_key} and status='active'`;
        await tx`update commission_rules set status='active',updated_at=now(),effective_from=coalesce(effective_from,now()),effective_to=null where id=${input.rule_id}`;
        await audit(tx,null,session.staff.id,traceId,"commission_status_changed","commission_rule",input.rule_id,{status:rule.status},{status:"active",rule_key:rule.rule_key,version:rule.version});
        return{changed:true};
      }
      if(input.operation==="evaluate_client"){
        const [client]=await tx`select id from clients where id=${input.client_id} and deleted_at is null`;
        if(!client)throw new Error("CLIENT_NOT_FOUND");
        const [row]=await tx`select public.evaluate_client_commissions_manual(${input.client_id}) result`;
        return row.result;
      }
      const [cm]=await tx`select id,client_id,status,amount,employee_id from commissions where id=${input.commission_id} for update`;
      if(!cm)throw new Error("COMMISSION_NOT_FOUND");
      if(input.operation==="approve_commission"){
        if(cm.status==="approved")return{changed:false};
        if(cm.status!=="eligible")throw new Error("INVALID_COMMISSION_STATE");
        await tx`update commissions set status='approved',approved_by=${session.staff.id},approved_at=now(),updated_at=now() where id=${input.commission_id}`;
        await audit(tx,cm.client_id,session.staff.id,traceId,"commission_status_changed","commission",input.commission_id,{status:cm.status},{status:"approved",amount:Number(cm.amount)});
        return{changed:true};
      }
      if(input.operation==="mark_commission_paid"){
        if(cm.status==="paid")return{changed:false};
        if(!["approved","eligible"].includes(cm.status))throw new Error("INVALID_COMMISSION_STATE");
        await tx`update commissions set status='paid',approved_by=coalesce(approved_by,${session.staff.id}),approved_at=coalesce(approved_at,now()),paid_at=now(),payment_reference=${input.payment_reference},updated_at=now() where id=${input.commission_id}`;
        await audit(tx,cm.client_id,session.staff.id,traceId,"commission_status_changed","commission",input.commission_id,{status:cm.status},{status:"paid",payment_reference:input.payment_reference,amount:Number(cm.amount)});
        return{changed:true};
      }
      if(cm.status==="paid")throw new Error("PAID_COMMISSION_IMMUTABLE");
      if(["cancelled","reversed"].includes(cm.status))return{changed:false};
      await tx`update commissions set status='cancelled',cancelled_by=${session.staff.id},cancelled_at=now(),cancel_reason=${input.reason},updated_at=now() where id=${input.commission_id}`;
      await audit(tx,cm.client_id,session.staff.id,traceId,"commission_status_changed","commission",input.commission_id,{status:cm.status},{status:"cancelled",reason:input.reason});
      return{changed:true};
    });
    return ok(result,200,traceId);
  }catch(e){
    const m=e instanceof Error?e.message:"commission_operation_failed";
    if(m==="STAFF_NOT_FOUND")return err("staff_not_found","Staff member not found",404,traceId);
    if(m==="RULE_NOT_FOUND")return err("rule_not_found","Commission rule not found",404,traceId);
    if(m==="COMMISSION_NOT_FOUND")return err("commission_not_found","Commission not found",404,traceId);
    if(m==="CLIENT_NOT_FOUND")return err("client_not_found","Client not found",404,traceId);
    if(m==="INVALID_PERCENT")return err("invalid_percent","Percentage commission cannot exceed 100",400,traceId);
    if(m==="RULE_NOT_DRAFT")return err("rule_not_draft","Only a draft rule can be activated",409,traceId);
    if(m==="INVALID_COMMISSION_STATE")return err("invalid_commission_state","Commission is not in a valid state for this action",409,traceId);
    if(m==="PAID_COMMISSION_IMMUTABLE")return err("paid_commission_immutable","A paid commission cannot be cancelled; use a controlled reversal",409,traceId);
    return err("commission_operation_failed",m,409,traceId);
  }
}
