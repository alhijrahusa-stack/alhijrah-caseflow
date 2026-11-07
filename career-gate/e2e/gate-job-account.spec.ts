import { expect, test } from "@playwright/test";
import { selectChoice, db, intakeBody, signIn, submitIntake } from "./helpers";

test.describe("Gate Job Account Workspace", () => {
  test("a delayed initial vault snapshot cannot replace the email and count after a successful save", async ({ page, baseURL }) => {
    await signIn(page.context(), baseURL!, "admin");
    let firstRequest: import("@playwright/test").Request | undefined;
    let initialAvailable = 0;
    let captured!: () => void;
    let release!: () => void;
    let delivered!: () => void;
    let deliveryError: unknown;
    const initialCaptured = new Promise<void>(resolve => { captured = resolve; });
    const holdInitial = new Promise<void>(resolve => { release = resolve; });
    const initialDelivered = new Promise<void>(resolve => { delivered = resolve; });
    const initialSettled = new Promise<void>(resolve => {
      const finish = (request: import("@playwright/test").Request) => {
        if (request !== firstRequest) return;
        page.off("requestfinished", finish); page.off("requestfailed", finish); resolve();
      };
      page.on("requestfinished", finish); page.on("requestfailed", finish);
    });
    await page.route("**/api/staff/gate-job-account/emails?**", async route => {
      if (firstRequest || route.request().method() !== "GET") return route.continue();
      firstRequest = route.request();
      const response = await route.fetch();
      const snapshot = await response.json();
      expect(response.status()).toBe(200);
      initialAvailable = Number(snapshot.counts.AVAILABLE);
      captured();
      await holdInitial;
      try { await route.fulfill({ response }); }
      catch (error) { if (!firstRequest.failure()) deliveryError = error; }
      finally { delivered(); }
    });
    try {
      await page.goto("/staff/gate-job-account");
      await initialCaptured;
      const vault = page.getByTestId("gate-job-email-vault");
      const email = `vault-race-${Date.now()}@gmail.com`;
      await vault.getByRole("button", { name: /ADD EMAIL/ }).click();
      const dialog = page.getByRole("dialog", { name: "ADD GATE JOB ACCOUNT EMAIL" });
      await dialog.getByLabel("Email", { exact: true }).fill(email);
      await dialog.getByLabel("Password", { exact: true }).fill("Race-Secret-Password-123");
      await dialog.getByLabel("PIN", { exact: true }).fill("765432");
      const [saved] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === "/api/staff/gate-job-account/emails" && response.request().method() === "POST"),
        dialog.getByRole("button", { name: /SAVE/ }).click(),
      ]);
      expect(saved.status(), await saved.text()).toBe(201);
      await expect(dialog).toBeHidden();
      await expect(vault.getByText(email, { exact: true })).toBeVisible();
      const available = vault.getByRole("button", { name: /^AVAILABLE/ }).first().locator("strong");
      await expect(available).toHaveText(String(initialAvailable + 1));

      release();
      await initialDelivered;
      await initialSettled;
      expect(deliveryError).toBeUndefined();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(vault.getByText(email, { exact: true })).toBeVisible();
      await expect(available).toHaveText(String(initialAvailable + 1));
      const [stored] = await db()`select status from gate_job_emails where email=${email}`;
      expect(stored.status).toBe("AVAILABLE");
    } finally { release(); }
  });

  test("adds an encrypted vault email, assigns exact client, marks ready and exposes no plaintext before reveal", async ({ page, request, baseURL }) => {
    const name = `TEST Gate Job UI ${Date.now()}`;
    const { json } = await submitIntake(request, intakeBody(name));
    expect(json.ok).toBeTruthy();
    await signIn(page.context(), baseURL!, "admin");
    await page.goto("/staff/gate-job-account");
    await expect(page.getByTestId("gate-job-account-workspace")).toBeVisible();
    await expect(page.getByText("GATE JOB EMAIL VAULT", { exact: true }).first()).toBeVisible();

    const email = `vault-${Date.now()}@gmail.com`;
    const password = "UI-Secret-Password-123";
    const pin = "765432";
    await page.getByRole("button", { name: /ADD EMAIL/ }).click();
    const addDialog = page.getByRole("dialog", { name: "ADD GATE JOB ACCOUNT EMAIL" });
    await addDialog.getByLabel("Email", { exact: true }).fill(email);
    await addDialog.getByLabel("Password", { exact: true }).fill(password);
    await addDialog.getByLabel("PIN", { exact: true }).fill(pin);
    const [saved] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === "/api/staff/gate-job-account/emails" && response.request().method() === "POST"),
      addDialog.getByRole("button", { name: /SAVE/ }).click(),
    ]);
    expect(saved.status(), await saved.text()).toBe(201);
    await expect(addDialog).toBeHidden();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(password);
    await expect(page.locator("body")).not.toContainText(pin);

    await page.getByRole("tab", { name: "GATE JOB ACCOUNTS" }).click();
    const accounts = page.getByTestId("gate-job-accounts");
    await accounts.getByRole("button", { name: /CREATE \/ ASSIGN ACCOUNT/ }).click();
    await selectChoice(accounts.getByLabel("Gate Job email", { exact: true }), { label: email });
    await accounts.getByLabel("Assigned To", { exact: true }).fill(name);
    await accounts.getByRole("button", { name: new RegExp(name) }).click();
    await accounts.getByRole("button", { name: /CONFIRM ASSIGNMENT/ }).click();
    const accountTable = accounts.getByRole("table");
    await expect(accountTable.getByText(email, { exact: true })).toBeVisible();
    await expect(accountTable.getByText("PENDING", { exact: true })).toBeVisible();

    const [account] = await db()`select a.id,a.assigned_to_client_id,a.password_ciphertext,a.pin_ciphertext from gate_job_accounts a join clients c on c.id=a.assigned_to_client_id where c.full_name=${name}`;
    expect(account.password_ciphertext).not.toContain(password);
    expect(account.pin_ciphertext).not.toContain(pin);

    await accountTable.getByRole("link", { name: "Open Client" }).click();
    const card = page.getByTestId("gate-job-account-card");
    await expect(card).toContainText(email);
    await card.getByRole("button", { name: /MARK READY/ }).click();
    await expect(card).toContainText("READY");
    await card.getByRole("button", { name: "Reveal" }).first().click();
    await expect(card).toContainText(password);
  });
});
