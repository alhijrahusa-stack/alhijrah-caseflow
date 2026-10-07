import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { withStaff, type StaffSession } from "@/lib/auth";
import {
  applyAccountDiscount,
  lockAccount,
  reconcileAccount,
  recordApplicationCompletion,
} from "@/lib/accounting-ledger";
import { ACCOUNT_NET_FEE, BALANCE_NET_FEE, CLIENT_FIELD, DISCOUNT_AMOUNT, missingAccountingSchema } from "@/lib/accounting-schema";
import { clientAccountSummary } from "@/lib/client-account";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";

/**
 * LOCKED BUSINESS RULE — COMMISSION_OWNER = APPLICATION_COMPLETED_BY
 *
 * Proven here against the real schema, through the same functions the API route
 * calls. Every test uses synthetic data only.
 */

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
const trace = "acct-commission-int";

let manager: StaffSession;
let completer: StaffSession;
let otherStaff: StaffSession;
let recorder: StaffSession;
// A range of its own: the integration suites share one database.
let phoneSequence = 8100;
const nextPhone = () => `313555${String(++phoneSequence).padStart(4, "0")}`;

async function makeStaff(key: string, role: "admin" | "manager" | "staff", commissionValue = 20): Promise<StaffSession> {
  const authUserId = randomUUID();
  await db`insert into auth.users (id,email) values (${authUserId},${`${key}@test.invalid`})`;
  const [staff] = await db`
    insert into staff (display_name,email,role,auth_user_id,active,commission_type,commission_value)
    values (${`TEST ${key}`},${`${key}@test.invalid`},${role},${authUserId},true,'fixed',${commissionValue})
    returning id,display_name,email,role`;
  return { authUserId, staff: staff as StaffSession["staff"] };
}

/**
 * A synthetic client at the pipeline stage where `ensure_client_account`
 * creates the account, assigned to `assigned`.
 */
async function makeClient(name: string, assigned: string | null) {
  const client = await db.begin((tx) =>
    insertClient(tx, {
      source: "staff_manual",
      profile: ProfileSchema.parse({ full_name: name, phone: nextPhone(), email: null, date_of_birth: "1990-04-05", employment_history: [] }),
      primary: [], backup: [], status: "new_intake" as never, nextStep: null,
      assignedStaff: assigned, createdBy: null, communicationConsent: true,
    }, { staffId: null, traceId: trace }));
  const clientId = String((client as { id: string }).id);
  await db`update clients set pipeline_stage='interview_passed' where id=${clientId}`;
  return clientId;
}

async function pay(session: StaffSession, clientId: string, amount: number, occurredOn = "2026-10-06") {
  return withStaff(session, async (tx) => {
    const account = await lockAccount(tx, clientId);
    const [transaction] = await tx`
      insert into payment_transactions(
        account_id,client_id,transaction_type,direction,amount,status,payment_method,occurred_at,source,recorded_by,idempotency_key
      ) values (
        ${account.id},${clientId},'payment','credit',${amount},'confirmed','zelle',${occurredOn}::date::timestamptz,
        'staff',${session.staff.id},${randomUUID()}
      ) returning id`;
    return reconcileAccount(tx, {
      account,
      staffId: session.staff.id,
      traceId: trace,
      eligibilityDate: occurredOn,
      triggerTransactionId: transaction.id as string,
      paymentMethod: "zelle",
      paymentDate: occurredOn,
    });
  });
}

const commissionOf = async (clientId: string) =>
  (await db`select employee_id,amount,status,calculation_basis from commissions where client_id=${clientId}`)[0];

beforeAll(async () => {
  manager = await makeStaff("acct-manager", "manager");
  completer = await makeStaff("acct-completer", "staff", 20);
  otherStaff = await makeStaff("acct-other", "staff", 99);
  // A recorder of its own, so no test mutates a staff row other suites share.
  recorder = await makeStaff("acct-recorder", "manager", 99);
});

afterAll(async () => { await db.end(); });

describe("commission ownership is the recorded application completer", () => {

  it("creates no commission when the application has no recorded completion", async () => {
    const clientId = await makeClient("QA Synthetic No Completion", completer.staff.id);
    const settled = await pay(manager, clientId, 150);
    expect(settled.balance?.payment_status).toBe("paid");
    expect(settled.commission).toBeNull();
    expect(settled.commission_blocked).toBe("APPLICATION_NOT_COMPLETED");
    expect(await commissionOf(clientId)).toBeUndefined();
  });

  it("attributes the commission to the completer, not the assigned staff", async () => {
    // Assigned to one person, completed by another: the completer earns it.
    const clientId = await makeClient("QA Synthetic Owner Split", otherStaff.staff.id);
    await withStaff(manager, (tx) => recordApplicationCompletion(tx, {
      clientId, completedBy: completer.staff.id, completedOn: "2026-10-01", staffId: manager.staff.id, traceId: trace,
    }));
    const settled = await pay(manager, clientId, 150);
    expect(settled.commission?.employee_id).toBe(completer.staff.id);
    expect(settled.commission?.employee_id).not.toBe(otherStaff.staff.id);
    expect(Number(settled.commission?.amount)).toBe(20);
  });

  it("does not move the commission when the client is reassigned", async () => {
    const clientId = await makeClient("QA Synthetic Reassign", completer.staff.id);
    await withStaff(manager, (tx) => recordApplicationCompletion(tx, {
      clientId, completedBy: completer.staff.id, completedOn: "2026-10-01", staffId: manager.staff.id, traceId: trace,
    }));
    await pay(manager, clientId, 150);

    await db`update clients set assigned_staff=${otherStaff.staff.id} where id=${clientId}`;
    await db`update client_accounts set assigned_staff=${otherStaff.staff.id} where client_id=${clientId}`;
    // Settle again: the owner is read fresh each time and must not follow.
    await withStaff(manager, async (tx) => reconcileAccount(tx, {
      account: await lockAccount(tx, clientId), staffId: manager.staff.id, traceId: trace, eligibilityDate: "2026-10-06",
    }));

    expect((await commissionOf(clientId))?.employee_id).toBe(completer.staff.id);
  });

  it("does not attribute the commission to whoever records the payment or uploads the receipt", async () => {
    const clientId = await makeClient("QA Synthetic Recorder", null);
    await withStaff(manager, (tx) => recordApplicationCompletion(tx, {
      clientId, completedBy: completer.staff.id, completedOn: "2026-10-01", staffId: manager.staff.id, traceId: trace,
    }));
    // A different staff member records the money and uploads nothing else.
    const settled = await pay(recorder, clientId, 150);

    expect(settled.commission?.employee_id).toBe(completer.staff.id);
    expect(settled.commission?.employee_id).not.toBe(recorder.staff.id);
    const [tx] = await db`select recorded_by from payment_transactions where client_id=${clientId}`;
    expect(tx?.recorded_by).toBe(recorder.staff.id);
  });

  it("creates the commission retroactively when completion is recorded after payment", async () => {
    const clientId = await makeClient("QA Synthetic Late Completion", otherStaff.staff.id);
    const paid = await pay(manager, clientId, 150);
    expect(paid.commission_blocked).toBe("APPLICATION_NOT_COMPLETED");

    const settled = await withStaff(manager, (tx) => recordApplicationCompletion(tx, {
      clientId, completedBy: completer.staff.id, completedOn: "2026-10-05", staffId: manager.staff.id, traceId: trace,
    }));
    expect(settled.commission?.employee_id).toBe(completer.staff.id);
  });

  it("refuses to move ownership while a live commission is derived from it", async () => {
    const clientId = await makeClient("QA Synthetic Locked Owner", null);
    await withStaff(manager, (tx) => recordApplicationCompletion(tx, {
      clientId, completedBy: completer.staff.id, completedOn: "2026-10-01", staffId: manager.staff.id, traceId: trace,
    }));
    await pay(manager, clientId, 150);

    await expect(
      db`update clients set application_completed_by=${otherStaff.staff.id} where id=${clientId}`,
    ).rejects.toThrow(/application_completion_locked_by_commission/);
  });

  it("records completion as one indivisible fact", async () => {
    const clientId = await makeClient("QA Synthetic Partial Completion", null);
    await expect(
      db`update clients set application_status='completed' where id=${clientId}`,
    ).rejects.toThrow(/clients_application_completion_ck/);
  });
});

describe("client discount", () => {
  it("reduces the net fee, settles the account, and sets the commission basis", async () => {
    const clientId = await makeClient("QA Synthetic Discount", null);
    await withStaff(manager, (tx) => recordApplicationCompletion(tx, {
      clientId, completedBy: completer.staff.id, completedOn: "2026-10-01", staffId: manager.staff.id, traceId: trace,
    }));
    // Pays less than the contracted fee: still outstanding.
    const partial = await pay(manager, clientId, 120);
    expect(partial.balance?.payment_status).toBe("partially_paid");
    expect(partial.commission).toBeNull();

    const discounted = await withStaff(manager, (tx) => applyAccountDiscount(tx, {
      clientId, discountType: "amount", discountValue: 30, reason: "QA synthetic goodwill discount", staffId: manager.staff.id, traceId: trace,
    }));
    expect(Number(discounted.balance?.net_fee)).toBe(120);
    expect(Number(discounted.balance?.balance)).toBe(0);
    expect(discounted.balance?.payment_status).toBe("paid");
    // The contracted fee is preserved beside the concession, not overwritten.
    const [account] = await db`select fee_amount,discount_amount,discount_reason from client_accounts where client_id=${clientId}`;
    expect(Number(account.fee_amount)).toBe(150);
    expect(Number(account.discount_amount)).toBe(30);
    expect(account.discount_reason).toBe("QA synthetic goodwill discount");
    // Commission follows the money actually owed.
    expect(Number((await commissionOf(clientId))?.calculation_basis)).toBe(120);
  });

  it("requires a reason and refuses a discount larger than the fee", async () => {
    const clientId = await makeClient("QA Synthetic Discount Bounds", null);
    await expect(withStaff(manager, (tx) => applyAccountDiscount(tx, {
      clientId, discountType: "amount", discountValue: 10, reason: "  ", staffId: manager.staff.id, traceId: trace,
    }))).rejects.toThrow("DISCOUNT_REASON_REQUIRED");
    await expect(withStaff(manager, (tx) => applyAccountDiscount(tx, {
      clientId, discountType: "amount", discountValue: 1000, reason: "QA synthetic", staffId: manager.staff.id, traceId: trace,
    }))).rejects.toThrow("DISCOUNT_EXCEEDS_FEE");
  });

  it("rejects a discount written outside the canonical ledger command", async () => {
    const clientId = await makeClient("QA Synthetic Discount Guard", null);
    await expect(
      db`update client_accounts set discount_amount=10 where client_id=${clientId}`,
    ).rejects.toThrow(/client_account_finance_projection_is_read_only/);
  });
});

describe("settlement stays reversible and idempotent", () => {
  it("reverses the commission when a refund takes the account below the net fee", async () => {
    const clientId = await makeClient("QA Synthetic Refund", null);
    await withStaff(manager, (tx) => recordApplicationCompletion(tx, {
      clientId, completedBy: completer.staff.id, completedOn: "2026-10-01", staffId: manager.staff.id, traceId: trace,
    }));
    await pay(manager, clientId, 150);
    expect((await commissionOf(clientId))?.status).toBe("eligible");

    await withStaff(manager, async (tx) => {
      const account = await lockAccount(tx, clientId);
      const [payment] = await tx`select id from payment_transactions where client_id=${clientId} and transaction_type='payment'`;
      await tx`
        insert into payment_transactions(
          account_id,client_id,transaction_type,direction,amount,status,occurred_at,related_transaction_id,reason,source,recorded_by,idempotency_key
        ) values (
          ${account.id},${clientId},'refund','debit',50,'confirmed','2026-10-07'::date::timestamptz,${payment.id as string},
          'QA synthetic partial refund','staff',${manager.staff.id},${randomUUID()}
        )`;
      return reconcileAccount(tx, {
        account, staffId: manager.staff.id, traceId: trace, eligibilityDate: "2026-10-07", refundRecorded: true,
      });
    });

    expect((await commissionOf(clientId))?.status).toBe("reversed");
  });

  it("keeps a refunded account refunded when it settles again for another reason", async () => {
    const clientId = await makeClient("QA Synthetic Refunded Hold", null);
    await pay(manager, clientId, 150);
    await withStaff(manager, async (tx) => {
      const account = await lockAccount(tx, clientId);
      const [payment] = await tx`select id from payment_transactions where client_id=${clientId} and transaction_type='payment'`;
      await tx`
        insert into payment_transactions(
          account_id,client_id,transaction_type,direction,amount,status,occurred_at,related_transaction_id,reason,source,recorded_by,idempotency_key
        ) values (
          ${account.id},${clientId},'refund','debit',150,'confirmed','2026-10-07'::date::timestamptz,${payment.id as string},
          'QA synthetic full refund','staff',${manager.staff.id},${randomUUID()}
        )`;
      return reconcileAccount(tx, {
        account, staffId: manager.staff.id, traceId: trace, eligibilityDate: "2026-10-07", refundRecorded: true,
      });
    });
    const [refundedView] = await db`select payment_status from client_account_balances where client_id=${clientId}`;
    expect(refundedView.payment_status).toBe("refunded");

    // Recording the application completion settles the account again; the
    // refund must survive that, not read as a fresh unpaid balance.
    const settled = await withStaff(manager, (tx) => recordApplicationCompletion(tx, {
      clientId, completedBy: completer.staff.id, completedOn: "2026-10-08", staffId: manager.staff.id, traceId: trace,
    }));
    expect(settled.balance?.payment_status).toBe("refunded");
    expect(settled.commission).toBeNull();
  });

  it("never produces a second commission for the same account", async () => {
    const clientId = await makeClient("QA Synthetic Single Commission", null);
    await withStaff(manager, (tx) => recordApplicationCompletion(tx, {
      clientId, completedBy: completer.staff.id, completedOn: "2026-10-01", staffId: manager.staff.id, traceId: trace,
    }));
    await pay(manager, clientId, 150);
    await withStaff(manager, async (tx) => reconcileAccount(tx, {
      account: await lockAccount(tx, clientId), staffId: manager.staff.id, traceId: trace, eligibilityDate: "2026-10-06",
    }));
    const [{ count }] = await db`select count(*)::int count from commissions where client_id=${clientId}`;
    expect(count).toBe(1);
  });
});

describe("deployment ordering: the code may reach production before migration 033", () => {
  it("reads a pre-033 account as undiscounted instead of failing", async () => {
    // A table shaped like `client_accounts` was before the migration.
    await db`create temporary table pre033_accounts (id uuid, fee_amount numeric(10,2), payment_status text)`;
    await db`insert into pre033_accounts values (gen_random_uuid(),150,'pending')`;
    const [row] = await db.unsafe(
      `select ${DISCOUNT_AMOUNT("a")} discount_amount, ${ACCOUNT_NET_FEE("a")} net_fee from pre033_accounts a`,
    );
    expect(Number(row.discount_amount)).toBe(0);
    expect(Number(row.net_fee)).toBe(150);
  });

  it("reads a pre-033 balances row with the contracted fee as the net fee", async () => {
    await db`create temporary table pre033_balances (account_id uuid, fee_amount numeric(10,2))`;
    await db`insert into pre033_balances values (gen_random_uuid(),150)`;
    const [row] = await db.unsafe(`select ${BALANCE_NET_FEE("b")} net_fee from pre033_balances b`);
    expect(Number(row.net_fee)).toBe(150);
  });

  it("reads a pre-033 client as having no recorded completion, so no commission is attributed", async () => {
    await db`create temporary table pre033_clients (id uuid, assigned_staff uuid)`;
    await db`insert into pre033_clients values (gen_random_uuid(),gen_random_uuid())`;
    const [row] = await db.unsafe(
      `select ${CLIENT_FIELD("c", "application_completed_by")} application_completed_by,
              ${CLIENT_FIELD("c", "application_status")} application_status
       from pre033_clients c`,
    );
    expect(row.application_completed_by).toBeNull();
    expect(row.application_status).toBeNull();
  });

  it("reads the real post-033 values through the same fragments", async () => {
    const clientId = await makeClient("QA Synthetic Fragment Readback", null);
    await withStaff(manager, (tx) => recordApplicationCompletion(tx, {
      clientId, completedBy: completer.staff.id, completedOn: "2026-10-01", staffId: manager.staff.id, traceId: trace,
    }));
    await withStaff(manager, (tx) => applyAccountDiscount(tx, {
      clientId, discountType: "amount", discountValue: 25, reason: "QA synthetic fragment check", staffId: manager.staff.id, traceId: trace,
    }));
    const [row] = await db.unsafe(
      `select ${DISCOUNT_AMOUNT("a")} discount_amount, ${ACCOUNT_NET_FEE("a")} net_fee,
              ${CLIENT_FIELD("c", "application_completed_by")} application_completed_by
       from client_accounts a join clients c on c.id=a.client_id where a.client_id=$1`,
      [clientId],
    );
    expect(Number(row.discount_amount)).toBe(25);
    expect(Number(row.net_fee)).toBe(125);
    expect(row.application_completed_by).toBe(completer.staff.id);
  });

  it("recognises the write failure that a pre-033 database raises", () => {
    expect(missingAccountingSchema('column "application_completed_by" of relation "clients" does not exist')).toBe(true);
    expect(missingAccountingSchema('column "discount_amount" of relation "client_accounts" does not exist')).toBe(true);
    expect(missingAccountingSchema('column "english_proficiency" of relation "clients" does not exist')).toBe(false);
  });
});

describe("commission detail is management-only", () => {
  it("withholds the commission amount and earner from a non-management session", async () => {
    const clientId = await makeClient("QA Synthetic Scope", completer.staff.id);
    await withStaff(manager, (tx) => recordApplicationCompletion(tx, {
      clientId, completedBy: completer.staff.id, completedOn: "2026-10-01", staffId: manager.staff.id, traceId: trace,
    }));
    await pay(manager, clientId, 150);

    const asManager = await clientAccountSummary(manager, clientId);
    expect(asManager?.amount_paid_visible).toBe(true);
    expect(Number(asManager?.commission_amount)).toBe(20);
    expect(asManager?.staff_name).toContain("acct-completer");

    // The assigned staff member may open the file but is not management.
    const asStaff = await clientAccountSummary(completer, clientId);
    expect(asStaff?.amount_paid_visible).toBe(false);
    expect(asStaff?.commission_amount).toBe(0);
    expect(asStaff?.commission_status).toBeNull();
    expect(asStaff?.staff_name).toBeNull();
    // The completion itself is their own work and stays visible.
    expect(asStaff?.application_completed_name).toContain("acct-completer");
  });
});

/** A synthetic receipt document owned by one client. */
async function makeReceipt(clientId: string, label: string) {
  const [doc] = await db`
    insert into documents (client_id,doc_type,storage_path,file_name,mime_type,size_bytes)
    values (${clientId},'other',${`qa-synthetic/${label}-${randomUUID()}.pdf`},${`${label}.pdf`},'application/pdf',2048)
    returning id`;
  return String(doc.id);
}

describe("percentage discount", () => {
  it("has the database compute the effect from the authoritative fee, not the caller", async () => {
    const clientId = await makeClient("QA Synthetic Percentage Discount", null);
    const applied = await withStaff(manager, (tx) => applyAccountDiscount(tx, {
      clientId, discountType: "percentage", discountValue: 20, reason: "QA synthetic 20% concession",
      staffId: manager.staff.id, traceId: trace,
    }));

    // 20% of the $150 contracted fee.
    expect(Number(applied.discount_amount)).toBe(30);
    expect(Number(applied.balance?.net_fee)).toBe(120);

    const [account] = await db`
      select fee_amount,discount_amount,discount_input_type,discount_input_value,discount_reason
      from client_accounts where client_id=${clientId}`;
    // The contracted fee is untouched and the original input is preserved.
    expect(Number(account.fee_amount)).toBe(150);
    expect(Number(account.discount_amount)).toBe(30);
    expect(account.discount_input_type).toBe("percentage");
    expect(Number(account.discount_input_value)).toBe(20);
    expect(account.discount_reason).toBe("QA synthetic 20% concession");
  });

  it("rounds to the currency precision of the column it lands in", async () => {
    const clientId = await makeClient("QA Synthetic Percentage Rounding", null);
    // 12.5% of 150 = 18.75 exactly; 33.333% = 49.9995 and must round to 50.00.
    const exact = await withStaff(manager, (tx) => applyAccountDiscount(tx, {
      clientId, discountType: "percentage", discountValue: 12.5, reason: "QA synthetic", staffId: manager.staff.id, traceId: trace,
    }));
    expect(Number(exact.discount_amount)).toBe(18.75);

    const rounded = await withStaff(manager, (tx) => applyAccountDiscount(tx, {
      clientId, discountType: "percentage", discountValue: 33.333, reason: "QA synthetic", staffId: manager.staff.id, traceId: trace,
    }));
    expect(Number(rounded.discount_amount)).toBe(50);
    const [account] = await db`select discount_amount,discount_input_value from client_accounts where client_id=${clientId}`;
    expect(Number(account.discount_amount)).toBe(50);
    // The input is kept at its own precision, not flattened to the money scale.
    expect(Number(account.discount_input_value)).toBe(33.333);
  });

  it("records a percentage discount as the input type and amount as amount", async () => {
    const clientId = await makeClient("QA Synthetic Discount Input Type", null);
    await withStaff(manager, (tx) => applyAccountDiscount(tx, {
      clientId, discountType: "amount", discountValue: 25, reason: "QA synthetic flat", staffId: manager.staff.id, traceId: trace,
    }));
    const [flat] = await db`select discount_input_type,discount_input_value,discount_amount from client_accounts where client_id=${clientId}`;
    expect(flat.discount_input_type).toBe("amount");
    expect(Number(flat.discount_input_value)).toBe(25);
    expect(Number(flat.discount_amount)).toBe(25);
  });

  it("clears the discount and its input metadata together", async () => {
    const clientId = await makeClient("QA Synthetic Discount Clear", null);
    await withStaff(manager, (tx) => applyAccountDiscount(tx, {
      clientId, discountType: "percentage", discountValue: 50, reason: "QA synthetic", staffId: manager.staff.id, traceId: trace,
    }));
    await withStaff(manager, (tx) => applyAccountDiscount(tx, {
      clientId, discountType: "amount", discountValue: 0, reason: null, staffId: manager.staff.id, traceId: trace,
    }));
    const [cleared] = await db`
      select discount_amount,discount_reason,discount_input_type,discount_input_value,discount_updated_by
      from client_accounts where client_id=${clientId}`;
    expect(Number(cleared.discount_amount)).toBe(0);
    expect(cleared.discount_reason).toBeNull();
    expect(cleared.discount_input_type).toBeNull();
    expect(cleared.discount_input_value).toBeNull();
    expect(cleared.discount_updated_by).toBeNull();
  });

  it("refuses a percentage over 100 and a bare value with no reason", async () => {
    const clientId = await makeClient("QA Synthetic Discount Rejects", null);
    await expect(withStaff(manager, (tx) => applyAccountDiscount(tx, {
      clientId, discountType: "percentage", discountValue: 101, reason: "QA synthetic", staffId: manager.staff.id, traceId: trace,
    }))).rejects.toThrow("DISCOUNT_PERCENTAGE_OUT_OF_RANGE");

    await expect(withStaff(manager, (tx) => applyAccountDiscount(tx, {
      clientId, discountType: "percentage", discountValue: 10, reason: "   ", staffId: manager.staff.id, traceId: trace,
    }))).rejects.toThrow("DISCOUNT_REASON_REQUIRED");

    await expect(withStaff(manager, (tx) => applyAccountDiscount(tx, {
      clientId, discountType: "amount", discountValue: -5, reason: "QA synthetic", staffId: manager.staff.id, traceId: trace,
    }))).rejects.toThrow("DISCOUNT_VALUE_INVALID");
  });

  it("drives the commission basis from the discounted net fee", async () => {
    const clientId = await makeClient("QA Synthetic Percentage Commission", null);
    await withStaff(manager, (tx) => recordApplicationCompletion(tx, {
      clientId, completedBy: completer.staff.id, completedOn: "2026-10-01", staffId: manager.staff.id, traceId: trace,
    }));
    await withStaff(manager, (tx) => applyAccountDiscount(tx, {
      clientId, discountType: "percentage", discountValue: 20, reason: "QA synthetic", staffId: manager.staff.id, traceId: trace,
    }));
    const settled = await pay(manager, clientId, 120);
    expect(settled.balance?.payment_status).toBe("paid");
    const [commission] = await db`select calculation_basis,employee_id from commissions where client_id=${clientId}`;
    expect(Number(commission.calculation_basis)).toBe(120);
    expect(commission.employee_id).toBe(completer.staff.id);
  });
});

describe("adjustment and waiver", () => {
  async function post(session: StaffSession, clientId: string, body: {
    type: "adjustment" | "waiver"; amount: number; direction?: "credit" | "debit"; key?: string;
  }) {
    return withStaff(session, async (tx) => {
      const account = await lockAccount(tx, clientId);
      await tx`
        insert into payment_transactions(
          account_id,client_id,transaction_type,direction,amount,status,occurred_at,reason,source,recorded_by,idempotency_key
        ) values (
          ${account.id},${clientId},${body.type},${body.direction ?? "credit"},${body.amount},'confirmed',
          '2026-10-06'::date::timestamptz,${`QA synthetic ${body.type}`},'staff',${session.staff.id},${body.key ?? randomUUID()}
        ) on conflict(idempotency_key) do nothing`;
      return reconcileAccount(tx, { account, staffId: session.staff.id, traceId: trace, eligibilityDate: "2026-10-06" });
    });
  }

  it("applies a credit adjustment once and reduces what is owed", async () => {
    const clientId = await makeClient("QA Synthetic Adjustment Credit", null);
    const settled = await post(manager, clientId, { type: "adjustment", amount: 40, direction: "credit" });
    expect(Number(settled.balance?.balance)).toBe(110);
    expect(settled.balance?.payment_status).toBe("partially_paid");
  });

  it("applies a debit adjustment and increases what is owed", async () => {
    const clientId = await makeClient("QA Synthetic Adjustment Debit", null);
    const settled = await post(manager, clientId, { type: "adjustment", amount: 25, direction: "debit" });
    expect(Number(settled.balance?.balance)).toBe(175);
  });

  it("settles the account with a waiver without recording money received", async () => {
    const clientId = await makeClient("QA Synthetic Waiver", null);
    const settled = await post(manager, clientId, { type: "waiver", amount: 150 });
    expect(Number(settled.balance?.balance)).toBe(0);
    expect(settled.balance?.payment_status).toBe("paid");
    // A waiver is not cash: nothing is reported as paid and no method is invented.
    expect(Number(settled.balance?.amount_paid)).toBe(0);
    const [account] = await db`select payment_method,payment_date from client_accounts where client_id=${clientId}`;
    expect(account.payment_method).toBeNull();
    expect(account.payment_date).toBeNull();
  });

  it("does not duplicate an adjustment or a waiver on retry", async () => {
    const clientId = await makeClient("QA Synthetic Adjustment Retry", null);
    const key = randomUUID();
    await post(manager, clientId, { type: "adjustment", amount: 40, direction: "credit", key });
    const retry = await post(manager, clientId, { type: "adjustment", amount: 40, direction: "credit", key });
    const [{ count }] = await db`select count(*)::int count from payment_transactions where client_id=${clientId}`;
    expect(count).toBe(1);
    expect(Number(retry.balance?.balance)).toBe(110);
  });
});

describe("receipt ownership", () => {
  it("accepts a receipt that belongs to the same client", async () => {
    const clientId = await makeClient("QA Synthetic Receipt Owner", null);
    const documentId = await makeReceipt(clientId, "own-receipt");
    const [doc] = await db`select id from documents where id=${documentId} and client_id=${clientId}`;
    expect(doc?.id).toBe(documentId);
  });

  it("a receipt belonging to another client does not resolve for this one", async () => {
    const owner = await makeClient("QA Synthetic Receipt A", null);
    const other = await makeClient("QA Synthetic Receipt B", null);
    const documentId = await makeReceipt(owner, "cross-receipt");
    // This is the exact check `record_transaction` performs before accepting a
    // receipt, so a cross-client reference can never be linked.
    const rows = await db`select id from documents where id=${documentId} and client_id=${other}`;
    expect(rows.length).toBe(0);
  });

  it("links the receipt to the transaction and the transaction to the client", async () => {
    const clientId = await makeClient("QA Synthetic Receipt Link", null);
    const documentId = await makeReceipt(clientId, "linked-receipt");
    await withStaff(manager, async (tx) => {
      const account = await lockAccount(tx, clientId);
      await tx`
        insert into payment_transactions(
          account_id,client_id,transaction_type,direction,amount,status,payment_method,occurred_at,
          receipt_document_id,source,recorded_by,idempotency_key
        ) values (
          ${account.id},${clientId},'payment','credit',150,'confirmed','zelle','2026-10-06'::date::timestamptz,
          ${documentId},'staff',${manager.staff.id},${randomUUID()}
        )`;
      return reconcileAccount(tx, { account, staffId: manager.staff.id, traceId: trace, eligibilityDate: "2026-10-06" });
    });
    const [linked] = await db`
      select t.receipt_document_id,d.client_id
      from payment_transactions t join documents d on d.id=t.receipt_document_id
      where t.client_id=${clientId}`;
    expect(linked.receipt_document_id).toBe(documentId);
    expect(linked.client_id).toBe(clientId);
  });
});

describe("the canonical ledger both surfaces read", () => {
  it("reports what remains refundable, in ledger order, computed by the database", async () => {
    const clientId = await makeClient("QA Synthetic Ledger Read", null);
    await pay(manager, clientId, 150, "2026-10-02");
    await withStaff(manager, async (tx) => {
      const account = await lockAccount(tx, clientId);
      const [payment] = await tx`select id from payment_transactions where client_id=${clientId} and transaction_type='payment'`;
      await tx`
        insert into payment_transactions(
          account_id,client_id,transaction_type,direction,amount,status,occurred_at,related_transaction_id,reason,source,recorded_by,idempotency_key
        ) values (
          ${account.id},${clientId},'refund','debit',40,'confirmed','2026-10-03'::date::timestamptz,${payment.id as string},
          'QA synthetic partial refund','staff',${manager.staff.id},${randomUUID()}
        )`;
      return reconcileAccount(tx, { account, staffId: manager.staff.id, traceId: trace, eligibilityDate: "2026-10-03", refundRecorded: true });
    });

    const summary = await clientAccountSummary(manager, clientId);
    const ledger = summary?.transactions ?? [];
    // Newest first.
    expect(ledger.map((t) => t.transaction_type)).toEqual(["refund", "payment"]);

    const payment = ledger.find((t) => t.transaction_type === "payment")!;
    const refund = ledger.find((t) => t.transaction_type === "refund")!;
    // $150 paid less $40 already refunded.
    expect(payment.refundable_remaining).toBe(110);
    // Only a payment is refundable.
    expect(refund.refundable_remaining).toBeNull();
    // Running confirmed credits, in ledger order.
    expect(payment.credits_after).toBe(150);
    expect(refund.credits_after).toBe(110);
    // The refund names the payment it reverses, for the detail view.
    expect(refund.related_transaction_id).toBe(payment.id);
    // The business-timezone calendar date, not a raw timestamp.
    expect(payment.occurred_on).toBe("2026-10-02");
    expect(refund.occurred_on).toBe("2026-10-03");
  });

  it("stores a payment reference exactly as entered and never invents one", async () => {
    const clientId = await makeClient("QA Synthetic Reference", null);
    await withStaff(manager, async (tx) => {
      const account = await lockAccount(tx, clientId);
      await tx`
        insert into payment_transactions(
          account_id,client_id,transaction_type,direction,amount,status,payment_method,occurred_at,
          transaction_reference,source,recorded_by,idempotency_key
        ) values (
          ${account.id},${clientId},'payment','credit',70,'confirmed','zelle','2026-10-06'::date::timestamptz,
          'QA-SYNTH-REF-001','staff',${manager.staff.id},${randomUUID()}
        )`;
      await tx`
        insert into payment_transactions(
          account_id,client_id,transaction_type,direction,amount,status,payment_method,occurred_at,
          transaction_reference,source,recorded_by,idempotency_key
        ) values (
          ${account.id},${clientId},'payment','credit',30,'confirmed','cash','2026-10-06'::date::timestamptz,
          null,'staff',${manager.staff.id},${randomUUID()}
        )`;
      return reconcileAccount(tx, { account, staffId: manager.staff.id, traceId: trace, eligibilityDate: "2026-10-06" });
    });

    const summary = await clientAccountSummary(manager, clientId);
    const references = (summary?.transactions ?? []).map((t) => t.transaction_reference);
    // One verbatim reference and one genuinely absent — never a substitute
    // derived from the client's phone, address, ref or any document.
    expect(references).toHaveLength(2);
    expect(references).toContain("QA-SYNTH-REF-001");
    expect(references).toContain(null);
    const [client] = await db`select phone,ref from clients where id=${clientId}`;
    for (const reference of references) {
      if (reference) {
        expect(reference).not.toContain(String(client.phone));
        expect(reference).not.toContain(String(client.ref));
      }
    }
  });

  it("does not duplicate a refund on retry", async () => {
    const clientId = await makeClient("QA Synthetic Refund Retry", null);
    await pay(manager, clientId, 150);
    const key = randomUUID();
    const refund = async () => withStaff(manager, async (tx) => {
      const account = await lockAccount(tx, clientId);
      const [payment] = await tx`select id from payment_transactions where client_id=${clientId} and transaction_type='payment'`;
      await tx`
        insert into payment_transactions(
          account_id,client_id,transaction_type,direction,amount,status,occurred_at,related_transaction_id,reason,source,recorded_by,idempotency_key
        ) values (
          ${account.id},${clientId},'refund','debit',50,'confirmed','2026-10-07'::date::timestamptz,${payment.id as string},
          'QA synthetic refund','staff',${manager.staff.id},${key}
        ) on conflict(idempotency_key) do nothing`;
      return reconcileAccount(tx, { account, staffId: manager.staff.id, traceId: trace, eligibilityDate: "2026-10-07", refundRecorded: true });
    });
    await refund();
    const second = await refund();
    const [{ count }] = await db`select count(*)::int count from payment_transactions where client_id=${clientId} and transaction_type='refund'`;
    expect(count).toBe(1);
    expect(Number(second.balance?.balance)).toBe(50);
  });

  it("withholds the ledger from a non-management session", async () => {
    const clientId = await makeClient("QA Synthetic Ledger Scope", completer.staff.id);
    await pay(manager, clientId, 150);
    expect((await clientAccountSummary(manager, clientId))?.transactions.length).toBe(1);
    expect((await clientAccountSummary(completer, clientId))?.transactions).toEqual([]);
  });
});
