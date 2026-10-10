import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { accessToken, db, intakeBody, RUN, signIn, STAFF, submitIntake, uniqueIp } from "./helpers";

/**
 * The Client financial surface and the Accounting board, as an operator meets
 * them. These assert the interaction contract: nothing financial is open until
 * an action is chosen, a high-risk action asks once before committing, and the
 * confirmation an operator reads is the server's own result.
 */

async function post(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post("/api/staff/accounting", {
    data: body,
    headers: { cookie: `cg_at=${await accessToken("admin")}`, "x-forwarded-for": uniqueIp() },
  });
  const json = await res.json();
  expect(res.status(), JSON.stringify(json)).toBe(200);
  return json;
}

test.describe.serial("Accounting and Client financial surfaces", () => {
  let clientId = "";
  let page: Page;

  test.beforeAll(async ({ request, browser, baseURL }) => {
    const intake = await submitIntake(request, intakeBody(`TEST Accounting UI ${RUN}`));
    expect(intake.res.status(), JSON.stringify(intake.json)).toBe(201);
    const [client] = await db()`select id from clients where ref=${intake.json.ref}`;
    clientId = client.id as string;

    const ctx = await browser.newContext({ baseURL });
    await signIn(ctx, baseURL!, "admin");
    page = await ctx.newPage();

    const stage = await page.request.post("/api/staff/operations", {
      data: { operation: "move_stage", client_id: clientId, stage: "interview_passed" },
      headers: { cookie: `cg_at=${await accessToken("admin")}`, "x-forwarded-for": uniqueIp() },
    });
    expect(stage.status()).toBe(200);
  });

  test("the accounting row states the account and opens no financial form until asked", async () => {
    await page.goto(`/staff/accounting?client=${clientId}`);
    const row = page.getByTestId("account-row").first();
    await expect(row).toBeVisible();

    // Every figure the row must state.
    for (const field of ["row-status", "row-completed-by", "row-fee", "row-discount", "row-net-fee", "row-paid", "row-refunded", "row-outstanding", "row-commission-staff", "row-commission-amount", "row-commission-status"]) {
      await expect(row.getByTestId(field)).toBeVisible();
    }
    await expect(row.getByTestId("row-fee")).toHaveText("$150.00");
    await expect(row.getByTestId("row-net-fee")).toHaveText("$150.00");

    // The interaction defect this replaces: a transaction editor mounted open in
    // every row. Nothing financial is editable until an action is chosen.
    await expect(page.locator(".ops-account-editor")).toHaveCount(0);
    await expect(row.getByTestId("action-surface-payment")).toHaveCount(0);
    await expect(row.getByTestId("row-record-payment")).toBeVisible();
    await expect(row.getByTestId("row-view-client")).toBeVisible();
  });

  test("a payment recorded from Accounting confirms with the server's own result", async () => {
    await page.goto(`/staff/accounting?client=${clientId}`);
    const row = page.getByTestId("account-row").first();
    await row.getByTestId("row-record-payment").click();
    const surface = row.getByTestId("action-surface-payment");
    await expect(surface).toBeVisible();

    await surface.getByTestId("payment-amount").fill("60");
    await surface.getByTestId("payment-reference").fill("E2E-UI-PAY-1");
    await surface.getByTestId("submit-payment").click();

    const confirmation = page.getByTestId("canonical-confirmation");
    await expect(confirmation).toBeVisible();
    // The figures shown are the ones the server returned, not local arithmetic.
    await expect(confirmation.getByTestId("canonical-balance")).toHaveText("$90.00");
    await expect(confirmation.getByTestId("canonical-status")).toHaveText("partially paid");
    await expect(confirmation.getByTestId("canonical-reference")).toHaveText("E2E-UI-PAY-1");

    const [ledger] = await db()`select balance,payment_status from client_account_balances where client_id=${clientId}`;
    expect(Number(ledger.balance)).toBe(90);
    expect(ledger.payment_status).toBe("partially_paid");
  });

  test("a percentage discount previews before it is applied and the server decides the amount", async () => {
    await page.goto(`/staff/accounting?client=${clientId}`);
    const row = page.getByTestId("account-row").first();
    await row.getByTestId("row-more").click();
    await row.getByTestId("row-discount-action").click();

    const surface = row.getByTestId("action-surface-discount");
    await surface.getByTestId("discount-type").selectOption("percentage");
    await surface.getByTestId("discount-value").fill("20");
    await surface.getByTestId("discount-reason").fill("E2E UI percentage");
    // The preview is labelled as one and names the server as the authority.
    await expect(surface.getByTestId("discount-preview")).toContainText("$30.00");
    await expect(surface.getByTestId("discount-preview")).toContainText("server recalculates");

    await surface.getByTestId("submit-discount").click();
    const confirmation = page.getByTestId("canonical-confirmation");
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByTestId("canonical-discount-input")).toHaveText("20%");

    const [account] = await db()`select discount_amount,discount_input_type,discount_input_value from client_accounts where client_id=${clientId}`;
    expect(Number(account.discount_amount)).toBe(30);
    expect(account.discount_input_type).toBe("percentage");
    expect(Number(account.discount_input_value)).toBe(20);
  });

  test("a refund names the payment it reverses and asks once before committing", async () => {
    await page.goto(`/staff/accounting?client=${clientId}`);
    const row = page.getByTestId("account-row").first();
    await row.getByTestId("row-more").click();
    await row.getByTestId("row-refund").click();

    const surface = row.getByTestId("action-surface-refund");
    // The original payment is chosen from its own details, never a pasted UUID.
    const original = surface.getByTestId("refund-original");
    await expect(original).toBeVisible();
    await expect(original.locator("option").first()).toContainText("$60.00");
    await expect(original.locator("option").first()).toContainText("refundable");

    // More than remains refundable is refused before any request is sent.
    await surface.getByTestId("refund-amount").fill("500");
    await surface.getByTestId("refund-reason").fill("E2E over-refund");
    await surface.getByTestId("submit-refund").click();
    await expect(surface.getByTestId("action-error")).toContainText("still refundable");
    await expect(page.getByTestId("high-risk-confirmation")).toHaveCount(0);

    // A valid refund asks for one explicit confirmation naming the effect.
    await surface.getByTestId("refund-amount").fill("20");
    await surface.getByTestId("submit-refund").click();
    const confirm = surface.getByTestId("high-risk-confirmation");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("$20.00");
    await expect(confirm).toContainText("original payment is kept");

    await surface.getByTestId("submit-refund").click();
    await expect(page.getByTestId("canonical-confirmation")).toBeVisible();

    const [{ n }] = await db()`select count(*)::int n from payment_transactions where client_id=${clientId} and transaction_type='refund'`;
    expect(n).toBe(1);
  });

  test("the ledger loads on demand and each transaction opens its own detail", async () => {
    await page.goto(`/staff/accounting?client=${clientId}`);
    const row = page.getByTestId("account-row").first();
    await expect(row.getByTestId("transaction-history")).toHaveCount(0);

    await row.getByTestId("row-more").click();
    await row.getByTestId("row-ledger").click();
    const history = row.getByTestId("transaction-history");
    await expect(history).toBeVisible();

    // Latest first: the refund precedes the payment.
    const rows = history.getByTestId("ledger-row");
    await expect(rows.first()).toContainText("Refund");

    await rows.first().click();
    const detail = history.getByTestId("transaction-detail");
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId("detail-credits-after")).toHaveText("$40.00");
    await expect(detail).toContainText("Against payment");
  });

  test("the client file shows the same account and opens Accounting in its context", async () => {
    await page.goto(`/staff/client/${clientId}`);
    const accountToggle = page.getByRole("button", { name: /Client Account/ });
    await expect(accountToggle).toHaveAttribute("aria-expanded", "false");
    await accountToggle.click();
    await expect(accountToggle).toHaveAttribute("aria-expanded", "true");
    const panel = page.getByTestId("client-account-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("account-fee")).toHaveText("$150.00");
    // The same canonical figures the Accounting board renders.
    await expect(panel.getByTestId("account-discount")).toContainText("$30.00");
    await expect(panel.getByTestId("account-discount")).toContainText("20%");
    await expect(panel.getByTestId("account-net-fee-figure")).toHaveText("$120.00");
    await expect(panel.getByTestId("account-balance")).toHaveText("$80.00");
    await expect(panel.getByTestId("transaction-history")).toBeVisible();

    await expect(panel.getByTestId("action-surface-payment")).toHaveCount(0);
    await panel.getByTestId("action-record-payment").click();
    await expect(panel.getByTestId("action-surface-payment")).toBeVisible();

    await expect(panel.getByTestId("open-accounting")).toHaveAttribute("href", `/staff/accounting?client=${clientId}`);
  });

  test("application completion is recorded from the client file and owns the commission", async () => {
    const [staff] = await db()`select id,display_name from staff where auth_user_id=${STAFF.staff}`;
    await post(page, {
      operation: "record_application_completion",
      client_id: clientId,
      completed_by: staff.id,
      completed_on: new Date().toISOString().slice(0, 10),
    });

    await page.goto(`/staff/client/${clientId}`);
    const accountToggle = page.getByRole("button", { name: /Client Account/ });
    await accountToggle.click();
    const panel = page.getByTestId("client-account-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("account-application")).toContainText(String(staff.display_name));

    // Settle whatever the account still owes, read from the authoritative
    // balance rather than assumed, then check who earns the commission.
    const [before] = await db()`select balance from client_account_balances where client_id=${clientId}`;
    const outstanding = Number(before.balance);
    expect(outstanding).toBeGreaterThan(0);
    const settled = await post(page, {
      operation: "record_transaction", client_id: clientId, transaction_type: "payment", direction: null,
      amount: outstanding, payment_method: "cash", occurred_on: new Date().toISOString().slice(0, 10),
      transaction_reference: null, receipt_document_id: null, related_transaction_id: null,
      reason: "E2E settle", idempotency_key: randomUUID(),
    });
    expect(settled.balance.payment_status).toBe("paid");

    // The commission belongs to the completer, not the admin operating this screen.
    const [commission] = await db()`select employee_id from commissions where client_id=${clientId}`;
    expect(commission?.employee_id).toBe(staff.id);
    const [admin] = await db()`select id from staff where auth_user_id=${STAFF.admin}`;
    expect(commission.employee_id).not.toBe(admin.id);
  });
});
