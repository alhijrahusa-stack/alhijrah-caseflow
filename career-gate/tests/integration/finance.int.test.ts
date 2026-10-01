import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withStaff, type StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { recordFinancialTransaction } from "@/lib/finance";

const db = sql();
let manager: StaffSession;
let clientId: string;
let accountId: string;
let firstPaymentId: string;

beforeAll(async () => {
  const authId = randomUUID();
  await db`insert into auth.users(id,email) values(${authId},${`finance-${authId}@test.invalid`})`;
  const [s] = await db`insert into staff(display_name,email,role,auth_user_id) values('TEST Finance Manager',${`finance-${authId}@test.invalid`},'manager',${authId}) returning id,display_name,email,role`;
  manager = { authUserId: authId, staff: s as StaffSession["staff"] };
  const [c] = await db`
    insert into clients(source,full_name,phone,current_status,next_step,assigned_staff)
    values('staff_manual','TEST Finance Client',${`313${String(Date.now()).slice(-7)}`},'new_intake','Review client',${s.id}) returning id`;
  clientId = c.id;
  const [a] = await db`insert into client_accounts(client_id,fee_amount,assigned_staff,updated_by) values(${clientId},150,${s.id},${s.id}) returning id`;
  accountId = a.id;
});

afterAll(async () => { await db.end(); });

describe("payment ledger", () => {
  it("creates an opening charge automatically for a new account", async () => {
    const rows = await db`select transaction_type,amount,source from account_transactions where account_id=${accountId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ transaction_type: "charge", source: "system" });
    expect(Number(rows[0].amount)).toBe(150);
  });

  it("records a partial payment and derives the balance", async () => {
    const result = await withStaff(manager, (tx) => recordFinancialTransaction(tx, { staffId: manager.staff.id, traceId: "finance-int" }, {
      clientId,
      type: "payment",
      amount: 75,
      method: "zelle",
      reference: "TEST-ZELLE-1",
      occurredAt: new Date(),
      idempotencyKey: `test-payment-${clientId}-1`,
    }));
    firstPaymentId = result.id;
    expect(result.idempotent).toBe(false);
    const [b] = await db`select balance,payment_status,total_paid from client_account_balances where client_id=${clientId}`;
    expect(Number(b.balance)).toBe(75);
    expect(Number(b.total_paid)).toBe(75);
    expect(b.payment_status).toBe("partially_paid");
  });

  it("replays the same idempotency key without a second payment", async () => {
    const result = await withStaff(manager, (tx) => recordFinancialTransaction(tx, { staffId: manager.staff.id, traceId: "finance-int-retry" }, {
      clientId,
      type: "payment",
      amount: 75,
      method: "zelle",
      reference: "TEST-ZELLE-1",
      occurredAt: new Date(),
      idempotencyKey: `test-payment-${clientId}-1`,
    }));
    expect(result.id).toBe(firstPaymentId);
    expect(result.idempotent).toBe(true);
    const [{ n }] = await db`select count(*)::int n from account_transactions where client_id=${clientId} and transaction_type='payment'`;
    expect(n).toBe(1);
  });

  it("becomes paid after the remaining payment", async () => {
    await withStaff(manager, (tx) => recordFinancialTransaction(tx, { staffId: manager.staff.id, traceId: "finance-int" }, {
      clientId,
      type: "payment",
      amount: 75,
      method: "cash",
      occurredAt: new Date(),
      idempotencyKey: `test-payment-${clientId}-2`,
    }));
    const [b] = await db`select balance,payment_status,total_paid from client_account_balances where client_id=${clientId}`;
    expect(Number(b.balance)).toBe(0);
    expect(Number(b.total_paid)).toBe(150);
    expect(b.payment_status).toBe("paid");
  });

  it("rejects mutation of ledger history and the legacy financial snapshot", async () => {
    await expect(db`update account_transactions set amount=1 where id=${firstPaymentId}`).rejects.toThrow(/append-only/);
    await expect(db`update client_accounts set payment_status='paid' where id=${accountId}`).rejects.toThrow(/read-only/);
  });
});

describe("commission identity", () => {
  it("prevents duplicate commission for the same rule event", async () => {
    const [rule] = await db`
      insert into commission_rules(rule_key,version,status,commission_type,commission_value,trigger_event,approval_required)
      values(${`test-${clientId}`},1,'active','fixed',25,'client.completed',true) returning id`;
    const [staff] = await db`select assigned_staff id from client_accounts where id=${accountId}`;
    await db`
      insert into commissions(client_id,account_id,employee_id,rule_id,trigger_event,trigger_event_id,basis_amount,amount,status)
      values(${clientId},${accountId},${staff.id},${rule.id},'client.completed',${`completion:${clientId}`},150,25,'eligible')`;
    await expect(db`
      insert into commissions(client_id,account_id,employee_id,rule_id,trigger_event,trigger_event_id,basis_amount,amount,status)
      values(${clientId},${accountId},${staff.id},${rule.id},'client.completed',${`completion:${clientId}`},150,25,'eligible')`).rejects.toMatchObject({ code: "23505" });
  });
});
