import { z } from "zod";
import { withStaff } from "@/lib/auth";
import { permissionAllows } from "@/lib/authz";
import { dbErrorResponse, err, ok } from "@/lib/http";
import { submitClientReview } from "@/lib/manager-inbox";
import { traceIdFrom } from "@/lib/obs";
import { ActionError } from "@/lib/service";
import { staffGuard } from "@/lib/staff-api";
import { staffOperation } from "@/lib/staff-operation";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const Input=z.discriminatedUnion("operation",[
 z.object({operation:z.literal("urgent"),client_id:z.uuid(),urgent:z.boolean(),operation_id:z.uuid(),expected_updated_at:z.string().max(100).optional()}),
 z.object({operation:z.literal("duplicate_review"),client_id:z.uuid(),related_client_id:z.uuid(),note:z.string().trim().max(4000).default(""),operation_id:z.uuid()}),
]);
function response(r:Response){r.headers.set("Cache-Control","private, no-store");return r;}
function failure(e:unknown,t:string){if(e instanceof ActionError)return err(e.code,e.message,e.status,t);if(e&&typeof e==='object'&&'message' in e&&String(e.message).includes('manager_review_pending'))return err('manager_review_pending','This file is awaiting a manager decision',409,t);return dbErrorResponse(e,t);}
export async function GET(req:Request){
 const trace=traceIdFrom(req),guard=await staffGuard(req,trace,{mutation:false});if(guard.response)return response(guard.response);
 try{return response(await withStaff(guard.session,async tx=>{
  const params=new URL(req.url).searchParams,op=params.get('operation_id');
  if(op){if(!z.uuid().safeParse(op).success)return err('invalid_input','Invalid operation identifier',400,trace);const [stored]=await tx`select result from staff_operations where staff_id=${guard.session.staff.id} and operation_id=${op}`;return ok({result:stored?.result??null},200,trace);}
  const id=params.get('client_id');if(!z.uuid().safeParse(id).success)return err('invalid_input','Choose a client',400,trace);
  const [client]=await tx`select id,ref,full_name,phone,current_status,updated_at::text updated_at,is_urgent,manager_review_id,operational_location from clients where id=${id!} and deleted_at is null`;
  if(!client)return err('not_found','Client unavailable',404,trace);
  // Shared phones and abbreviated names are review suggestions, never identity decisions.
  const duplicates=await tx`select c.id,c.ref,c.full_name,c.phone,s.display_name assigned_name from clients c left join staff s on s.id=c.assigned_staff
    where c.id<>${id!} and c.deleted_at is null and nullif(regexp_replace(c.phone,'[^0-9]','','g'),'') is not null
    and regexp_replace(c.phone,'[^0-9]','','g')=regexp_replace(${String(client.phone)},'[^0-9]','','g')
    and (lower(trim(c.full_name))=lower(trim(${String(client.full_name)}))
      or (split_part(lower(trim(c.full_name)),' ',1)=split_part(lower(trim(${String(client.full_name)})),' ',1)
      and regexp_replace(lower(trim(c.full_name)),'^.*\\s','')=regexp_replace(lower(trim(${String(client.full_name)})),'^.*\\s','')))
    order by c.created_at,c.id limit 20`;
  return ok({client,duplicates},200,trace);
 }));}catch(e){return response(failure(e,trace));}
}
export async function POST(req:Request){
 const trace=traceIdFrom(req),guard=await staffGuard(req,trace,{mutation:true});if(guard.response)return response(guard.response);
 const parsed=Input.safeParse(await req.json().catch(()=>null));if(!parsed.success)return response(err('invalid_input','Invalid dispatch request',400,trace));
 try{const input=parsed.data;if(input.operation==='duplicate_review'&&!(await permissionAllows(guard.session,'add_task')))throw new ActionError('forbidden','Review task permission required',403);
  const result=await withStaff(guard.session,tx=>staffOperation(tx,guard.session,input.operation_id,'client_dispatch',input,async()=>{
   if(input.operation==='duplicate_review')return submitClientReview(tx,guard.session,{...input,request_key:input.operation_id},trace);
   const [client]=await tx`select id,is_urgent,manager_review_id,operational_location,updated_at::text updated_at from clients where id=${input.client_id} and deleted_at is null for update`;
   if(!client)throw new ActionError('not_found','Client unavailable or not assigned to you',404);
   if(client.manager_review_id)throw new ActionError('manager_review_pending','This file is awaiting a manager decision',409);
   if(['completed','cancelled'].includes(String(client.operational_location)))throw new ActionError('closed_case','Move the file to an active workflow section before marking it Urgent',409);
   if(input.expected_updated_at&&input.expected_updated_at!==client.updated_at)throw new ActionError('client_changed','This file changed. Refresh before moving it.',409);
   if(client.is_urgent!==input.urgent){await tx`update clients set is_urgent=${input.urgent} where id=${input.client_id}`;
    await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
     values(${input.client_id},'client_updated',${guard.session.staff.id},'client',${input.client_id},${tx.json({is_urgent:client.is_urgent,operational_location:client.operational_location})},${tx.json({operation:'client_dispatch',is_urgent:input.urgent})},${trace})`;}
   const [next]=await tx`select id,is_urgent,manager_review_id,operational_location,updated_at::text updated_at from clients where id=${input.client_id}`;
   return {client:next,changed:client.is_urgent!==input.urgent};
  }));return response(ok(result,200,trace));
 }catch(e){return response(failure(e,trace));}
}
