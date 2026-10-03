import { expect, test } from "@playwright/test";
import { db, intakeBody, signIn, submitIntake } from "./helpers";

test.describe("Gate Job Account Workspace", () => {
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
    await addDialog.getByRole("button", { name: /SAVE/ }).click();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(password);
    await expect(page.locator("body")).not.toContainText(pin);

    await page.getByRole("tab", { name: "GATE JOB ACCOUNTS" }).click();
    const accounts = page.getByTestId("gate-job-accounts");
    await accounts.getByRole("button", { name: /CREATE \/ ASSIGN ACCOUNT/ }).click();
    await accounts.getByLabel("Gate Job email", { exact: true }).selectOption({ label: email });
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
