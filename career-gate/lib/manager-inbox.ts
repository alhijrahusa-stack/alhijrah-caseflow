import "server-only";
import { withStaff, type StaffSession, type Tx } from "@/lib/auth";
import { permissionAllows } from "@/lib/authz";
import { CLIENT_STAGES, type ClientStageFilter } from "@/lib/client-lifecycle-filters";
import { moveWorkflowClient } from "@/lib/manual-workflow";
import { reportIntelligence, type ReportPeriod } from "@/lib/reports";
import { ActionError } from "@/lib/service";
import { staffOperation } from "@/lib/staff-operation";
import { archiveClient } from "@/lib/client-archive";

export type ManagerSummary={smart_client:number;clients:number;urgent:number;awaiting_review:number};
export type ManagerInboxItem={id:string;kind:"client"|"report";client_id:string|null;title:string;submitted_note:string;source_path:string;snapshot:Record<string,unknown>;submitted_by:string;sender_name:string;submitted_at:string;full_name:string|null;ref:string|null;current_status:string|null;client_version:string|null;request_type:"review"|"duplicate";related_client_id:string|null;related_client?:{id:string;ref:string;full_name:string;phone:string;current_status:string;client_version:string}|null;is_urgent:boolean;operational_location:string;resolved_by_name:string|null;resolved_at:string|null;resolution_note:string|null;resolution_action:"approve"|"return"|"delete"|"not_duplicate";original_location:string|null;status:"open"|"resolved"};
export type ManagerInboxPage={items:ManagerInboxItem[];total:number;page:number;pages:number;summary:ManagerSummary;senders:{id:string;display_name:string}[]};
export type ManagerInboxFilters={status?:string;kind?:string;request_type?:string;urgent?:boolean;sender?:string;q?:string;sort?:string};
export type SubmitManagerReview=({kind:"client";client_id:string;note:string;request_key:string;related_client_id?:string}|{kind:"report";period:ReportPeriod;note:string;request_key:string});
export type ResolveManagerReview={id:string;destination:ClientStageFilter|"keep_current";note:string;expected_client_version?:string|null;expected_related_client_version?:string;operation_id?:string;assigned_staff_id?:string|null;action?:"approve"|"return"|"delete"|"not_duplicate";delete_client_id?:string;delete_reason?:string};
function requireManagement(s:StaffSession){if(!['admin','manager'].includes(s.staff.role))throw new ActionError('forbidden','Manager Task Center requires manager or admin access',403);}

export async function managerInbox(s:StaffSession,requestedPage=1,filters:ManagerInboxFilters={}):Promise<ManagerInboxPage>{
 requireManagement(s);
 return withStaff(s,async tx=>{
  const status=filters.status==='resolved'?'resolved':'open';
  const term=(filters.q??'').trim().slice(0,100);const like=`%${term.replace(/[\\%_]/g,m=>`\\${m}`)}%`;
  const where=tx`i.status=${status}
    ${filters.kind==='client'||filters.kind==='report'?tx`and i.kind=${filters.kind}`:tx``}
    ${filters.request_type==='duplicate'||filters.request_type==='review'?tx`and i.request_type=${filters.request_type}`:tx``}
    ${filters.urgent?tx`and c.is_urgent`:tx``}
    ${filters.sender?tx`and i.submitted_by=${filters.sender}`:tx``}
    ${term?tx`and (i.title ilike ${like} or c.ref ilike ${like} or c.phone ilike ${like} or c.full_name ilike ${like} or i.submitted_note ilike ${like})`:tx``}`;
  const [count]=await tx`select count(*)::int total from manager_inbox i left join clients c on c.id=i.client_id where ${where}`;
  const total=Number(count.total),pages=Math.max(1,Math.ceil(total/10));const page=Math.min(pages,Math.max(1,Number.isFinite(requestedPage)?Math.floor(requestedPage):1));
  const items=await tx`select i.*,s.display_name sender_name,c.full_name,c.ref,c.current_status,c.updated_at::text client_version,
    coalesce(c.is_urgent,false) is_urgent,c.operational_location,coalesce(i.resolved_by_name_snapshot,r.display_name) resolved_by_name,
    case when related.id is null then null else jsonb_build_object('id',related.id,'ref',related.ref,'full_name',related.full_name,'phone',related.phone,'current_status',related.current_status,'client_version',related.updated_at::text) end related_client,
    i.submitted_at::text submitted_at,i.resolved_at::text resolved_at
    from manager_inbox i join staff s on s.id=i.submitted_by left join clients c on c.id=i.client_id
    left join clients related on related.id=i.related_client_id left join staff r on r.id=i.resolved_by
    where ${where} order by ${filters.sort==='priority'?tx`coalesce(c.is_urgent,false) desc,`:tx``}
      i.submitted_at ${filters.sort==='newest'?tx`desc`:tx`asc`},i.id limit 10 offset ${(page-1)*10}`;
  const [summary]=await tx`select
    career_gate_private.active_smart_client_count() smart_client,
    (select count(*)::int from clients where operational_location in ('new_intake','account_setup','job_ready','appointments','payment_required','paperwork_pending')) clients,
    (select count(*)::int from clients where operational_location='urgent') urgent,
    (select count(*)::int from manager_inbox where status='open') awaiting_review`;
  const senders=await tx`select distinct s.id,s.display_name from manager_inbox i join staff s on s.id=i.submitted_by order by s.display_name`;
  return {items:items as unknown as ManagerInboxItem[],total,page,pages,summary:summary as ManagerSummary,senders:senders as unknown as {id:string;display_name:string}[]};
 });
}

export async function submitClientReview(tx:Tx,s:StaffSession,input:{client_id:string;related_client_id?:string;note:string;request_key:string},traceId:string){
 const ids=[...new Set([input.client_id,...(input.related_client_id?[input.related_client_id]:[])])].sort();
 if(input.related_client_id===input.client_id)throw new ActionError('invalid_input','Choose two different records',400);
 const rows=await tx`select id,ref,full_name,current_status,operational_location,manager_review_id from clients where id=any(${ids}) and deleted_at is null order by id for update`;
 if(rows.length!==ids.length)throw new ActionError('not_found','Client is unavailable or not assigned to you',404);
 const client=rows.find(c=>c.id===input.client_id)!;
 if(rows.some(c=>c.manager_review_id)){
  const held=rows.find(c=>c.manager_review_id)!;
  if(rows.every(c=>c.manager_review_id===held.manager_review_id)){
   const [existing]=await tx`select client_id,related_client_id from manager_inbox where id=${held.manager_review_id} and status='open'`;
   if(existing && (!input.related_client_id || [existing.client_id,existing.related_client_id].filter(Boolean).sort().join(',')===ids.join(',')))return {id:String(held.manager_review_id),review_id:String(held.manager_review_id),created:false};
  }
  throw new ActionError('review_conflict','These records already have separate pending reviews',409);
 }
 const [inserted]=await tx`insert into manager_inbox(request_key,kind,client_id,related_client_id,request_type,original_location,title,submitted_note,source_path,snapshot,submitted_by)
   values(${input.request_key},'client',${input.client_id},${input.related_client_id??null},${input.related_client_id?'duplicate':'review'},${client.operational_location},
   ${`${client.ref} · ${client.full_name}`.slice(0,200)},${input.note},${`/staff/client/${input.client_id}`},
   ${tx.json({ref:client.ref,full_name:client.full_name,current_status:client.current_status})},${s.staff.id}) on conflict do nothing returning id`;
 if(!inserted)throw new ActionError('conflict','This review was already processed; refresh the file',409);
 for(const row of rows)await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,new_value,trace_id)
   values(${row.id},'client_updated',${s.staff.id},'manager_review',${inserted.id},${tx.json({operation:'manager_review_requested',request_id:inserted.id,note:input.note})},${traceId})`;
 return {id:String(inserted.id),review_id:String(inserted.id),created:true};
}
export async function submitManagerReview(s:StaffSession,input:SubmitManagerReview,traceId:string){
 if(input.kind==='report')requireManagement(s);else if(!(await permissionAllows(s,'add_task')))throw new ActionError('forbidden','Your current permissions do not allow review tasks',403);
 const report=input.kind==='report'?await reportIntelligence(s,input.period):null;
 return withStaff(s,tx=>staffOperation(tx,s,input.request_key,'manager_review_submit',input,async()=>{
  if(input.kind==='client')return submitClientReview(tx,s,input,traceId);
  const source=`/staff/reports?period=${input.period}`;
  const [row]=await tx`insert into manager_inbox(request_key,kind,title,submitted_note,source_path,snapshot,submitted_by)
    values(${input.request_key},'report',${`Operations report · ${input.period} days`},${input.note},${source},
    ${tx.json({period:input.period,generated_at:new Date().toISOString(),kpis:report!.kpis,insights:report!.insights,funnel:report!.funnel} as never)},${s.staff.id}) on conflict do nothing returning id`;
  if(row)return {id:String(row.id),created:true};
  const [existing]=await tx`select id from manager_inbox where status='open' and submitted_by=${s.staff.id} and source_path=${source}`;
  if(existing)return {id:String(existing.id),created:false};throw new ActionError('conflict','This review was already processed',409);
 }));
}

export async function resolveManagerReview(s:StaffSession,input:ResolveManagerReview,traceId:string){
 requireManagement(s);
 return withStaff(s,tx=>staffOperation(tx,s,input.operation_id,'manager_review_resolve',input,async()=>{
  const [item]=await tx`select * from manager_inbox where id=${input.id} for update`;
  if(!item)throw new ActionError('not_found','Review request is unavailable',404);
  if(item.status!=='open')return {id:input.id,already_resolved:true,client_id:item.client_id as string|null,task_id:item.routed_task_id as string|null};
  await tx`select career_gate_private.prepare_manager_resolution(${input.id},${input.expected_client_version??null},${input.expected_related_client_version??null})`;
  const action=input.action??'approve';if(action==='not_duplicate'&&item.request_type!=='duplicate')throw new ActionError('invalid_decision','This request is not a duplicate review',400);let taskId:string|null=null;
  const ids=[item.client_id,item.related_client_id].filter(Boolean).map(String).sort();
  const clients=ids.length?await tx`select id,current_status,pipeline_stage,next_step,is_urgent,manager_review_id,assigned_staff,updated_at::text client_version from clients where id=any(${ids}) and deleted_at is null order by id for update`:[];
  if(item.client_id){
   const client=clients.find(c=>c.id===item.client_id);
   if(!client)throw new ActionError('not_found','Client is no longer available',404);
   if(!input.expected_client_version||client.client_version!==input.expected_client_version)throw new ActionError('client_changed','The file changed. Review the latest data before deciding.',409);
   if(item.related_client_id){const related=clients.find(c=>c.id===item.related_client_id);if(!related||!input.expected_related_client_version||related.client_version!==input.expected_related_client_version)throw new ActionError('client_changed','The comparison file changed. Review the latest data before deciding.',409);}
   if(input.assigned_staff_id){const [member]=await tx`select id from staff where id=${input.assigned_staff_id} and active`;if(!member)throw new ActionError('staff_not_found','Active staff member not found',404);}
   if(action==='delete'&&(!input.delete_reason?.trim()||!ids.includes(input.delete_client_id??'')))throw new ActionError('invalid_delete','Choose the record and provide a deletion reason',400);
   // Resolving first releases both held records inside this same transaction;
   // any subsequent failure rolls the decision and release back together.
   await tx`update manager_inbox set status='resolved',destination=${input.destination},resolution_note=${input.note},resolution_action=${action},resolved_by=${s.staff.id},resolved_at=now() where id=${input.id}`;
   for(const row of clients){
    if(action==='delete'&&row.id===input.delete_client_id){await archiveClient(tx,s,String(row.id),input.delete_reason!,traceId);continue;}
    if(action!=='return'&&input.destination!=='keep_current')await moveWorkflowClient(tx,s,row as {id:string;current_status:string;pipeline_stage:string;next_step:string},input.destination,input.note,traceId,{operation:'manager_review_routed',request_id:input.id});
    if(input.assigned_staff_id!==undefined && row.assigned_staff!==input.assigned_staff_id){
     await tx`update clients set assigned_staff=${input.assigned_staff_id} where id=${row.id}`;
     await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
       values(${row.id},'staff_reassigned',${s.staff.id},'client',${row.id},${tx.json({assigned_staff:row.assigned_staff})},${tx.json({assigned_staff:input.assigned_staff_id,request_id:input.id})},${traceId})`;
    }
    if(input.note)await tx`insert into notes(client_id,note,staff_id) values(${row.id},${input.note},${s.staff.id})`;
    await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,new_value,trace_id)
      values(${row.id},'client_updated',${s.staff.id},'manager_review',${input.id},${tx.json({operation:'manager_review_resolved',destination:input.destination,action,note:input.note})},${traceId})`;
   }
  }else{
   if(action==='delete')throw new ActionError('invalid_delete','Reports cannot delete a client',400);
   if(input.destination!=='keep_current'&&action!=='return'){
    const destination=CLIENT_STAGES.find(v=>v.id===input.destination)!.label;
    const [task]=await tx`insert into tasks(title,description,assigned_to,created_by) values(${`${destination} · ${item.title}`.slice(0,200)},${`Manager review: ${input.id}\nWorkflow destination: ${destination}\nSource: ${item.source_path}`},${input.assigned_staff_id??item.submitted_by},${s.staff.id}) returning id`;taskId=String(task.id);
   }
   await tx`update manager_inbox set status='resolved',destination=${input.destination},resolution_note=${input.note},resolution_action=${action},resolved_by=${s.staff.id},resolved_at=now(),routed_task_id=${taskId} where id=${input.id}`;
  }
  return {id:input.id,already_resolved:false,client_id:item.client_id as string|null,task_id:taskId};
 }));
}
