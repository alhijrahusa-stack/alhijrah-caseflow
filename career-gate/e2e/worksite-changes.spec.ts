import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { WORKSITE_OPTIONS } from "../lib/worksite-change-schema";
import { db, intakeBody, passedInterviewFixture, RUN, selectChoice, signIn, STAFF, staffAction } from "./helpers";

const currentSite = WORKSITE_OPTIONS.find(site => site.code === "MI_LOC_01")!;
const requestedSite = WORKSITE_OPTIONS.find(site => site.code === "MI_LOC_02")!;
const finalSite = WORKSITE_OPTIONS.find(site => site.code === "MI_LOC_03")!;

async function newPassedFile(request: APIRequestContext, prefix: string, owner: "staff" | "admin" = "staff") {
  const name = `TEST ${prefix} ${RUN} ${randomUUID().slice(0, 6)}`;
  const profile = intakeBody(name).profile;
  const [assigned] = await db()`select id from staff where auth_user_id=${STAFF[owner]}`;
  const created = await staffAction(request, "admin", {
    action: "create_client", profile, primary: [], backup: [], status: "new_intake", next_step: null,
    assigned_staff: assigned.id, communication_consent: true,
  });
  expect(created.status, JSON.stringify(created.json)).toBe(200);
  const clientId = String(created.json.client_id);
  await passedInterviewFixture(request, clientId);
  const [client] = await db()`select ref from clients where id=${clientId}`;
  return { clientId, name, ref: String(client.ref), email: profile.email };
}

async function moveIntoWorksite(context: BrowserContext, clientId: string) {
  const response = await context.request.post("/api/staff/operations", {
    data: { operation: "bulk_assign", client_ids: [clientId], target_stage: "worksite_change", reason: "E2E requested worksite change" },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function openFile(page: Page, ref: string, name: string) {
  await page.getByRole("searchbox", { name: "Search worksite changes" }).fill(name);
  await page.getByRole("button", { name: `Review worksite change ${ref}`, exact: true }).click();
  const workspace = page.getByRole("dialog", { name: "Worksite change workspace", exact: true });
  await expect(workspace).toBeVisible();
  return workspace;
}

test("assigned employee moves one complete file, confirms the actual site and schedule, then routes it to Completed Files", async ({ browser, request, baseURL }, testInfo) => {
  const file = await newPassedFile(request, "Worksite lifecycle");
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  let releaseDelayedRead: (() => void) | undefined;
  try {
    await signIn(context, baseURL!, "staff");
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/staff/client/${file.clientId}`);
    await selectChoice(page.getByRole("combobox", { name: "Workflow destination", exact: true }), { value: "worksite_change" });
    await page.getByRole("button", { name: "Move now ↗", exact: true }).click();
    await expect.poll(async () => {
      const [row] = await db()`select operational_location from clients where id=${file.clientId}`;
      return row.operational_location;
    }).toBe("worksite_change");
    await page.goto(`/staff/clients?view=active&q=${encodeURIComponent(file.name)}`);
    await expect(page.locator(`a[href="/staff/client/${file.clientId}"]`)).toHaveCount(0);

    await page.goto("/staff/worksite-changes");
    const card = page.getByTestId(`worksite-card-${file.clientId}`);
    await expect(card).toBeVisible();
    const beforeHover = await card.boundingBox();
    expect(beforeHover).not.toBeNull();
    await page.mouse.move(beforeHover!.x + 25, beforeHover!.y + 35);
    const firstSpotlight = await card.evaluate(element => element.style.getPropertyValue("--worksite-spot-x"));
    await page.mouse.move(beforeHover!.x + beforeHover!.width - 25, beforeHover!.y + 55);
    await expect.poll(() => card.evaluate(element => element.style.getPropertyValue("--worksite-spot-x"))).not.toBe(firstSpotlight);
    await expect.poll(() => card.evaluate(element => Number(getComputedStyle(element, "::before").opacity))).toBe(1);
    const afterHover = await card.boundingBox();
    expect(afterHover!.width).toBeCloseTo(beforeHover!.width, 1);
    expect(afterHover!.height).toBeCloseTo(beforeHover!.height, 1);
    const border = await card.evaluate(element => getComputedStyle(element).borderTopColor);
    const channels = border.match(/[\d.]+/g)!.map(Number);
    expect(channels[1]).toBeGreaterThan(channels[0]);
    expect(channels[1]).toBeGreaterThan(channels[2]);
    await page.screenshot({ path: process.env.WORKSITE_QA_SCREENSHOTS ? join(process.env.WORKSITE_QA_SCREENSHOTS, "worksite-desktop.png") : testInfo.outputPath("worksite-cards-desktop.png"), fullPage: true, animations: "disabled" });
    const workspace = await openFile(page, file.ref, file.name);
    await selectChoice(workspace.getByRole("combobox", { name: "Current worksite", exact: true }), { value: currentSite.code });
    await selectChoice(workspace.getByRole("combobox", { name: "Requested worksite", exact: true }), { value: requestedSite.code });
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/staff/worksite-changes" && response.request().method() === "POST");
    await workspace.getByRole("button", { name: "Save requested worksite", exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(workspace.getByRole("combobox", { name: "Requested worksite", exact: true })).toContainText(requestedSite.name);

    // The actual approved site can differ from the original request.
    await selectChoice(workspace.getByRole("combobox", { name: "Final confirmed worksite", exact: true }), { value: finalSite.code });
    await workspace.getByLabel("Shift days", { exact: true }).fill("Wednesday – Saturday");
    await workspace.getByLabel("Shift start time", { exact: true }).fill("18:30");
    await workspace.getByLabel("Shift end time", { exact: true }).fill("05:00");
    await workspace.getByLabel("New start date", { exact: true }).fill("2026-11-18");
    await workspace.getByLabel("Confirmation date and time", { exact: true }).fill("2026-11-07T14:30");
    await page.screenshot({ path: testInfo.outputPath("worksite-desktop.png"), fullPage: true, animations: "disabled" });
    let confirmations = 0;
    page.on("request", outgoing => {
      if (new URL(outgoing.url()).pathname === "/api/staff/worksite-changes" && outgoing.method() === "POST" && outgoing.postDataJSON()?.operation === "confirm") confirmations++;
    });
    const confirmedResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/staff/worksite-changes" && response.request().method() === "POST");
    await workspace.getByRole("button", { name: "Confirm worksite and notify client", exact: true }).dblclick();
    expect((await confirmedResponse).status()).toBe(200);
    await expect.poll(async () => {
      const [row] = await db()`select status from worksite_changes where client_id=${file.clientId} order by created_at desc limit 1`;
      return row?.status;
    }).toBe("confirmed");
    const [confirmed] = await db()`select w.*,n.payload,n.status as email_status,n.sent_at as email_sent_at
      from worksite_changes w join notifications n on n.id=w.notification_id
      where w.client_id=${file.clientId} and w.status='confirmed'`;
    expect(confirmed).toMatchObject({
      current_site_code: currentSite.code, requested_site_code: requestedSite.code, final_site_code: finalSite.code,
      shift_days: "Wednesday – Saturday", new_start_date: "2026-11-18",
    });
    expect(String(confirmed.shift_start)).toMatch(/^18:30/);
    expect(String(confirmed.shift_end)).toMatch(/^05:00/);
    expect(new Date(confirmed.confirmed_at).toISOString()).toBe("2026-11-07T19:30:00.000Z");
    expect(confirmed.recorded_at).not.toBeNull();
    expect(confirmations).toBe(1);
    expect(JSON.stringify(confirmed.payload)).toContain(file.email);
    expect(JSON.stringify(confirmed.payload)).toContain(finalSite.address!);
    expect(JSON.stringify(confirmed.payload)).toContain("Wednesday – Saturday");
    expect(JSON.stringify(confirmed.payload)).toContain("2026-11-18");
    // Local test providers are not configured. Do not claim a message was sent.
    expect(["queued", "not_configured"]).toContain(confirmed.email_status);
    expect(confirmed.email_sent_at).toBeNull();
    const [owner] = await db()`select id from staff where auth_user_id=${STAFF.staff}`;
    expect(confirmed.confirmed_by).toBe(owner.id);

    await expect(workspace.getByRole("heading", { name: /Recorded worksite change/ })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await workspace.locator(".cg-glass-dialog-body").evaluate(element => { element.scrollTop = 0; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await page.screenshot({ path: process.env.WORKSITE_QA_SCREENSHOTS ? join(process.env.WORKSITE_QA_SCREENSHOTS, "worksite-mobile.png") : testInfo.outputPath("worksite-confirmation-mobile.png"), animations: "disabled" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(workspace.getByRole("combobox", { name: "Workflow destination", exact: true })).toBeVisible();
    // A late live read must refresh data without reopening a workspace the
    // employee closed. Delay the real detail response to make the race certain.
    let detailReadHeld = false;
    const delayedRead = new Promise<void>(resolve => { releaseDelayedRead = resolve; });
    await page.route("**/api/staff/worksite-changes?**", async route => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("tab") !== "confirmed" || url.searchParams.get("q") !== file.ref) { await route.continue(); return; }
      const response = await route.fetch();
      detailReadHeld = true;
      await delayedRead;
      await route.fulfill({ response });
    });
    await selectChoice(workspace.getByRole("combobox", { name: "Workflow destination", exact: true }), { value: "completed" });
    await workspace.getByRole("button", { name: "Move now ↗", exact: true }).click();
    await expect.poll(async () => {
      const [row] = await db()`select operational_location from clients where id=${file.clientId}`;
      return row.operational_location;
    }).toBe("completed");
    await expect.poll(() => detailReadHeld).toBe(true);
    await workspace.getByRole("button", { name: "Close worksite change", exact: true }).click();
    await expect(workspace).toHaveCount(0);
    const readFinished = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/staff/worksite-changes" && url.searchParams.get("tab") === "confirmed" && url.searchParams.get("q") === file.ref;
    });
    releaseDelayedRead!();
    await readFinished;
    await expect(workspace).toHaveCount(0);
    await page.unroute("**/api/staff/worksite-changes?**");
    await page.getByTestId("worksite-tab-pending").click();
    await expect(page.getByRole("button", { name: `Review worksite change ${file.ref}`, exact: true })).toHaveCount(0);
    await page.getByTestId("worksite-tab-confirmed").click();
    const history = await openFile(page, file.ref, file.name);
    await expect(history).toContainText(finalSite.name);
    await expect(history.getByRole("link", { name: /Full record/i })).toHaveAttribute("href", `/staff/client/${file.clientId}`);
    await page.goto(`/staff/clients?view=completed&q=${encodeURIComponent(file.name)}`);
    await expect(page.locator(`a[href="/staff/client/${file.clientId}"]`).first()).toBeVisible();
    const [retained] = await db()`select count(*)::int count from clients where id=${file.clientId}`;
    const [historyCount] = await db()`select count(*)::int count from worksite_changes where client_id=${file.clientId} and status='confirmed'`;
    expect(retained.count).toBe(1);
    expect(historyCount.count).toBe(1);
    expect(errors).toEqual([]);
  } finally { releaseDelayedRead?.(); await context.close(); }
});

test("manager drafts survive filtering, reload and a rejected stale save on a usable mobile drawer", async ({ browser, request, baseURL }, testInfo) => {
  const file = await newPassedFile(request, "Worksite draft");
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  try {
    await signIn(context, baseURL!, "manager");
    await moveIntoWorksite(context, file.clientId);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/staff/worksite-changes");
    let workspace = await openFile(page, file.ref, file.name);
    await selectChoice(workspace.getByRole("combobox", { name: "Current worksite", exact: true }), { value: currentSite.code });
    await selectChoice(workspace.getByRole("combobox", { name: "Requested worksite", exact: true }), { value: requestedSite.code });
    await workspace.getByLabel("Shift days", { exact: true }).fill("Tuesday – Friday");
    await workspace.getByLabel("Shift start time", { exact: true }).fill("07:00");
    await workspace.getByRole("button", { name: "Close worksite change", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search worksite changes" }).fill(`unmatched-${randomUUID()}`);
    await expect(page.getByRole("button", { name: `Review worksite change ${file.ref}`, exact: true })).toHaveCount(0);
    workspace = await openFile(page, file.ref, file.name);
    await expect(workspace.getByLabel("Shift days", { exact: true })).toHaveValue("Tuesday – Friday");
    await expect(workspace.getByLabel("Shift start time", { exact: true })).toHaveValue("07:00");
    await page.reload();
    workspace = await openFile(page, file.ref, file.name);
    await expect(workspace.getByLabel("Shift days", { exact: true })).toHaveValue("Tuesday – Friday");
    await expect(workspace.getByRole("combobox", { name: "Requested worksite", exact: true })).toContainText(requestedSite.name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath("worksite-mobile.png"), fullPage: true, animations: "disabled" });

    await db()`update clients set next_step='Changed in a concurrent worksite session',updated_at=now() where id=${file.clientId}`;
    const rejected = page.waitForResponse(response => new URL(response.url()).pathname === "/api/staff/worksite-changes" && response.request().method() === "POST");
    await workspace.getByRole("button", { name: "Save requested worksite", exact: true }).click();
    expect((await rejected).status()).toBe(409);
    await expect(workspace.getByRole("alert")).toContainText(/changed|latest|conflict/i);
    await expect(workspace.getByLabel("Shift days", { exact: true })).toHaveValue("Tuesday – Friday");
    await workspace.getByRole("button", { name: "Reload latest record", exact: true }).click();
    await expect(workspace.getByLabel("Shift days", { exact: true })).toHaveValue("Tuesday – Friday");
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/staff/worksite-changes" && response.request().method() === "POST");
    await workspace.getByRole("button", { name: "Save requested worksite", exact: true }).click();
    expect((await saved).status()).toBe(200);
    await workspace.getByRole("button", { name: "Close worksite change", exact: true }).click();
    const review = page.getByRole("button", { name: `Review worksite change ${file.ref}`, exact: true });
    await review.focus();
    await review.press("Enter");
    await expect(page.getByRole("dialog", { name: "Worksite change workspace", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("manager can process an assigned file while an unrelated employee cannot read or mutate it", async ({ browser, request, baseURL }) => {
  const file = await newPassedFile(request, "Worksite authorization", "admin");
  const managerContext = await browser.newContext({ baseURL });
  const staffContext = await browser.newContext({ baseURL });
  try {
    await signIn(managerContext, baseURL!, "manager");
    await signIn(staffContext, baseURL!, "staff");
    await moveIntoWorksite(managerContext, file.clientId);
    const managerResponse = await managerContext.request.get(`/api/staff/worksite-changes?q=${encodeURIComponent(file.name)}`);
    expect(managerResponse.status()).toBe(200);
    const managerData = await managerResponse.json();
    const row = managerData.data.rows.find((item: { client_id: string }) => item.client_id === file.clientId);
    expect(row).toBeTruthy();
    const staffResponse = await staffContext.request.get(`/api/staff/worksite-changes?q=${encodeURIComponent(file.name)}`);
    expect(staffResponse.status()).toBe(200);
    const staffData = await staffResponse.json();
    expect(staffData.data.rows.some((item: { client_id: string }) => item.client_id === file.clientId)).toBe(false);
    const denied = await staffContext.request.post("/api/staff/worksite-changes", { data: {
      operation: "save_request", operation_id: randomUUID(), client_id: file.clientId, expected_updated_at: row.client_version,
      current_site_code: currentSite.code, requested_site_code: requestedSite.code,
    } });
    expect([403, 404]).toContain(denied.status());
    const allowed = await managerContext.request.post("/api/staff/worksite-changes", { data: {
      operation: "save_request", operation_id: randomUUID(), client_id: file.clientId, expected_updated_at: row.client_version,
      current_site_code: currentSite.code, requested_site_code: requestedSite.code,
    } });
    expect(allowed.status(), await allowed.text()).toBe(200);
  } finally { await Promise.allSettled([managerContext.close(), staffContext.close()]); }
});
