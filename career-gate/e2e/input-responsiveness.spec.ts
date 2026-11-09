import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { db, intakeBody, RUN, signIn, STAFF, staffAction } from "./helpers";

const baseline = process.env.PERF_BASELINE === "1";
for (const width of [1440, 390]) test(`one-click import opening paints before slow data and uses one read at ${width}px`, async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
  try {
    await signIn(context, baseURL!, "manager");
    const [actor] = await db()`select id from staff where auth_user_id=${STAFF.manager}`;
    const [batch] = await db()`insert into client_import_batches(source_type,source_file_hash,idempotency_key,created_by) values('csv',${"f".repeat(64)},${randomUUID()},${actor.id}) returning id`;
    const name = `TEST Slow Open ${width} ${RUN}`;
    const [source] = await db()`insert into client_import_cases(batch_id,source_type,mapped_draft,created_by) values(${batch.id},'csv',${db().json({ profile: { full_name: name, phone: `313555${width === 390 ? "8390" : "8440"}` }, primary: [], backup: [] })},${actor.id}) returning id`;
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto("/staff/import");
    await page.getByLabel("Search imports").fill(name);
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toBeVisible();
    if (!baseline) expect(await row.evaluate(node => getComputedStyle(node).backdropFilter)).toBe("none");
    let reads = 0, claims = 0, opens = 0;
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname !== "/api/staff/smart-client-import") return;
      if (url.searchParams.get("id") === source.id) reads++;
      if (request.method() === "POST" && request.postDataJSON()?.action === "start_review") claims++;
      if (request.method() === "POST" && request.postDataJSON()?.action === "open_review") opens++;
    });
    let unblock!: () => void;
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    await page.route("**/api/staff/smart-client-import**", async route => {
      if (new URL(route.request().url()).searchParams.get("id") === source.id || (route.request().method() === "POST" && route.request().postDataJSON()?.action === "open_review")) await gate;
      await route.continue();
    });
    await row.getByRole("button", { name: "OPEN / EDIT", exact: true }).click();
    await page.waitForTimeout(150);
    const earlyFeedback = await page.getByTestId("smart-review-loading").isVisible();
    if (!baseline) {
      expect(earlyFeedback, "the first click must paint loading while data is still blocked").toBe(true);
      await page.getByRole("button", { name: "Cancel opening review", exact: true }).click();
      await expect(page.getByTestId("smart-review-loading")).toHaveCount(0);
      unblock();
      await page.waitForTimeout(200);
      await expect(page.locator("#smart-review")).toHaveCount(0);
      await row.getByRole("button", { name: "OPEN / EDIT", exact: true }).click();
    } else unblock();
    await expect(page.locator("#smart-review")).toBeVisible();
    const report = { width, earlyFeedback, reads, claims, opens, cpuThrottle: 4 };
    console.log("INPUT_DIAGNOSTIC", JSON.stringify(report));
    await testInfo.attach(`import-open-${width}.json`, { body: JSON.stringify(report), contentType: "application/json" });
    if (!baseline) { expect(reads).toBe(0); expect(claims).toBe(0); expect(opens).toBe(2); }
  } finally { await context.close(); }
});

test("same-tick repeated form submission sends one request and records one note", async ({ browser, baseURL, request }, testInfo) => {
  const name = `TEST Single Flight ${RUN}`, body = intakeBody(name);
  const created = await staffAction(request, "admin", { action: "create_client", profile: body.profile, primary: [], backup: [], status: "new_intake", next_step: null, assigned_staff: null, communication_consent: false });
  expect(created.status, JSON.stringify(created.json)).toBe(200);
  const context = await browser.newContext({ baseURL });
  try {
    await signIn(context, baseURL!, "manager"); const page = await context.newPage();
    await page.goto(`/staff/client/${created.json.client_id}`);
    await page.getByTestId("quick-actions").getByRole("button", { name: "Add Note", exact: true }).click();
    const form = page.getByTestId("form-note"); await expect(form).toBeVisible();
    const note = `TEST Idempotent Note ${RUN}`;
    await page.locator("#note_text").fill(note);
    let mutations = 0;
    page.on("request", request => { if (new URL(request.url()).pathname === "/api/staff/action" && request.method() === "POST" && request.postDataJSON()?.action === "add_note") mutations++; });
    await form.evaluate(node => { const form = node.closest("form")!; form.requestSubmit(); form.requestSubmit(); form.requestSubmit(); });
    await expect(page.getByTestId("form-note")).toHaveCount(0);
    const [row] = await db()`select count(*)::int n from notes where client_id=${created.json.client_id} and note=${note}`;
    const report = { mutations, notes: row.n };
    console.log("INPUT_DIAGNOSTIC", JSON.stringify(report));
    await testInfo.attach("single-flight.json", { body: JSON.stringify(report), contentType: "application/json" });
    if (!baseline) { expect(mutations).toBe(1); expect(row.n).toBe(1); }
  } finally { await context.close(); }
});

test("staff shell shares one realtime bootstrap and acknowledges a slow navigation", async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ baseURL });
  try {
    await signIn(context, baseURL!, "manager"); const page = await context.newPage();
    let tokenReads = 0;
    page.on("request", request => { if (new URL(request.url()).pathname === "/api/staff/realtime-token") tokenReads++; });
    await page.goto("/staff/manager-inbox");
    await expect(page.getByTestId("manager-task-center")).toBeVisible();
    await page.waitForTimeout(800);
    console.log("INPUT_DIAGNOSTIC", JSON.stringify({ tokenReads }));
    await testInfo.attach("realtime-bootstrap.json", { body: JSON.stringify({ tokenReads }), contentType: "application/json" });
    if (!baseline) expect(tokenReads).toBe(1);
    await page.goto("/staff/import");
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/staff/tasks?**", async route => { await gate; await route.continue(); });
    await page.getByRole("link", { name: "Tasks", exact: true }).click();
    await page.waitForTimeout(150);
    const pending = await page.locator('[data-navigation-pending="true"]').count();
    console.log("INPUT_DIAGNOSTIC", JSON.stringify({ navigationPending: pending }));
    if (!baseline) expect(pending).toBeGreaterThan(0);
    release(); await expect(page).toHaveURL(/\/staff\/tasks/);
  } finally { await context.close(); }
});

test("a retried operation writes once, rejects a changed body and rechecks current permissions", async ({ browser, baseURL, request }) => {
  const [employee] = await db()`select id from staff where auth_user_id=${STAFF.staff}`;
  const body = intakeBody(`TEST Network Retry ${RUN}`);
  const created = await staffAction(request, "admin", { action: "create_client", profile: body.profile, primary: [], backup: [], status: "new_intake", next_step: null, assigned_staff: employee.id, communication_consent: false });
  expect(created.status).toBe(200);
  const context = await browser.newContext({ baseURL });
  try {
    await signIn(context, baseURL!, "staff");
    const data = { action: "add_note", client_id: created.json.client_id, note: `TEST Safe Retry ${RUN}`, operation_id: randomUUID() };
    const responses = await Promise.all([context.request.post("/api/staff/action", { data }), context.request.post("/api/staff/action", { data })]);
    expect(responses.map(response => response.status())).toEqual([200, 200]);
    const first = await responses[0].json(), second = await responses[1].json();
    delete first.trace_id; delete second.trace_id;
    expect(first).toEqual(second);
    expect((await db()`select count(*)::int n from notes where client_id=${data.client_id} and note=${data.note}`)[0].n).toBe(1);
    expect((await context.request.post("/api/staff/action", { data: { ...data, note: `${data.note} changed` } })).status()).toBe(409);
    await db()`update staff set permission_mode='custom',custom_permissions='{}' where id=${employee.id}`;
    expect((await context.request.post("/api/staff/action", { data })).status()).toBe(403);
  } finally {
    await db()`update staff set permission_mode='full',custom_permissions='{}' where id=${employee.id}`;
    await context.close();
  }
});

test("the shared async button excludes repeated clicks and unlocks after a failed request", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  try {
    await signIn(context, baseURL!, "manager"); const page = await context.newPage();
    await page.goto("/staff/import");
    let requests = 0, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/staff/auth/logout", async route => {
      requests++; await gate;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    });
    const button = page.getByRole("button", { name: "Sign out", exact: true });
    await button.evaluate(node => { if (!(node instanceof HTMLButtonElement)) throw new Error("Expected a native button"); node.click(); node.click(); node.click(); });
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect.poll(() => requests).toBe(1);
    release(); await expect(button).toBeEnabled();
    await button.click(); await expect.poll(() => requests).toBe(2);
    await expect(button).toBeEnabled();
  } finally { await context.close(); }
});
