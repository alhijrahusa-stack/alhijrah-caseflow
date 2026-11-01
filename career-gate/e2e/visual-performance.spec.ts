import { expect, test, type Locator, type Page } from "@playwright/test";
import { summarizeFrameCapture, type FrameCapture } from "./frame-diagnostics";
import { db, intakeBody, RUN, signIn, STAFF, submitIntake } from "./helpers";

function requireIsolatedFixture(baseURL: string | undefined) {
  const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (!baseURL || !process.env.DATABASE_URL || !loopback.has(new URL(baseURL).hostname) || !loopback.has(new URL(process.env.DATABASE_URL).hostname)) {
    throw new Error("Visual tests require a loopback application and database fixture");
  }
}

async function frameSample(page: Page, trigger: Locator, action: () => Promise<void>) {
  await trigger.evaluate(element => {
    type Collector = FrameCapture & { done: boolean };
    const host = window as unknown as { __cgFrameSample?: Collector };
    delete host.__cgFrameSample;
    element.addEventListener("click", () => {
      const collector: Collector = { clickTime: performance.now(), frameTimes: [], longTasks: [], longTaskSupported: false, windowMs: 1200, done: false };
      host.__cgFrameSample = collector;
      let observer: PerformanceObserver | null = null;
      const addTasks = (entries: PerformanceEntry[]) => {
        for (const entry of entries) collector.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      };
      try {
        if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
          observer = new PerformanceObserver(list => addTasks(list.getEntries()));
          observer.observe({ entryTypes: ["longtask"] });
          collector.longTaskSupported = true;
        }
      } catch { observer = null; }
      const frame = (time: number) => {
        if (collector.done || time - collector.clickTime > collector.windowMs) return;
        collector.frameTimes.push(time);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      window.setTimeout(() => {
        if (observer) { addTasks(observer.takeRecords()); observer.disconnect(); }
        collector.done = true;
      }, collector.windowMs);
    }, { capture: true, once: true });
  });
  await action();
  const observedActionMs = await page.evaluate(() => performance.now() - (window as unknown as { __cgFrameSample: FrameCapture }).__cgFrameSample.clickTime);
  await page.waitForFunction(() => (window as unknown as { __cgFrameSample?: { done: boolean } }).__cgFrameSample?.done, null, { timeout: 10000 });
  const capture = await page.evaluate(() => (window as unknown as { __cgFrameSample: FrameCapture }).__cgFrameSample);
  return { ...summarizeFrameCapture(capture), observedActionMs, clickTime: capture.clickTime };
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
    methodology: "1200ms from the captured click; requestAnimationFrame windows and main-thread long tasks are diagnostics, not a 60 FPS pass threshold. Network and UI waits are reported separately; concurrent test load and headless rendering affect results.",
    workers: testInfo.config.workers,
    retry: testInfo.retry,
    ci: Boolean(process.env.CI),
    environment: await page.evaluate(() => ({ userAgent: navigator.userAgent, logicalCores: navigator.hardwareConcurrency, devicePixelRatio: devicePixelRatio, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, visibility: document.visibilityState, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })),
    browserVersion: browser.version(),
    headless: true,
  };
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`/staff/clients?q=${encodeURIComponent(name)}`);
    const card = page.getByTestId("client-registry-responsive-cards").locator("article").filter({ has: page.getByRole("link", { name: intake.json.ref, exact: true }) });
    await expect(card).toBeVisible();
    const drawer = page.getByRole("dialog", { name: `Client 360: ${name}`, exact: true });
    const openButton = card.getByRole("button", { name: "Quick view · Client 360" });
    const clientResponse = page.waitForResponse(response => response.url().includes("/api/staff/client-resource?") && response.request().method() === "GET", { timeout: 15000 }).catch(() => null);
    let dataReady: Promise<number> | undefined;
    const openDrawer = await frameSample(page, openButton, async () => {
      await openButton.click();
      await expect(drawer).toBeVisible();
      dataReady = (async () => {
        await expect(drawer.getByRole("status")).toHaveCount(0, { timeout: 15000 });
        return page.evaluate(() => performance.now() - (window as unknown as { __cgFrameSample: FrameCapture }).__cgFrameSample.clickTime);
      })();
    });
    const response = await clientResponse;
    const dataReadyObservedMs = await dataReady!;
    const network = await page.evaluate(clickTime => {
      const entry = performance.getEntriesByType("resource").find(item => item.name.includes("/api/staff/client-resource?") && item.startTime >= clickTime) as PerformanceResourceTiming | undefined;
      return entry ? { startAfterClickMs: entry.startTime - clickTime, durationMs: entry.duration, responseEndAfterClickMs: entry.responseEnd - clickTime } : null;
    }, openDrawer.clickTime);
    const closeButton = page.getByRole("button", { name: "Close Client 360" });
    const closeDrawer = await frameSample(page, closeButton, async () => {
      await closeButton.click();
      await expect(drawer).toBeHidden();
    });
    const routingButton = card.getByRole("button", { name: /Workflow routing/ });
    const routing = await frameSample(page, routingButton, async () => {
      await routingButton.click();
      await card.getByRole("combobox", { name: "Workflow destination" }).click();
      await expect(card.getByRole("listbox", { name: "Workflow destination options" })).toBeVisible();
    });
    for (const sample of [openDrawer, closeDrawer, routing]) expect(sample.wholeWindow.frames).toBeGreaterThan(2);
    result[`${viewport.width}x${viewport.height}`] = { openDrawer, clientData: { status: response?.status() ?? null, network, dataReadyObservedMs }, closeDrawer, routing };
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
