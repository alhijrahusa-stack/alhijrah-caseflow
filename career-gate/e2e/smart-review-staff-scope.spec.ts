import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { db, selectChoice, signIn, STAFF } from "./helpers";

test("manager assigns a staged file and its authorized reviewer approves missing documents with an audit reason", async ({ page, baseURL }) => {
  if (!["localhost", "127.0.0.1", "::1"].includes(new URL(baseURL!).hostname) || !["localhost", "127.0.0.1", "::1"].includes(new URL(process.env.DATABASE_URL!).hostname)) {
    throw new Error("This test must use an isolated loopback app and database");
  }
  const token = randomUUID().replace(/-/g, "");
  const name = `TEST Assigned ${token.slice(0, 10)}`;
  const phone = `313${String(parseInt(token.slice(0, 8), 16) % 10_000_000).padStart(7, "0")}`;
  const [reviewer] = await db()`select id,display_name from staff where auth_user_id=${STAFF.staff}`;
  await signIn(page.context(), baseURL!, "admin");
  const staged = await page.request.post("/api/staff/universal-intake", { data: { mode: "stage", source: "csv", idempotency_key: randomUUID(), rows: [{ full_name: name, phone }] } });
  expect(staged.status()).toBe(201);
  const json = await staged.json();
  const caseId = String(json.cases[0].id);
  await page.goto("/staff/import");
  await page.getByLabel("Search imports").fill(name);
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await selectChoice(row.getByRole("combobox", { name: `Assign reviewer for ${name}` }), String(reviewer.id));
  await row.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(row).toContainText(String(reviewer.display_name));
  await signIn(page.context(), baseURL!, "staff");
  await page.goto("/staff/import");
  await page.getByLabel("Search imports").fill(name);
  const assigned = page.getByRole("row").filter({ hasText: name });
  await expect(assigned).toBeVisible();
  await expect(page.getByRole("button", { name: /NEW IMPORT BY SHEET/ })).toHaveCount(0);
  await assigned.getByRole("button", { name: "OPEN / EDIT" }).click();
  await page.getByRole("button", { name: "APPROVE FILE" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const reason = "Documents due at next visit";
  await dialog.getByLabel(/Reason for approval/).fill(reason);
  await dialog.getByRole("button", { name: /Approve & defer missing items/i }).click();
  await expect(page.getByText(/Client approved and routed to Intake/)).toBeVisible();
  const [saved] = await db()`select created_client_id,verification_result from client_import_cases where id=${caseId}`;
  const [client] = await db()`select assigned_staff,current_status from clients where id=${saved.created_client_id}`;
  expect(client).toMatchObject({ assigned_staff: reviewer.id, current_status: "new_intake" });
  expect(saved.verification_result.override).toMatchObject({ reason, actor_id: reviewer.id });
  const [log] = await db()`select staff_id,new_value from activity_log where client_id=${saved.created_client_id} and entity_type='client_import_case' and entity_id=${caseId} and action='client_updated'`;
  expect(log.staff_id).toBe(reviewer.id);
  expect(log.new_value.override.reason).toBe(reason);
});
