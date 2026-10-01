import "server-only";
import type { Status } from "@/lib/domain";
import type { Tx } from "@/lib/service";

export type WorkflowStatusRule={status:Status;label:string;default_next_action:string;sequence:number;terminal:boolean};

export async function workflowRules(tx:Tx):Promise<WorkflowStatusRule[]>{
  const rows=await tx`select status,label_en,default_next_action,sequence,terminal from workflow_status_rules where active order by sequence`;
  return rows.map(r=>({status:String(r.status) as Status,label:String(r.label_en),default_next_action:String(r.default_next_action),sequence:Number(r.sequence),terminal:Boolean(r.terminal)}));
}

export async function allowedTransitions(tx:Tx,from:Status):Promise<WorkflowStatusRule[]>{
  const rows=await tx`
    select r.status,r.label_en,r.default_next_action,r.sequence,r.terminal
      from status_transitions t
      join workflow_status_rules r on r.status=t.to_status and r.active
     where t.from_status=${from}
     order by r.sequence`;
  return rows.map(r=>({status:String(r.status) as Status,label:String(r.label_en),default_next_action:String(r.default_next_action),sequence:Number(r.sequence),terminal:Boolean(r.terminal)}));
}

export async function isEntryStatus(tx:Tx,status:Status){
  const [row]=await tx`select exists(select 1 from status_entry_states where status=${status}) ok`;
  return Boolean(row?.ok);
}

export async function isAllowedTransition(tx:Tx,from:Status,to:Status){
  const [row]=await tx`select exists(select 1 from status_transitions where from_status=${from} and to_status=${to}) ok`;
  return Boolean(row?.ok);
}
