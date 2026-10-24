import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { db, signIn, staffAction } from "./helpers";

test("staff shared phone persists distinct files, shows review alert and protects corroborated identity", async ({ page, baseURL }) => {
  await signIn(page.context(), baseURL!, "admin");
  const token = randomUUID().slice(0, 8);
  const phone = `313${Date.now().toString().slice(-7)}`;
  const create = (full_name: string, date_of_birth: string) => staffAction(page.request, "admin", {
    action: "create_client", profile: { full_name, phone, date_of_birth, employment_history: [] },
    status: "new_intake", primary: [], backup: [],
  });
  const first = await create(`TEST Phone Alpha ${token}`, "1980-01-01");
  expect(first.status, JSON.stringify(first.json)).toBe(200);
  const name = `TEST Phone Beta ${token}`;
  const second = await create(name, "1995-02-02");
  expect(second.status, JSON.stringify(second.json)).toBe(200);
  const id = second.json.client_id;
  await expect.poll(async () => (await db()`select count(*)::int n from audit_alerts
    where client_id=${id} and rule='identity_review_shared_phone' and status='open'`)[0].n).toBe(1);
  await page.goto(`/staff/client/${id}`);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByText("Another active file uses the same phone. Phone alone does not identify an applicant and does not block staff creation.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await signIn(page.context(), baseURL!, "admin");
  await page.reload();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const repeat = await create(name, "1995-02-02");
  expect(repeat.status).toBe(409);
  const [count] = await db()`select count(*)::int n from clients where phone=${phone}`;
  expect(count.n).toBe(2);
  const forbidden = await staffAction(page.request, "staff", {
    action: "patch_client", client_id: id, field: "full_name", value: "Unauthorized change",
  });
  expect(forbidden.status).toBe(403);
});
