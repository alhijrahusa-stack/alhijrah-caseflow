import { expect, test } from "@playwright/test";
import { db, intakeBody, signIn, submitIntake } from "./helpers";

test.describe("Amazon Account Workspace", () => {
  test("adds an encrypted vault email, assigns exact client, marks ready and exposes no plaintext before reveal", async ({ page, request, baseURL }) => {
    const name = `TEST Amazon UI ${Date.now()}`;
    const { json } = await submitIntake(request, intakeBody(name));
    expect(json.ok).toBeTruthy();
    await signIn(page.context(), baseURL!, "admin");
    await page.goto("/staff/amazon-account");
    await expect(page.getByTestId("amazon-account-workspace")).toBeVisible();
    await expect(page.getByText("AMAZON EMAIL VAULT", { exact: true }).first()).toBeVisible();

    const email = `vault-${Date.now()}@gmail.com`;
    const password = "UI-Secret-Password-123";
    const pin = "765432";
    await page.getByRole("button", { name: /ADD EMAIL/ }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByLabel("PIN").fill(pin);
    await page.getByRole("button", { name: /SAVE/ }).click();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(password);
    await expect(page.locator("body")).not.toContainText(pin);

    await page.getByRole("tab", { name: "AMAZON ACCOUNTS" }).click();
    await page.getByRole("button", { name: /CREATE \/ ASSIGN ACCOUNT/ }).click();
    await page.getByLabel("Amazon email").selectOption({ label: email });
    await page.getByLabel("Assigned To").fill(name);
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await page.getByRole("button", { name: /CONFIRM ASSIGNMENT/ }).click();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await expect(page.getByText("PENDING", { exact: true })).toBeVisible();

    const [account] = await db()`select a.id,a.assigned_to_client_id,a.password_ciphertext,a.pin_ciphertext from amazon_accounts a join clients c on c.id=a.assigned_to_client_id where c.full_name=${name}`;
    expect(account.password_ciphertext).not.toContain(password);
    expect(account.pin_ciphertext).not.toContain(pin);

    await page.getByRole("link", { name: "Open Client" }).click();
    await expect(page.getByTestId("amazon-account-card")).toContainText(email);
    await page.getByRole("button", { name: /MARK READY/ }).click();
    await expect(page.getByTestId("amazon-account-card")).toContainText("READY");
    await page.getByTestId("amazon-account-card").getByRole("button", { name: "Reveal" }).first().click();
    await expect(page.getByTestId("amazon-account-card")).toContainText(password);
  });
});
