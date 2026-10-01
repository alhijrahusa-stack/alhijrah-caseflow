import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@/lib/db";

const db=sql();
let staffId:string;let clientId:string;let accountId:string;let ruleId:string;

beforeAll(async()=>{
  const authId=randomUUID();
  const email=`commission-${authId}@test.invalid`;
  await db`insert into auth.users(id,email) values(${authId},${email})`;
  const [s]=await db`insert into staff(display_name,email,role,auth_user_id,commission_eligible) values('TEST Commission Staff',${email},'staff',${authId},false) returning id`;
  staffId=s.id;
  const [c]=await db`insert into clients(source,full_name,phone,current_status,next_step,assigned_staff,waiting_condition)
    values('staff_manual','TEST Commission Client',${`734${String(Date.now()).slice(-7)}`},'new_intake','Review client',${staffId},'Awaiting next-action deadline') returning id`;
  clientId=c.id;
  const [a]=await db`insert into client_accounts(client_id,fee_amount,assigned_staff) values(${clientId},150,${staffId}) returning id`;
  accountId=a.id;
  const [r]=await db`insert into commission_rules(rule_key,version,status,commission_type,commission_value,trigger_event,basis,conditions,eligible_roles,approval_required,effective_from)
    values(${`completion-${clientId}`},1,'active','fixed',25,'client.completed','total_paid',${db.json({require_account_paid:true,required_client_status:"completed"})},array['staff']::text[],true,now()) returning id`;
  ruleId=r.id;
});
afterAll(async()=>{await db.end()});

describe("commission evaluation",()=>{
  it("does not create commission while employee is not eligible",async()=>{
    await db`update clients set current_status='completed',next_step='No further action needed.' where id=${clientId}`;
    const [{n}]=await db`select count(*)::int n from commissions where client_id=${clientId}`;
    expect(n).toBe(0);
  });

  it("does not create commission when eligible but account is unpaid",async()=>{
    await db`update staff set commission_eligible=true where id=${staffId}`;
    const [{n:created}]=await db`select public.evaluate_client_commissions_internal(${clientId},'client.completed',${`client.completed:${clientId}`})::int n`;
    expect(created).toBe(0);
    const [{n}]=await db`select count(*)::int n from commissions where client_id=${clientId}`;
    expect(n).toBe(0);
  });

  it("creates one eligible commission after the account is satisfied",async()=>{
    await db`insert into account_transactions(account_id,client_id,transaction_type,amount,payment_method,occurred_at,idempotency_key,source)
      values(${accountId},${clientId},'payment',150,'zelle',now(),${`commission-test-payment:${clientId}`},'system')`;
    const rows=await db`select id,rule_id,employee_id,amount,status,trigger_event,trigger_event_id from commissions where client_id=${clientId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({rule_id:ruleId,employee_id:staffId,status:"eligible",trigger_event:"client.completed",trigger_event_id:`client.completed:${clientId}`});
    expect(Number(rows[0].amount)).toBe(25);
  });

  it("re-evaluation is idempotent for the same rule event",async()=>{
    const [{n:created}]=await db`select public.evaluate_client_commissions_internal(${clientId},'client.completed',${`client.completed:${clientId}`})::int n`;
    expect(created).toBe(0);
    const [{n}]=await db`select count(*)::int n from commissions where client_id=${clientId}`;
    expect(n).toBe(1);
  });
});
