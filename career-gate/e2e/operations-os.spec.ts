import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { accessToken, db, intakeBody, STAFF, submitIntake, uniqueIp } from "./helpers";

async function postStaff(request: APIRequestContext, role: keyof typeof STAFF, path: string, data: Record<string, unknown>) {
  const res = await request.post(path, {
    data,
    headers: { cookie: `cg_at=${await accessToken(role)}`, "x-forwarded-for": uniqueIp() },
  });
  return { status: res.status(), json: await res.json() };
}

test.describe.serial("Career Gate Operations OS core", () => {
  let clientId = "";
  let staffId = "";
  let requirementId = "";
  let firstPaymentId = "";
  let secondPaymentId = "";
  let commissionId = "";

  test.beforeAll(async ({ request }) => {
    const intake = await submitIntake(request, intakeBody(`TEST Operations OS ${Date.now()}`));
    expect(intake.res.status(), JSON.stringify(intake.json)).toBe(201);
    const [client] = await db()`select id from clients where ref=${intake.json.ref}`;
    clientId = client.id as string;
    const [staff] = await db()`select id from staff where auth_user_id=${STAFF.staff}`;
    staffId = staff.id as string;

    const assign = await postStaff(request, "admin", "/api/staff/operations", {
      operation: "reassign_client", client_id: clientId, staff_id: staffId, task_ids: [], reason: "operations os e2e",
    });
    expect(assign.status, JSON.stringify(assign.json)).toBe(200);

    const comp = await postStaff(request, "admin", "/api/staff/operations", {
      operation: "update_staff_comp", staff_id: staffId, commission_type: "fixed", commission_value: 25, eligible_for_round_robin: true,
    });
    expect(comp.status, JSON.stringify(comp.json)).toBe(200);

    const stage = await postStaff(request, "admin", "/api/staff/operations", {
      operation: "move_stage", client_id: clientId, stage: "interview_passed",
    });
    expect(stage.status, JSON.stringify(stage.json)).toBe(200);
    const [account] = await db()`select id from client_accounts where client_id=${clientId}`;
    expect(account?.id).toBeTruthy();
  });

  test("requirements are canonical, scoped and drive deterministic readiness", async ({ request }) => {
    const created = await postStaff(request, "admin", "/api/staff/requirements", {
      operation: "create_requirement",
      client_id: clientId,
      requirement_key: "e2e:identity-review",
      title: "Identity review",
      why: "E2E workflow requirement",
      completion_rule: "Staff confirms identity review",
      due_on: null,
      status: "missing",
    });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    requirementId = created.json.requirement.id;

    const [before] = await db()`select total_requirements,completed_requirements,readiness_percent from client_readiness where client_id=${clientId}`;
    expect(Number(before.total_requirements)).toBeGreaterThanOrEqual(1);
    expect(Number(before.completed_requirements)).toBe(0);
    expect(Number(before.readiness_percent)).toBe(0);

    const completed = await postStaff(request, "staff", "/api/staff/requirements", {
      operation: "update_requirement", requirement_id: requirementId, status: "complete", due_on: null,
    });
    expect(completed.status, JSON.stringify(completed.json)).toBe(200);

    const [after] = await db()`select total_requirements,completed_requirements,readiness_percent from client_readiness where client_id=${clientId}`;
    expect(Number(after.completed_requirements)).toBe(Number(after.total_requirements));
    expect(Number(after.readiness_percent)).toBe(100);
  });

  test("payment ledger is immutable, idempotent and derives partial/full balance", async ({ request }) => {
    const firstKey = randomUUID();
    const firstPayload = {
      operation: "record_transaction",
      client_id: clientId,
      transaction_type: "payment",
      direction: null,
      amount: 50,
      payment_method: "zelle",
      occurred_on: new Date().toISOString().slice(0, 10),
      transaction_reference: "E2E-PAY-1",
      receipt_document_id: null,
      related_transaction_id: null,
      reason: "E2E partial payment",
      idempotency_key: firstKey,
    };
    const first = await postStaff(request, "admin", "/api/staff/accounting", firstPayload);
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    firstPaymentId = first.json.transaction.id;
    expect(Number(first.json.balance.balance)).toBe(100);
    expect(first.json.balance.payment_status).toBe("partially_paid");

    const retry = await postStaff(request, "admin", "/api/staff/accounting", firstPayload);
    expect(retry.status, JSON.stringify(retry.json)).toBe(200);
    expect(retry.json.idempotent).toBe(true);
    const [{ n }] = await db()`select count(*)::int n from payment_transactions where idempotency_key=${firstKey}`;
    expect(n).toBe(1);

    const second = await postStaff(request, "manager", "/api/staff/accounting", {
      ...firstPayload,
      amount: 100,
      transaction_reference: "E2E-PAY-2",
      reason: "E2E final payment",
      idempotency_key: randomUUID(),
    });
    expect(second.status, JSON.stringify(second.json)).toBe(200);
    secondPaymentId = second.json.transaction.id;
    expect(Number(second.json.balance.balance)).toBe(0);
    expect(second.json.balance.payment_status).toBe("paid");

    const [ledger] = await db()`select amount_paid,balance,payment_status from client_account_balances where client_id=${clientId}`;
    expect(Number(ledger.amount_paid)).toBe(150);
    expect(Number(ledger.balance)).toBe(0);
    expect(ledger.payment_status).toBe("paid");

    await expect(db()`update payment_transactions set amount=999 where id=${firstPaymentId}`).rejects.toThrow();
    await expect(db()`update client_accounts set payment_status='refunded' where client_id=${clientId}`).rejects.toThrow(/projection_is_read_only/);
  });

  test("a paid account earns no commission until the application completion is recorded, and the completer owns it", async ({ request }) => {
    // LOCKED RULE: COMMISSION_OWNER = APPLICATION_COMPLETED_BY. The account is
    // fully paid at this point, so the only thing missing is the owner.
    const [none] = await db()`select count(*)::int n from commissions where client_id=${clientId}`;
    expect(Number(none.n)).toBe(0);

    const recorded = await postStaff(request, "admin", "/api/staff/accounting", {
      operation: "record_application_completion",
      client_id: clientId,
      completed_by: staffId,
      completed_on: new Date().toISOString().slice(0, 10),
    });
    expect(recorded.status, JSON.stringify(recorded.json)).toBe(200);
    expect(recorded.json.client.application_status).toBe("completed");
    expect(recorded.json.commission.employee_id).toBe(staffId);

    // The commission belongs to the completer, not to whoever recorded the money.
    const [adminStaff] = await db()`select id from staff where auth_user_id=${STAFF.admin}`;
    expect(recorded.json.commission.employee_id).not.toBe(adminStaff.id);
  });

  test("commission is versioned, generated from paid event and auditable through lifecycle", async ({ request }) => {
    const [rule] = await db()`select id,version,commission_type,commission_value from commission_rules where employee_id=${staffId} and active`;
    expect(rule.commission_type).toBe("fixed");
    expect(Number(rule.commission_value)).toBe(25);
    expect(Number(rule.version)).toBeGreaterThanOrEqual(2);

    const [commission] = await db()`select id,amount,status,rule_version from commissions where client_id=${clientId} and trigger_event='account_paid'`;
    expect(commission?.id).toBeTruthy();
    commissionId = commission.id as string;
    expect(Number(commission.amount)).toBe(25);
    expect(commission.status).toBe("eligible");
    expect(Number(commission.rule_version)).toBe(Number(rule.version));

    const approved = await postStaff(request, "manager", "/api/staff/accounting", {
      operation: "update_commission", commission_id: commissionId, status: "approved", payment_reference: null, reason: null,
    });
    expect(approved.status, JSON.stringify(approved.json)).toBe(200);
    expect(approved.json.commission.status).toBe("approved");

    const paid = await postStaff(request, "admin", "/api/staff/accounting", {
      operation: "update_commission", commission_id: commissionId, status: "paid", payment_reference: "E2E-COMMISSION-1", reason: null,
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json.commission.status).toBe("paid");
  });

  test("refund must link to original payment and automatically reverses earned commission when account is no longer paid", async ({ request }) => {
    const bad = await postStaff(request, "admin", "/api/staff/accounting", {
      operation: "record_transaction", client_id: clientId, transaction_type: "refund", direction: null,
      amount: 20, payment_method: null, occurred_on: new Date().toISOString().slice(0, 10),
      transaction_reference: "E2E-BAD-REFUND", receipt_document_id: null, related_transaction_id: null,
      reason: "must fail", idempotency_key: randomUUID(),
    });
    expect(bad.status).toBe(400);

    const refund = await postStaff(request, "admin", "/api/staff/accounting", {
      operation: "record_transaction", client_id: clientId, transaction_type: "refund", direction: null,
      amount: 20, payment_method: null, occurred_on: new Date().toISOString().slice(0, 10),
      transaction_reference: "E2E-REFUND-1", receipt_document_id: null, related_transaction_id: secondPaymentId,
      reason: "E2E partial refund", idempotency_key: randomUUID(),
    });
    expect(refund.status, JSON.stringify(refund.json)).toBe(200);
    expect(Number(refund.json.balance.balance)).toBe(20);
    expect(refund.json.balance.payment_status).toBe("partially_paid");

    const [commission] = await db()`select status,cancel_reason from commissions where id=${commissionId}`;
    expect(commission.status).toBe("reversed");
    expect(commission.cancel_reason).toContain("no longer fully paid");
    const [refundRow] = await db()`select related_transaction_id,direction,amount from payment_transactions where transaction_reference='E2E-REFUND-1'`;
    expect(refundRow.related_transaction_id).toBe(secondPaymentId);
    expect(refundRow.direction).toBe("debit");
    expect(Number(refundRow.amount)).toBe(20);
  });

  test("staff cannot mutate management accounting commands", async ({ request }) => {
    const denied = await postStaff(request, "staff", "/api/staff/accounting", {
      operation: "record_transaction", client_id: clientId, transaction_type: "payment", direction: null,
      amount: 1, payment_method: "cash", occurred_on: new Date().toISOString().slice(0, 10), transaction_reference: null,
      receipt_document_id: null, related_transaction_id: null, reason: null, idempotency_key: randomUUID(),
    });
    expect(denied.status).toBe(403);
  });

  test("a discount reduces the net fee through the same write path and leaves the contracted fee intact", async ({ request }) => {
    const applied = await postStaff(request, "manager", "/api/staff/accounting", {
      operation: "apply_discount", client_id: clientId, discount_amount: 20, reason: "E2E goodwill discount",
    });
    expect(applied.status, JSON.stringify(applied.json)).toBe(200);
    expect(Number(applied.json.balance.net_fee)).toBe(130);
    expect(Number(applied.json.balance.balance)).toBe(0);
    expect(applied.json.balance.payment_status).toBe("paid");

    const [account] = await db()`select fee_amount,discount_amount,discount_reason from client_accounts where client_id=${clientId}`;
    expect(Number(account.fee_amount)).toBe(150);
    expect(Number(account.discount_amount)).toBe(20);
    expect(account.discount_reason).toBe("E2E goodwill discount");

    await expect(db()`update client_accounts set discount_amount=5 where client_id=${clientId}`).rejects.toThrow(/projection_is_read_only/);
  });

  test("a percentage discount is calculated by the server and keeps the entered input", async ({ request }) => {
    // The browser never supplies the effective amount: only the type and the
    // percentage. 20% of the $150 contracted fee is $30.
    const applied = await postStaff(request, "manager", "/api/staff/accounting", {
      operation: "apply_discount", client_id: clientId, discount_type: "percentage", discount_value: 20, reason: "E2E percentage concession",
    });
    expect(applied.status, JSON.stringify(applied.json)).toBe(200);
    expect(Number(applied.json.discount_amount)).toBe(30);
    expect(applied.json.discount_input_type).toBe("percentage");
    expect(Number(applied.json.discount_input_value)).toBe(20);
    expect(Number(applied.json.balance.net_fee)).toBe(120);

    const [account] = await db()`select fee_amount,discount_amount,discount_input_type,discount_input_value from client_accounts where client_id=${clientId}`;
    expect(Number(account.fee_amount)).toBe(150);
    expect(Number(account.discount_amount)).toBe(30);
    expect(account.discount_input_type).toBe("percentage");
    expect(Number(account.discount_input_value)).toBe(20);

    const over = await postStaff(request, "manager", "/api/staff/accounting", {
      operation: "apply_discount", client_id: clientId, discount_type: "percentage", discount_value: 120, reason: "E2E must fail",
    });
    expect(over.status).toBe(400);
  });

  test("a waiver settles the account without inventing a payment method", async ({ request }) => {
    // Before this change the projection check demanded a method and a date on a
    // paid account, so a settling waiver could not be recorded at all.
    const fresh = await submitIntake(request, intakeBody(`TEST Waiver Account ${Date.now()}`));
    expect(fresh.res.status(), JSON.stringify(fresh.json)).toBe(201);
    const [waiverClient] = await db()`select id from clients where ref=${fresh.json.ref}`;
    const waiverClientId = waiverClient.id as string;
    const stage = await postStaff(request, "admin", "/api/staff/operations", {
      operation: "move_stage", client_id: waiverClientId, stage: "interview_passed",
    });
    expect(stage.status, JSON.stringify(stage.json)).toBe(200);

    const waived = await postStaff(request, "manager", "/api/staff/accounting", {
      operation: "record_transaction", client_id: waiverClientId, transaction_type: "waiver", direction: "credit",
      amount: 150, payment_method: null, occurred_on: new Date().toISOString().slice(0, 10),
      transaction_reference: null, receipt_document_id: null, related_transaction_id: null,
      reason: "E2E full waiver", idempotency_key: randomUUID(),
    });
    expect(waived.status, JSON.stringify(waived.json)).toBe(200);
    expect(Number(waived.json.balance.balance)).toBe(0);
    expect(waived.json.balance.payment_status).toBe("paid");
    // Settled, but no cash is claimed.
    expect(Number(waived.json.balance.amount_paid)).toBe(0);
    const [projection] = await db()`select payment_status,payment_method,payment_date from client_accounts where client_id=${waiverClientId}`;
    expect(projection.payment_status).toBe("paid");
    expect(projection.payment_method).toBeNull();
    expect(projection.payment_date).toBeNull();
  });
});
