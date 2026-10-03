import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const base = "http://127.0.0.1:3456";

test.describe("Smart Career Collect Client", () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, base, "manager");
  });

  test("stages a sheet row, reviews, verifies and approves exactly once", async ({ page }) => {
    const token = Date.now().toString().slice(-7);
    const name = `Smart Import ${token}`;
    const phone = `313${token.padStart(7, "0").slice(-7)}`;
    const csv = `full_name,phone,email\n${name},${phone},smart.${token}@test.invalid\n`;

    await page.goto("/staff/import");
    await expect(page.getByRole("heading", { name: "SMART CAREER COLLECT CLIENT" })).toBeVisible();
    await page.locator('input[type="file"]').first().setInputFiles({ name: "clients.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "STAGE IMPORT" }).click();
    await expect(page.getByText("VALID", { exact: true })).toBeVisible();

    const search = page.getByPlaceholder("Client / Phone / Email / Import ID");
    await search.fill(name);
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "REVIEW" }).last().click();

    await page.getByLabel("REVIEWED BY").selectOption({ index: 1 });
    await page.getByRole("button", { name: "REVIEW", exact: true }).last().click();
    await expect(page.getByRole("button", { name: "CHECK & VERIFY" })).toBeEnabled();
    await page.getByRole("button", { name: "CHECK & VERIFY" }).click();

    await page.getByText("CURRENT DOCUMENT STATUS REVIEWED").click();
    await page.getByText("INFORMATION MATCH CONFIRMED").click();
    await page.getByRole("button", { name: "SAVE CONFIRMATIONS" }).click();
    await expect(page.getByRole("button", { name: "APPROVE FILE" })).toBeEnabled();
    await page.getByRole("button", { name: "APPROVE FILE" }).click();
    await expect(page).toHaveURL(/\/staff\/client\/[0-9a-f-]+$/i);
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  });

  test("mobile internal intake returns to the same staging authority", async ({ page }) => {
    await page.goto("/staff/smart-client-import/new");
    await expect(page.getByRole("heading", { name: "SMART CLIENT IMPORT" })).toBeVisible();
    await page.getByLabel("CLIENT INFORMATION / NOTES").fill("Name unavailable in source. Review required.");
    await page.getByRole("button", { name: "SUBMIT" }).click();
    await expect(page.getByRole("heading", { name: "IMPORT RECEIVED" })).toBeVisible();
    await expect(page.getByText("STATUS: PENDING")).toBeVisible();
  });
});
