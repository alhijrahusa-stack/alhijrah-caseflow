import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";

export type CommissionRuleRow={id:string;rule_key:string;version:number;status:"draft"|"active"|"retired";commission_type:"fixed"|"percent";commission_value:number;trigger_event:string;basis:"total_charged"|"total_paid";conditions:Record<string,unknown>;eligible_roles:string[];eligible_staff:string[];approval_required:boolean;effective_from:string|null;effective_to:string|null;created_at:string};
export type CommissionRow={id:string;client_id:string;client_ref:string;client_name:string;employee_id:string;employee_name:string;staff_code:string|null;rule_id:string;rule_key:string;rule_version:number;trigger_event:string;trigger_event_id:string;basis_amount:number;amount:number;status:"pending"|"eligible"|"approved"|"paid"|"cancelled"|"reversed";eligible_at:string|null;approved_at:string|null;paid_at:string|null;payment_reference:string|null;cancel_reason:string|null;created_at:string};

const s=(v:unknown)=>String(v);const ns=(v:unknown)=>v==null?null:String(v);const b=(v:unknown)=>Boolean(v);

export async function commissionData(session:StaffSession){
  return withStaff(session,async(tx)=>{
    const rules=await tx`
      select id,rule_key,version,status,commission_type,commission_value,trigger_event,basis,conditions,eligible_roles,eligible_staff,approval_required,effective_from,effective_to,created_at
        from commission_rules
       order by rule_key,version desc`;
    const commissions=await tx`
      select cm.id,cm.client_id,c.ref client_ref,c.full_name client_name,cm.employee_id,s.display_name employee_name,s.staff_code,
             cm.rule_id,r.rule_key,r.version rule_version,cm.trigger_event,cm.trigger_event_id,cm.basis_amount,cm.amount,cm.status,
             cm.eligible_at,cm.approved_at,cm.paid_at,cm.payment_reference,cm.cancel_reason,cm.created_at
        from commissions cm
        join clients c on c.id=cm.client_id
        join staff s on s.id=cm.employee_id
        join commission_rules r on r.id=cm.rule_id
       order by case cm.status when 'eligible' then 0 when 'approved' then 1 when 'pending' then 2 when 'paid' then 3 else 4 end,cm.created_at desc
       limit 1000`;
    const ruleRows:CommissionRuleRow[]=rules.map(r=>({id:s(r.id),rule_key:s(r.rule_key),version:Number(r.version),status:s(r.status) as CommissionRuleRow["status"],commission_type:s(r.commission_type) as CommissionRuleRow["commission_type"],commission_value:Number(r.commission_value),trigger_event:s(r.trigger_event),basis:s(r.basis) as CommissionRuleRow["basis"],conditions:(r.conditions??{}) as Record<string,unknown>,eligible_roles:Array.isArray(r.eligible_roles)?r.eligible_roles.map(s):[],eligible_staff:Array.isArray(r.eligible_staff)?r.eligible_staff.map(s):[],approval_required:b(r.approval_required),effective_from:ns(r.effective_from),effective_to:ns(r.effective_to),created_at:s(r.created_at)}));
    const commissionRows:CommissionRow[]=commissions.map(r=>({id:s(r.id),client_id:s(r.client_id),client_ref:s(r.client_ref),client_name:s(r.client_name),employee_id:s(r.employee_id),employee_name:s(r.employee_name),staff_code:ns(r.staff_code),rule_id:s(r.rule_id),rule_key:s(r.rule_key),rule_version:Number(r.rule_version),trigger_event:s(r.trigger_event),trigger_event_id:s(r.trigger_event_id),basis_amount:Number(r.basis_amount),amount:Number(r.amount),status:s(r.status) as CommissionRow["status"],eligible_at:ns(r.eligible_at),approved_at:ns(r.approved_at),paid_at:ns(r.paid_at),payment_reference:ns(r.payment_reference),cancel_reason:ns(r.cancel_reason),created_at:s(r.created_at)}));
    return{rules:ruleRows,commissions:commissionRows};
  });
}
