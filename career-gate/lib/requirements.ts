import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";

export type ClientRequirement={
  id:string; requirement_key:string; stage:string|null; title:string; reason:string|null; source:string;
  status:"complete"|"missing"|"pending_review"|"rejected"|"expired"|"not_applicable";
  related_document_id:string|null; related_task_id:string|null; due_at:string|null; completed_at:string|null;
};
export type ClientReadiness={
  required_count:number; complete_count:number; missing_count:number; pending_review_count:number; readiness_percent:number|null;
};

export async function clientRequirements(session:StaffSession,clientId:string){
  return withStaff(session,async(tx)=>{
    const rows=await tx`
      select id,requirement_key,stage,title,reason,source,status,related_document_id,related_task_id,due_at,completed_at
        from client_requirements
       where client_id=${clientId}
       order by case status when 'rejected' then 0 when 'expired' then 1 when 'missing' then 2 when 'pending_review' then 3 when 'complete' then 4 else 5 end,
                due_at nulls last,created_at`;
    const [ready]=await tx`
      select required_count,complete_count,missing_count,pending_review_count,readiness_percent
        from client_readiness where client_id=${clientId}`;
    const requirements:ClientRequirement[]=rows.map(r=>({
      id:String(r.id),requirement_key:String(r.requirement_key),stage:r.stage==null?null:String(r.stage),title:String(r.title),reason:r.reason==null?null:String(r.reason),source:String(r.source),status:String(r.status) as ClientRequirement["status"],related_document_id:r.related_document_id==null?null:String(r.related_document_id),related_task_id:r.related_task_id==null?null:String(r.related_task_id),due_at:r.due_at==null?null:String(r.due_at),completed_at:r.completed_at==null?null:String(r.completed_at),
    }));
    const readiness:ClientReadiness=ready?{
      required_count:Number(ready.required_count),complete_count:Number(ready.complete_count),missing_count:Number(ready.missing_count),pending_review_count:Number(ready.pending_review_count),readiness_percent:ready.readiness_percent==null?null:Number(ready.readiness_percent),
    }:{required_count:0,complete_count:0,missing_count:0,pending_review_count:0,readiness_percent:null};
    return{requirements,readiness};
  });
}
