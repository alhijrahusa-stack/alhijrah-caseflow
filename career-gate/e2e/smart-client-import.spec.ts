import { expect, test } from "@playwright/test";
import { db, signIn, STAFF } from "./helpers";

test.describe("Smart Career Collect Client", () => {
  test("stages a sheet, reviews missing documents, approves once, and creates the canonical Client", async ({ page, baseURL }) => {
    const token = Date.now().toString().slice(-7);
    const name = `TEST Smart Collect ${token}`;
    const phone = `313${token}`.slice(0, 10).padEnd(10, "7");
    const email = `smart.collect.${token}@test.invalid`;
    const [admin] = await db()`select id,display_name from staff where auth_user_id=${STAFF.admin}`;
    expect(admin?.id).toBeTruthy();

    await signIn(page.context(), baseURL!, "admin");
    await page.goto("/staff/import");
    await expect(page.getByRole("heading", { name: "SMART CAREER COLLECT CLIENT" })).toBeVisible();

    const csv = `full_name,phone,email\n${name},${phone},${email}\n`;
    await page.locator('input[type="file"]').first().setInputFiles({ name: "smart-import.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "PREVIEW" }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("VALID", { exact: true }).first()).toBeVisible();

    const stageResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/staff/universal-intake",
    );
    await page.getByRole("button", { name: /STAGE SELECTED CASES/ }).click();
    const stageResponse = await stageResponsePromise;
    expect(stageResponse.status(), await stageResponse.text()).toBe(201);
    await expect(page.getByText("1 import case staged.", { exact: true })).toBeVisible();

    const [staged] = await db()`
      select id,status,mapped_draft #>> '{profile,full_name}' as full_name
      from client_import_cases
      where mapped_draft #>> '{profile,full_name}'=${name}
      order by created_at desc
      limit 1`;
    expect(staged?.status).toBe("PENDING");
    expect(staged?.full_name).toBe(name);

    const queueResponse = await page.request.get(`${baseURL}/api/staff/smart-client-import`);
    expect(queueResponse.status(), await queueResponse.text()).toBe(200);
    const queuePayload = await queueResponse.json();
    expect(queuePayload.rows.some((row: { id: string }) => row.id === staged.id)).toBe(true);

    const importQueue = page.getByRole("heading", { name: "IMPORT QUEUE" }).locator("xpath=ancestor::section[1]");
    const queueRow = importQueue.getByRole("row").filter({ hasText: name }).first();
    await expect(queueRow).toBeVisible();
    await queueRow.getByRole("button", { name: "OPEN / REVIEW" }).click();
    await expect(page.getByText("SMART CLIENT REVIEW", { exact: true })).toBeVisible();

    await page.locator(".staff-picker-trigger").click();
    await page.getByRole("option", { name: new RegExp(String(admin.display_name)) }).click();
    await page.getByRole("button", { name: "REVIEW" }).click();
    await page.getByRole("button", { name: "CHECK & VERIFY" }).click();
    await expect(page.getByText("MISSING DOCUMENT", { exact: true }).last()).toBeVisible();

    await page.getByText("CURRENT DOCUMENT STATUS REVIEWED", { exact: true }).click();
    await page.getByText("INFORMATION MATCH CONFIRMED", { exact: true }).click();
    await page.getByRole("button", { name: "APPROVE FILE" }).click();
    await expect(page).toHaveURL(/\/staff\/client\/[0-9a-f-]+$/);

    const [client] = await db()`select id,full_name,email from clients where full_name=${name} and deleted_at is null`;
    expect(client?.email).toBe(email);
    const [approved] = await db()`select status,created_client_id from client_import_cases where created_client_id=${client.id}`;
    expect(approved?.status).toBe("APPROVED_FILE");
    const [followup] = await db()`select count(*)::int as n from tasks where client_id=${client.id} and title='Collect missing client documents'`;
    expect(Number(followup.n)).toBe(1);
  });

  test("mobile route is protected and preserves the login return path", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/staff/smart-client-import/new");
    await expect(page).toHaveURL(/\/staff\/login\?next=%2Fstaff%2Fsmart-client-import%2Fnew/);
  });
});
