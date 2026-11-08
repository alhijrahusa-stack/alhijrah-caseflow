import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { dateOnly } from "../lib/format";
import { parseXlsx } from "../lib/intake-file";
import { WORKSITE_OPTIONS } from "../lib/worksite-options";
import { db, intakeBody, RUN, selectChoice, signIn, STAFF, staffAction } from "./helpers";

const currentSite = WORKSITE_OPTIONS.find(site => site.code === "MI_LOC_01")!;
const requestedSite = WORKSITE_OPTIONS.find(site => site.code === "MI_LOC_02")!;
const finalSite = WORKSITE_OPTIONS.find(site => site.code === "MI_LOC_03")!;

async function newFile(request: APIRequestContext, prefix: string, owner: keyof typeof STAFF = "staff") {
  const name = `TEST ${prefix} ${RUN} ${randomUUID().slice(0, 7)}`;
  const [assigned] = await db()`select id from staff where auth_user_id=${STAFF[owner]}`;
  const created = await staffAction(request, "admin", {
    action: "create_client", profile: intakeBody(name).profile, primary: [], backup: [],
    status: "new_intake", next_step: null, assigned_staff: assigned.id, communication_consent: true,
  });
  expect(created.status, JSON.stringify(created.json)).toBe(200);
  const id = String(created.json.client_id);
  const [row] = await db()`select ref from clients where id=${id}`;
  return { id, ref: String(row.ref), name };
}

async function version(id: string) {
  const [row] = await db()`select updated_at::text version from clients where id=${id}`;
  return String(row.version);
}

async function move(context: BrowserContext, id: string, target: string) {
  const response = await context.request.post("/api/staff/operations", { data: {
    operation: "bulk_assign", client_ids: [id], target_stage: target, reason: "E2E canonical destination",
  } });
  expect(response.status(), await response.text()).toBe(200);
}

async function confirmationBody(id: string, actualStartDate = "2026-01-15") {
  return {
    client_id: id, actual_start_date: actualStartDate, site_code: currentSite.code,
    expected_updated_at: await version(id), operation_id: randomUUID(), confirmation: true,
  };
}

test("legacy records remain unconfirmed until an assigned employee confirms the actual start, then can leave the registry", async ({ browser, request, baseURL }) => {
  const file = await newFile(request, "Legacy employment review");
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  try {
    await signIn(context, baseURL!, "staff");
    await db()`update clients set start_date='2027-03-20' where id=${file.id}`;
    await move(context, file.id, "completed");
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/staff/clients?view=completed&q=${encodeURIComponent(file.ref)}`);
    await expect(page.getByRole("heading", { name: "Confirmed Employment & Records", exact: true })).toBeVisible();
    const card = page.locator("article.cg-registry-card").filter({ has: page.getByRole("link", { name: file.name, exact: true }) });
    await expect(card).toBeVisible();
    await expect(card.getByTestId("employment-confirmation-status")).toHaveText("Actual start not confirmed");
    await expect(page.getByRole("navigation", { name: "Operational client lifecycle stages" }).getByRole("link", { name: /Confirmed Employment/ })).toHaveCount(0);
    const [legacy] = await db()`select count(*)::int count from employment_confirmations where client_id=${file.id}`;
    expect(legacy.count).toBe(0);

    await card.getByRole("button", { name: "Confirm actual start", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Confirm actual start", exact: true });
    await dialog.getByLabel("Actual start date", { exact: true }).fill("2026-01-15");
    await selectChoice(dialog.getByRole("combobox", { name: "Confirmed worksite", exact: true }), { value: currentSite.code });
    await dialog.getByLabel("I confirm the client actually started work", { exact: true }).check();
    await dialog.getByRole("button", { name: "Confirm actual start & save record", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card.getByTestId("employment-confirmation-status")).toHaveText("Actual start confirmed");
    await expect(card).toContainText(dateOnly("2026-01-15"));
    const [record] = await db()`select e.actual_start_date::text actual_start_date,e.confirmed_by_name,e.confirmed_at,c.start_date::text planned_start_date,c.operational_location
      from employment_confirmations e join clients c on c.id=e.client_id where c.id=${file.id}`;
    expect(record).toMatchObject({ actual_start_date: "2026-01-15", planned_start_date: "2027-03-20", operational_location: "completed", confirmed_by_name: "TEST Staff" });
    expect(record.confirmed_at).toBeTruthy();

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    await card.getByRole("link", { name: "Open Client ↗", exact: true }).click();
    await selectChoice(page.getByRole("combobox", { name: "Workflow destination", exact: true }), { value: "account_setup" });
    await page.getByRole("button", { name: "Move now ↗", exact: true }).click();
    await expect.poll(async () => (await db()`select operational_location from clients where id=${file.id}`)[0].operational_location).toBe("account_setup");
    await page.goto(`/staff/clients?view=completed&q=${encodeURIComponent(file.ref)}`);
    await expect(page.getByRole("heading", { name: "Confirmed Employment & Records", exact: true })).toBeVisible();
    await expect(page.locator(`a[href="/staff/client/${file.id}"]`)).toHaveCount(0);
    await page.goto(`/staff/clients?stage=account_setup&q=${encodeURIComponent(file.ref)}`);
    await expect(page.getByRole("link", { name: file.name, exact: true })).toBeVisible();
    expect((await db()`select count(*)::int count from employment_confirmations where client_id=${file.id}`)[0].count).toBe(1);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("actual-start confirmation enforces scope, past calendar dates, exact versions and one durable decision", async ({ browser, request, baseURL }) => {
  const own = await newFile(request, "Employment API owner");
  const hidden = await newFile(request, "Employment API private", "admin");
  const held = await newFile(request, "Employment API held");
  const staffContext = await browser.newContext({ baseURL });
  const managerContext = await browser.newContext({ baseURL });
  try {
    await signIn(staffContext, baseURL!, "staff");
    await signIn(managerContext, baseURL!, "manager");
    const inaccessible = await staffContext.request.post("/api/staff/employment-confirmations", { data: await confirmationBody(hidden.id) });
    expect([403, 404]).toContain(inaccessible.status());
    const future = await staffContext.request.post("/api/staff/employment-confirmations", { data: await confirmationBody(own.id, "2099-01-01") });
    expect(future.status()).toBe(400);
    const invalidDay = await staffContext.request.post("/api/staff/employment-confirmations", { data: await confirmationBody(own.id, "2026-02-30") });
    expect(invalidDay.status()).toBe(400);
    const stale = await confirmationBody(own.id);
    await db()`update clients set next_step='A concurrent operational change',updated_at=now() where id=${own.id}`;
    const rejected = await staffContext.request.post("/api/staff/employment-confirmations", { data: stale });
    expect(rejected.status()).toBe(409);
    const review = await managerContext.request.post("/api/staff/manager-inbox", { data: { kind: "client", client_id: held.id, request_key: randomUUID(), note: "E2E held employment review" } });
    expect(review.status(), await review.text()).toBe(200);
    const heldDecision = await managerContext.request.post("/api/staff/employment-confirmations", { data: await confirmationBody(held.id) });
    expect(heldDecision.status()).toBe(409);

    const body = await confirmationBody(own.id);
    const [first, second] = await Promise.all([
      staffContext.request.post("/api/staff/employment-confirmations", { data: body }),
      staffContext.request.post("/api/staff/employment-confirmations", { data: body }),
    ]);
    expect(first.status(), await first.text()).toBe(200);
    expect(second.status(), await second.text()).toBe(200);
    const one = await first.json(); const replay = await second.json();
    expect(replay.confirmation.id).toBe(one.confirmation.id);
    const [count] = await db()`select count(*)::int count from employment_confirmations where client_id=${own.id}`;
    expect(count.count).toBe(1);
    const managerDecision = await managerContext.request.post("/api/staff/employment-confirmations", { data: await confirmationBody(hidden.id, "2025-05-20") });
    expect(managerDecision.status(), await managerDecision.text()).toBe(200);
    expect((await managerDecision.json()).confirmation.confirmed_by_name).toBe("TEST Manager");
    const privateRegistry = await staffContext.request.get(`/staff/clients?view=completed&q=${hidden.ref}`);
    expect(privateRegistry.status()).toBe(200);
    expect(await privateRegistry.text()).not.toContain(hidden.name);
  } finally { await Promise.allSettled([staffContext.close(), managerContext.close()]); }
});

test("year and confirmation filters export the same server view, while global search still finds another year", async ({ browser, request, baseURL }) => {
  const marker = `EmploymentYears-${RUN}-${randomUUID().slice(0, 6)}`;
  const older = await newFile(request, `${marker} 2025`);
  const newer = await newFile(request, `${marker} 2026`);
  const legacy = await newFile(request, `${marker} legacy`);
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  try {
    await signIn(context, baseURL!, "admin");
    for (const [file, date] of [[older, "2025-05-20"], [newer, "2026-01-15"]] as const) {
      const response = await context.request.post("/api/staff/employment-confirmations", { data: await confirmationBody(file.id, date) });
      expect(response.status(), await response.text()).toBe(200);
    }
    await move(context, legacy.id, "completed");
    const page = await context.newPage();
    await page.goto(`/staff/clients?view=completed&q=${encodeURIComponent(marker)}`);
    await expect(page.locator("article.cg-registry-card")).toHaveCount(3);
    await expect(page.getByRole("link", { name: "New Client", exact: true })).toHaveCount(1);
    await expect(page.locator('.staff-quick-search input[type="search"]:visible')).toHaveCount(1);
    await expect(page.locator('input[name="q"]:visible')).toHaveCount(0);
    await page.getByTestId("registry-filters").locator("summary").click();
    await selectChoice(page.getByRole("combobox", { name: "Employment year", exact: true }), { value: "2026" });
    await expect(page).toHaveURL(/year=2026/);
    await expect(page.locator("article.cg-registry-card")).toHaveCount(1);
    await expect(page.getByRole("link", { name: newer.name, exact: true })).toBeVisible();

    const exported = await context.request.get(`/api/staff/clients/export?view=completed&q=${encodeURIComponent(marker)}&year=2026&format=xlsx`);
    expect(exported.status(), await exported.text().catch(() => "")).toBe(200);
    const workbook = parseXlsx(await exported.body());
    expect(workbook.map(row => row.Reference)).toEqual([newer.ref]);
    await page.getByTestId("registry-filters").locator("summary").click();
    await selectChoice(page.getByRole("combobox", { name: "Search scope", exact: true }), { value: "all" });
    await page.getByRole("combobox", { name: "Search all permitted clients", exact: true }).fill(older.ref);
    const result = page.locator(".staff-search-result").filter({ hasText: older.ref });
    await expect(result).toBeVisible();
    await expect(result).toContainText("Confirmed Registry");
    await expect(result).toContainText(dateOnly("2025-05-20"));
    await result.click();
    await expect(page).toHaveURL(new RegExp(`/staff/client/${older.id}$`));

    await page.goto(`/staff/clients?view=completed&q=${encodeURIComponent(marker)}&confirmation=unconfirmed`);
    await expect(page.locator("article.cg-registry-card")).toHaveCount(1);
    await expect(page.getByRole("link", { name: legacy.name, exact: true })).toBeVisible();
    await page.getByTestId("registry-actions").locator("summary").click();
    await expect(page.getByRole("button", { name: "Save filter", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Excel/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Print \/ Save PDF/ })).toBeVisible();
  } finally { await context.close(); }
});

test("changing a worksite updates the planned start without rewriting confirmed employment history", async ({ browser, request, baseURL }) => {
  const file = await newFile(request, "Employment worksite history");
  const context = await browser.newContext({ baseURL });
  try {
    await signIn(context, baseURL!, "staff");
    const initial = await context.request.post("/api/staff/employment-confirmations", { data: await confirmationBody(file.id, "2025-05-20") });
    expect(initial.status(), await initial.text()).toBe(200);
    const prior = (await initial.json()).confirmation;
    await move(context, file.id, "worksite_change");
    const confirmed = await context.request.post("/api/staff/worksite-changes", { data: {
      operation: "confirm", operation_id: randomUUID(), client_id: file.id, expected_updated_at: await version(file.id),
      current_site_code: currentSite.code, requested_site_code: requestedSite.code, final_site_code: finalSite.code,
      shift_days: "Wednesday – Saturday", shift_start: "07:00", shift_end: "17:30", new_start_date: "2027-01-15",
      confirmed_at: "2026-01-15T15:00:00.000Z",
    } });
    expect(confirmed.status(), await confirmed.text()).toBe(200);
    const [client] = await db()`select start_date::text planned_start_date,operational_location from clients where id=${file.id}`;
    expect(client).toMatchObject({ planned_start_date: "2027-01-15", operational_location: "worksite_change" });
    const [history] = await db()`select id,actual_start_date::text actual_start_date,site_code,confirmed_at from employment_confirmations where client_id=${file.id}`;
    expect(history).toMatchObject({ id: prior.id, actual_start_date: "2025-05-20", site_code: currentSite.code });
    expect(new Date(history.confirmed_at).toISOString()).toBe(prior.confirmed_at);
    const page = await context.newPage();
    await page.goto(`/staff/clients?view=completed&q=${file.ref}`);
    await expect(page.getByRole("heading", { name: "Confirmed Employment & Records", exact: true })).toBeVisible();
    await expect(page.locator(`a[href="/staff/client/${file.id}"]`)).toHaveCount(0);
    await move(context, file.id, "completed");
    await page.goto(`/staff/clients?view=completed&q=${file.ref}`);
    await expect(page.getByRole("link", { name: file.name, exact: true })).toBeVisible();
    await expect(page.getByTestId("employment-confirmation-status")).toHaveText("Actual start not confirmed");
    expect((await db()`select count(*)::int count from clients where id=${file.id}`)[0].count).toBe(1);
    expect((await db()`select count(*)::int count from employment_confirmations where client_id=${file.id}`)[0].count).toBe(1);
  } finally { await context.close(); }
});
