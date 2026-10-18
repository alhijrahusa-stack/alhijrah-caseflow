import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { db, intakeBody, RUN, signIn, submitIntake } from "./helpers";

test("client appointment actions surface across staff pages without enabling audio", async ({ browser, request, baseURL }) => {
  const name = `TEST Staff Alert ${RUN} ${randomUUID().slice(0, 8)}`;
  const created = await submitIntake(request, intakeBody(name));
  expect(created.res.status(), JSON.stringify(created.json)).toBe(201);
  const [client] = await db()`select id from clients where ref = ${String(created.json.ref)}`;
  expect(client?.id).toBeTruthy();

  const sql = db();
  const [event] = await sql`
    insert into activity_log (client_id, action, staff_id, entity_type, entity_id, new_value, trace_id)
    values (${client.id}, 'appointment_updated', null, 'appointment', null,
      ${sql.json({ client_action: "confirm", appointment_at: new Date().toISOString() })}, ${randomUUID()})
    returning id`;
  expect(event?.id).toBeTruthy();

  const context = await browser.newContext({ baseURL });
  await signIn(context, baseURL!, "admin");
  const page = await context.newPage();
  try {
    await page.goto("/staff");
    const bell = page.getByRole("button", { name: /Appointment alerts, [1-9]/ });
    await expect(bell).toBeVisible({ timeout: 15_000 });
    await bell.click();
    const inbox = page.getByRole("region", { name: "Appointment notification inbox" });
    await expect(inbox.getByText(name)).toBeVisible();
    await expect(inbox.getByRole("link", { name: new RegExp(`Appointment acknowledged.*${name}`) })).toBeVisible();
    await inbox.getByRole("button", { name: /Mark all read/ }).click();
    await expect(page.getByRole("button", { name: "Appointment alerts, 0 unread" })).toBeVisible();
    await page.goto("/staff/appointments");
    await expect(page.getByRole("button", { name: "Appointment alerts, 0 unread" })).toBeVisible();
    await page.getByRole("button", { name: "Appointment alerts, 0 unread" }).click();
    await expect(page.getByRole("region", { name: "Appointment notification inbox" }).getByText(name)).toBeVisible();
  } finally {
    await context.close();
  }
});
