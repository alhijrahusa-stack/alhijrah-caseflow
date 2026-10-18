import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { db, intakeBody, RUN, seedOtp, submitIntake } from "./helpers";

test("verified mobile status preserves appointment actions with concise, readable glass layout", async ({ page, request }) => {
  const name = `TEST Status Mobile ${RUN} ${randomUUID().slice(0, 8)}`;
  const submitted = await submitIntake(request, intakeBody(name));
  expect(submitted.res.status(), JSON.stringify(submitted.json)).toBe(201);
  const ref = String(submitted.json.ref);
  const sql = db();
  const [client] = await sql`select id from clients where ref = ${ref}`;
  expect(client?.id).toBeTruthy();

  const start = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const resource = `ui-${randomUUID()}`;
  await sql`
    insert into appointments (client_id, appointment_type, scheduled_at, ends_at, location, resource_key, status)
    values (${client.id}, 'Pre-hire appointment', ${start}, ${end}, 'Office Room B', ${resource}, 'scheduled')`;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/status?ref=${encodeURIComponent(ref)}`);
  await page.getByRole("button", { name: "Check Status" }).click();
  await expect(page.getByLabel("Verification code")).toBeVisible();

  const [challenge] = await sql`select id from otp_requests where client_id = ${client.id} order by created_at desc limit 1`;
  expect(await seedOtp(String(challenge.id), "432198")).toBe(true);
  await page.getByLabel("Verification code").fill("432198");
  await page.getByRole("button", { name: "Verify & View Status" }).click();
  await page.waitForURL(`**/status/${ref}`);

  const status = page.getByTestId("status-page");
  await expect(status).toBeVisible();
  await expect(status.getByTestId("status-current-status")).toContainText("New Intake");
  await expect(status.getByTestId("status-appointment-location")).toHaveText("Office Room B");
  await expect(status.getByRole("button", { name: /Confirm Appointment/ })).toBeVisible();
  await expect(status.getByText("File Details / تفاصيل الملف")).toBeVisible();
  await expect(status.getByText("File Updates / تحديثات الملف")).toBeVisible();
  await expect(status.getByText("Contact the office / تواصل معنا")).toHaveCount(0);

  const contrast = await page.locator("footer").locator("p").filter({ hasText: "ALHIJRAH" }).first().evaluate(element => {
    const match = getComputedStyle(element).color.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
    return Math.min(...match.slice(0, 3));
  });
  expect(contrast).toBeGreaterThan(150);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const actionResponse = page.waitForResponse(response =>
    response.url().endsWith("/api/status/appointment-action") && response.request().method() === "POST");
  await status.getByRole("button", { name: /Confirm Appointment/ }).click();
  const confirmed = await actionResponse;
  expect(confirmed.status(), await confirmed.text()).toBe(200);
  await expect(status.getByText("Acknowledged / تم التأكيد")).toBeVisible();
  await expect(status.getByRole("button", { name: /Confirm Appointment/ })).toHaveCount(0);
  await page.reload();
  await expect(status.getByText("Acknowledged / تم التأكيد")).toBeVisible();
  await expect(status.getByRole("button", { name: /Confirm Appointment/ })).toHaveCount(0);
  const [count] = await sql`
    select count(*)::int as total from activity_log
    where client_id = ${client.id} and action = 'appointment_updated'
      and new_value->>'client_action' = 'confirm'`;
  expect(count.total).toBe(1);

  await status.getByRole("button", { name: /Reschedule/ }).click();
  const dialog = page.getByRole("dialog", { name: "Request a new appointment" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("No available times / لا توجد مواعيد متاحة")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Send Reschedule Request/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close" }).click();
});
