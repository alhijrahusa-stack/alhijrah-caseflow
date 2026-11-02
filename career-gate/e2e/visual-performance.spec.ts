import { expect, test, type Page } from "@playwright/test";
import { db, intakeBody, RUN, signIn, STAFF, submitIntake } from "./helpers";

function requireIsolatedFixture(baseURL: string | undefined) {
  const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (!baseURL || !process.env.DATABASE_URL || !loopback.has(new URL(baseURL).hostname) || !loopback.has(new URL(process.env.DATABASE_URL).hostname)) {
    throw new Error("Visual tests require a loopback application and database fixture");
  }
}

async function frameSample(page: Page, action: () => Promise<void>) {
  await page.evaluate(() => {
    type Collector = { active: boolean; timestamps: number[] };
    const host = window as unknown as { __cgFrameSample: Collector };
    const collector: Collector = { active: true, timestamps: [] };
    host.__cgFrameSample = collector;
    const sample = (time: number) => {
      if (!collector.active) return;
      collector.timestamps.push(time);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await action();
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    type Collector = { active: boolean; timestamps: number[] };
    const collector = (window as unknown as { __cgFrameSample: Collector }).__cgFrameSample;
    collector.active = false;
    const gaps = collector.timestamps.slice(1).map((time, i) => time - collector.timestamps[i]);
    const sorted = [...gaps].sort((a, b) => a - b);
    const percentile = (n: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * n) - 1)] : null;
    const duration = collector.timestamps.length > 1 ? collector.timestamps.at(-1)! - collector.timestamps[0] : 0;
    const earlyGaps = gaps.filter((_, i) => collector.timestamps[i + 1] - collector.timestamps[0] <= 500);
    const earlyDuration = earlyGaps.reduce((sum, gap) => sum + gap, 0);
    return {
      first500ms: { frames: earlyGaps.length + 1, observedFps: earlyDuration ? earlyGaps.length * 1000 / earlyDuration : null, longestIntervalMs: earlyGaps.length ? Math.max(...earlyGaps) : null },
      durationMs: duration,
      frames: collector.timestamps.length,
      observedFps: duration ? gaps.length * 1000 / duration : null,
      intervalP95Ms: percentile(.95),
      intervalP99Ms: percentile(.99),
      intervalsAbove20ms: gaps.filter(gap => gap > 20).length,
      longestIntervalMs: sorted.at(-1) ?? null,
    };
  });
}

test("measure drawer and routing frame intervals in isolated browser fixtures", async ({ browser, baseURL, request }, testInfo) => {
  requireIsolatedFixture(baseURL);
  const name = `TEST Frame Diagnostics ${RUN}`;
  const intake = await submitIntake(request, intakeBody(name));
  expect(intake.res.status(), JSON.stringify(intake.json)).toBe(201);
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  await signIn(context, baseURL!, "admin");
  const page = await context.newPage();
  const result: Record<string, unknown> = {
    methodology: "requestAnimationFrame intervals during and after interactions; 20ms is a diagnostic marker, not a 60fps pass threshold",
    environment: await page.evaluate(() => ({ userAgent: navigator.userAgent, logicalCores: navigator.hardwareConcurrency, devicePixelRatio: devicePixelRatio, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, visibility: document.visibilityState })),
    browserVersion: browser.version(),
    headless: true,
  };
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`/staff/clients?q=${encodeURIComponent(name)}`);
    const card = page.getByTestId("client-registry-responsive-cards").locator("article").filter({ has: page.getByRole("link", { name: intake.json.ref, exact: true }) });
    await expect(card).toBeVisible();
    const drawer = page.getByRole("dialog", { name: `Client 360: ${name}`, exact: true });
    const openDrawer = await frameSample(page, async () => {
      await card.getByRole("button", { name: "Quick view · Client 360" }).click();
      await expect(drawer).toBeVisible();
    });
    const closeDrawer = await frameSample(page, async () => {
      await page.getByRole("button", { name: "Close Client 360" }).click();
      await expect(drawer).toBeHidden();
    });
    const routing = await frameSample(page, async () => {
      await card.getByRole("button", { name: /Workflow routing/ }).click();
      await card.getByRole("combobox", { name: "Workflow destination" }).click();
      await expect(card.getByRole("listbox", { name: "Workflow destination options" })).toBeVisible();
    });
    for (const sample of [openDrawer, closeDrawer, routing]) expect(sample.frames).toBeGreaterThan(2);
    result[`${viewport.width}x${viewport.height}`] = { openDrawer, closeDrawer, routing };
  }
  const report = JSON.stringify(result, null, 2);
  console.log(`FRAME_DIAGNOSTICS ${report}`);
  await testInfo.attach("frame-diagnostics.json", { body: Buffer.from(report), contentType: "application/json" });
  await context.close();
});

test("assigned employee can use the appointment override with a recorded reason", async ({ browser, baseURL, request }) => {
  requireIsolatedFixture(baseURL);
  const name = `TEST Staff Interview Override ${RUN}`;
  const intake = await submitIntake(request, intakeBody(name));
  expect(intake.res.status(), JSON.stringify(intake.json)).toBe(201);
  const [employee] = await db()`select id from staff where auth_user_id=${STAFF.staff}`;
  const [client] = await db()`update clients set assigned_staff=${employee.id} where ref=${intake.json.ref} returning id,current_status`;
  expect(["new_intake", "needs_review", "ready_to_apply", "application_in_progress", "assessment_required"]).toContain(client.current_status);
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  await signIn(context, baseURL!, "staff");
  const page = await context.newPage();
  await page.goto(`/staff/client/${client.id}`);
  await page.getByTestId("quick-actions").getByRole("button", { name: "Add Appointment" }).click();
  const form = page.getByTestId("form-appointment");
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Now +30m" }).click();
  const submit = form.getByRole("button", { name: "Approve & Save appointment" });
  const denied = page.waitForResponse(response => response.url().includes("/api/staff/action") && response.request().method() === "POST");
  await submit.click();
  expect((await denied).status()).toBe(409);
  expect(await db()`select id from appointments where client_id=${client.id}`).toHaveLength(0);
  await form.getByRole("checkbox", { name: /Override Job Ready condition/ }).check();
  await form.getByLabel(/Reason for override/).fill("Interview arranged by the assigned employee");
  const saved = page.waitForResponse(response => response.url().includes("/api/staff/action") && response.request().method() === "POST");
  await submit.click();
  expect((await saved).status()).toBe(200);
  const [row] = await db()`select current_status from clients where id=${client.id}`;
  expect(row.current_status).toBe("appointment_scheduled");
  const [appointment] = await db()`select id from appointments where client_id=${client.id}`;
  const [audit] = await db()`select staff_id,new_value from activity_log where client_id=${client.id} and action='status_overridden'`;
  expect(audit.staff_id).toBe(employee.id);
  expect(audit.new_value).toMatchObject({ reason: "Interview arranged by the assigned employee", appointment_id: appointment.id });
  await context.close();
});
