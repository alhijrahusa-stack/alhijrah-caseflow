import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { db, intakeBody, RUN, selectChoice, signIn, STAFF, staffAction } from "./helpers";

async function newFile(request: APIRequestContext, name: string) {
  const [owner] = await db()`select id from staff where auth_user_id=${STAFF.staff}`;
  const created = await staffAction(request, "admin", { action: "create_client", profile: intakeBody(name).profile, primary: [], backup: [], status: "new_intake", next_step: null, assigned_staff: owner.id, communication_consent: false });
  expect(created.status, JSON.stringify(created.json)).toBe(200);
  return String(created.json.client_id);
}
async function sendReview(context: BrowserContext, clientId: string, relatedId?: string) {
  const response = await context.request.post("/api/staff/manager-inbox", { data: { kind: "client", client_id: clientId, related_client_id: relatedId, note: "Command center regression review", request_key: randomUUID() } });
  expect(response.status(), await response.text()).toBe(200);
}
async function capture(page: Page, path: string) {
  await page.evaluate(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    document.querySelector(".royal-main")?.scrollTo({ top: 0, left: 0, behavior: "instant" });
    document.querySelector(".royal-content")?.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await page.screenshot({ path: path.replace(/\.png$/, "-viewport.png"), animations: "disabled" });
}
async function chooseFile(page: Page, name: string) {
  await page.getByRole("searchbox", { name: "Search reviews" }).fill(name);
  const row = page.getByRole("region", { name: "Incoming reviews" }).getByRole("button").filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole("dialog", { name: "Review workspace", exact: true })).toBeVisible();
}

test("manager counts actual sections; draft survives search, reload and version conflict; resolved stamp is read only", async ({ browser, request, baseURL }, testInfo) => {
  const name = `TEST Manager Draft ${RUN} ${randomUUID().slice(0, 6)}`;
  const clientId = await newFile(request, name);
  const [manager] = await db()`select display_name from staff where auth_user_id=${STAFF.manager}`;
  const context = await browser.newContext({ baseURL });
  try {
    await signIn(context, baseURL!, "manager");
    await sendReview(context, clientId);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 1024 });
    await page.goto("/staff/manager-inbox");
    const metrics = page.getByLabel("Current operational file counts");
    await expect(metrics.getByRole("link")).toHaveCount(3);
    const response = await context.request.get("/api/staff/manager-inbox");
    const { inbox } = await response.json();
    for (const [label, expected] of [["Smart Client files", inbox.summary.smart_client], ["Clients files", inbox.summary.clients], ["Urgent files", inbox.summary.urgent]] as const) {
      await expect(metrics.getByRole("link").filter({ hasText: label }).locator("strong")).toHaveText(Number(expected).toLocaleString("en-US"));
    }
    await chooseFile(page, name);
    await page.getByLabel("Manager note (optional)").fill("Preserve this manager draft across every navigation");
    await selectChoice(page.getByRole("combobox", { name: "Next workflow section" }), { value: "account_setup" });
    await page.getByRole("button", { name: "Close review", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search reviews" }).fill(`no-match-${randomUUID()}`);
    await expect(page.getByRole("heading", { name: "No matching reviews" })).toBeVisible();
    await chooseFile(page, name);
    await expect(page.getByLabel("Manager note (optional)")).toHaveValue("Preserve this manager draft across every navigation");
    await expect(page.getByRole("combobox", { name: "Next workflow section" })).toHaveText(/Account Setup/);
    await page.reload();
    await chooseFile(page, name);
    await expect(page.getByLabel("Manager note (optional)")).toHaveValue("Preserve this manager draft across every navigation");
    await expect(page.getByRole("combobox", { name: "Next workflow section" })).toHaveText(/Account Setup/);

    await capture(page, testInfo.outputPath("manager-desktop.png"));

    // A concurrent write must reject the stale decision while retaining the draft.
    await db()`update clients set next_step='Changed by a concurrent fixture',updated_at=now() where id=${clientId}`;
    await page.getByRole("button", { name: "Approve & route", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Review workspace", exact: true }).getByRole("alert")).toContainText(/changed/i);
    await expect(page.getByLabel("Manager note (optional)")).toHaveValue("Preserve this manager draft across every navigation");
    await page.getByRole("button", { name: "Review latest", exact: true }).click();
    await page.getByRole("button", { name: "Approve & route", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Approved and routed to" })).toBeVisible();
    await page.getByTestId("manager-segment-resolved").click();
    await chooseFile(page, name);
    await expect(page.getByText("Reviewed by manager", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Review workspace" })).toContainText(String(manager.display_name));
    await expect(page.getByLabel("Manager note (optional)")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve & route", exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(metrics).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await capture(page, testInfo.outputPath("manager-mobile.png"));
    await page.getByRole("button", { name: "Close review", exact: true }).click();
    await page.locator('[data-testid="staff-language-toggle"]:visible').click();
    await expect(page.getByRole("heading", { name: "مركز مهام المدير", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await capture(page, testInfo.outputPath("manager-mobile-ar.png"));
    await page.setViewportSize({ width: 1440, height: 1024 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await capture(page, testInfo.outputPath("manager-desktop-ar.png"));
  } finally { await context.close(); }
});

test("lost save response reconciles a committed decision without a second PATCH", async ({ browser, request, baseURL }) => {
  const name = `TEST Manager Network ${RUN} ${randomUUID().slice(0, 6)}`;
  const clientId = await newFile(request, name);
  const context = await browser.newContext({ baseURL });
  try {
    await signIn(context, baseURL!, "manager");
    await sendReview(context, clientId);
    const page = await context.newPage();
    await page.goto("/staff/manager-inbox");
    await chooseFile(page, name);
    await page.getByLabel("Manager note (optional)").fill("One atomic decision even when its response is lost");
    await selectChoice(page.getByRole("combobox", { name: "Next workflow section" }), { value: "account_setup" });
    let patches = 0;
    await page.route("**/api/staff/manager-inbox", async route => {
      if (route.request().method() !== "PATCH") { await route.continue(); return; }
      patches++;
      const committed = await route.fetch();
      expect(committed.status(), await committed.text()).toBe(200);
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "Approve & route", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Approved and routed to" })).toBeVisible();
    expect(patches).toBe(1);
    const [review] = await db()`select status,resolution_note from manager_inbox where client_id=${clientId}`;
    expect(review).toMatchObject({ status: "resolved", resolution_note: "One atomic decision even when its response is lost" });
    const [operations] = await db()`select count(*)::int count from staff_operations where operation_name='manager_review_resolve' and result->>'client_id'=${clientId}`;
    expect(operations.count).toBe(1);
  } finally { await context.close(); }
});

test("duplicate comparison archives only the manager-selected file and requires a reason", async ({ browser, request, baseURL }) => {
  const token = `${RUN} ${randomUUID().slice(0, 6)}`;
  const name = `TEST Duplicate Original ${token}`;
  const relatedName = `TEST Duplicate Related ${token}`;
  const clientId = await newFile(request, name);
  const relatedId = await newFile(request, relatedName);
  const context = await browser.newContext({ baseURL });
  try {
    await signIn(context, baseURL!, "manager");
    await sendReview(context, clientId, relatedId);
    const page = await context.newPage();
    await page.goto("/staff/manager-inbox");
    await chooseFile(page, name);
    await expect(page.getByRole("heading", { name: "Submitted file", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Similar record", exact: true })).toBeVisible();
    await expect(page.getByRole("link").filter({ hasText: relatedName })).toBeVisible();
    await page.getByRole("button", { name: "Review deletion", exact: true }).click();
    const remove = page.getByRole("button", { name: "Move selected file to deleted files", exact: true });
    await expect(remove).toBeDisabled();
    await page.getByLabel("File to delete").selectOption(relatedId);
    await expect(remove).toBeDisabled();
    await page.getByLabel("Deletion reason (required)").fill("Manager confirmed this is the redundant record; preserve the original file");
    await remove.click();
    await expect(page.getByRole("status").filter({ hasText: "Selected file moved to deleted files" })).toBeVisible();
    const rows = await db()`select id,deleted_at,manager_review_id from clients where id in (${clientId},${relatedId}) order by id`;
    expect(rows.find(row => row.id === clientId)).toMatchObject({ deleted_at: null, manager_review_id: null });
    expect(rows.find(row => row.id === relatedId)?.deleted_at).not.toBeNull();
    const [review] = await db()`select status,resolution_action from manager_inbox where client_id=${clientId}`;
    expect(review).toMatchObject({ status: "resolved", resolution_action: "delete" });
  } finally { await context.close(); }
});

test("staff urgent transfer and optional manager handoff preserve one operational location and review stamp", async ({ browser, request, baseURL }, testInfo) => {
  const name = `TEST Urgent Handoff ${RUN} ${randomUUID().slice(0, 6)}`;
  const clientId = await newFile(request, name);
  const staffContext = await browser.newContext({ baseURL });
  const managerContext = await browser.newContext({ baseURL });
  const query = encodeURIComponent(name);
  try {
    await signIn(staffContext, baseURL!, "staff");
    await signIn(managerContext, baseURL!, "manager");
    const page = await staffContext.newPage();
    await page.setViewportSize({ width: 1440, height: 1024 });
    await page.goto(`/staff/clients?stage=new_intake&q=${query}`);
    await expect(page.locator(`a[href="/staff/client/${clientId}"]`).first()).toBeVisible();
    await page.goto(`/staff/client/${clientId}`);
    await page.getByRole("button", { name: "Move to Urgent", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Moved to Urgent" })).toBeVisible();
    await page.goto(`/staff/clients?stage=new_intake&q=${query}`);
    await expect(page.locator(`a[href="/staff/client/${clientId}"]`)).toHaveCount(0);
    await page.goto(`/staff/clients?stage=urgent&q=${query}`);
    await expect(page.getByRole("heading", { name: "Urgent Clients", exact: true })).toBeVisible();
    await expect(page.locator(`a[href="/staff/client/${clientId}"]`).first()).toBeVisible();
    await capture(page, testInfo.outputPath("urgent-desktop.png"));
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await capture(page, testInfo.outputPath("urgent-mobile.png"));
    await page.setViewportSize({ width: 1440, height: 1024 });
    const [urgent] = await db()`select operational_location from clients where id=${clientId}`;
    expect(urgent.operational_location).toBe("urgent");
    await page.goto(`/staff/client/${clientId}`);
    await page.getByRole("button", { name: "Send to manager", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Send for manager review" });
    await dialog.getByLabel("Review note (optional)").fill("Urgent client needs manager routing");
    await dialog.getByRole("button", { name: "Send review", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Sent to the manager" })).toBeVisible();
    for (const stage of ["urgent", "new_intake", "account_setup"]) {
      await page.goto(`/staff/clients?stage=${stage}&q=${query}`);
      await expect(page.locator(`a[href="/staff/client/${clientId}"]`)).toHaveCount(0);
    }
    const [held] = await db()`select operational_location,manager_review_id from clients where id=${clientId}`;
    expect(held.operational_location).toBe("manager");
    expect(held.manager_review_id).not.toBeNull();
    const managerPage = await managerContext.newPage();
    await managerPage.goto("/staff/manager-inbox");
    await chooseFile(managerPage, name);
    await selectChoice(managerPage.getByRole("combobox", { name: "Next workflow section" }), { value: "account_setup" });
    await managerPage.getByRole("button", { name: "Approve & route", exact: true }).click();
    await expect(managerPage.getByRole("status").filter({ hasText: "Approved and routed to" })).toBeVisible();
    await page.goto(`/staff/clients?stage=account_setup&q=${query}`);
    await expect(page.locator(`a[href="/staff/client/${clientId}"]`).first()).toBeVisible();
    await expect(page.getByText(/Reviewed by manager/).first()).toBeVisible();
    await page.goto(`/staff/clients?stage=urgent&q=${query}`);
    await expect(page.locator(`a[href="/staff/client/${clientId}"]`)).toHaveCount(0);
    const [released] = await db()`select operational_location,manager_review_id from clients where id=${clientId}`;
    expect(released).toMatchObject({ operational_location: "account_setup", manager_review_id: null });
  } finally { await Promise.allSettled([staffContext.close(), managerContext.close()]); }
});
