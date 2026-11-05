import { expect, test } from "@playwright/test";
import { db, intakeBody, RUN, signIn, STAFF, submitIntake } from "./helpers";

/**
 * Preferred location changes in place on the client page: search, pick, save.
 * The new site shows at once, and the pipeline row and activity log follow
 * from the same transaction.
 */

async function newClient(request: Parameters<typeof submitIntake>[0], label: string) {
  const intake = await submitIntake(request, intakeBody(`TEST QLE ${label} ${RUN}`));
  expect(intake.res.status(), JSON.stringify(intake.json)).toBe(201);
  const [client] = await db()`select id from clients where ref = ${intake.json.ref}`;
  return String(client.id);
}

test("a manager changes the preferred location from the client page; pipeline and activity follow", async ({ page, context, request, baseURL }) => {
  const clientId = await newClient(request, "Move");
  const [before] = await db()`select site_code, shift_code from client_preferences where client_id = ${clientId} and rank = 'primary' order by preference_order limit 1`;
  await signIn(context, baseURL!, "admin");
  await page.goto(`/staff/client/${clientId}`);

  const value = page.getByTestId("preferred-location-value");
  const trigger = page.getByRole("button", { name: "Change preferred location" });
  await trigger.click();
  const editor = page.getByRole("dialog", { name: "Preferred location" });
  const search = editor.getByRole("combobox", { name: "Search locations" });
  await expect(search).toBeFocused();
  await search.fill("lans");
  await expect(editor.getByRole("option")).toHaveCount(1);
  await search.press("Enter");
  await expect(editor.getByRole("option", { name: /Lansing/ })).toHaveAttribute("aria-selected", "true");
  if (!before) await editor.getByLabel("Night Shift").check();
  await editor.getByRole("button", { name: "Save" }).click();

  await expect(editor).toHaveCount(0);
  await expect(value).toHaveText("Lansing");
  await expect(trigger).toBeFocused();
  await expect.poll(async () => (await db()`select site_code, site_name from client_preferences where client_id = ${clientId} and rank = 'primary' order by preference_order limit 1`)[0])
    .toMatchObject({ site_code: "MI_LOC_03", site_name: "Lansing" });
  if (before) {
    const [after] = await db()`select shift_code from client_preferences where client_id = ${clientId} and rank = 'primary' order by preference_order limit 1`;
    expect(after.shift_code).toBe(before.shift_code);
  }
  const [log] = await db()`select new_value from activity_log where client_id = ${clientId} and action = 'client_updated' order by created_at desc limit 1`;
  expect(log.new_value).toMatchObject({ preferred_location: "Lansing", site: "MI_LOC_03" });

  await page.goto("/staff/pipeline");
  await page.getByRole("button", { name: "Location & Shift" }).click();
  const board = page.getByTestId("location-dispatcher").locator("article").filter({ has: page.getByRole("heading", { name: "Lansing", exact: true }) });
  await expect(board).toContainText(`TEST QLE Move ${RUN}`);
});

test("Escape closes the editor without saving, and a refused save puts the old location back", async ({ page, context, request, baseURL }) => {
  const clientId = await newClient(request, "Revert");
  await signIn(context, baseURL!, "admin");
  await page.goto(`/staff/client/${clientId}`);
  const value = page.getByTestId("preferred-location-value");
  const original = (await value.textContent()) ?? "";
  const trigger = page.getByRole("button", { name: "Change preferred location" });

  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Preferred location" })).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.route("**/api/staff/action", (route) => route.fulfill({ status: 409, json: { ok: false, error: { code: "stale_location", message: "This client's location was changed by someone else. Reopen it to see the current value." } } }));
  await trigger.click();
  const editor = page.getByRole("dialog", { name: "Preferred location" });
  await editor.getByRole("combobox", { name: "Search locations" }).fill("saginaw");
  await editor.getByRole("option", { name: /Saginaw/ }).click();
  const shift = editor.getByLabel("Night Shift");
  if (await shift.count()) await shift.check();
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("changed by someone else").first()).toBeVisible();
  await expect(value).toHaveText(original);
});

test("staff without management see the location but no editor", async ({ page, context, request, baseURL }) => {
  const clientId = await newClient(request, "Staff");
  const [staff] = await db()`select id from staff where auth_user_id = ${STAFF.staff}`;
  await db()`update clients set assigned_staff = ${staff.id} where id = ${clientId}`;
  await signIn(context, baseURL!, "staff");
  await page.goto(`/staff/client/${clientId}`);
  await expect(page.getByTestId("preferred-location-value")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change preferred location" })).toHaveCount(0);
});
