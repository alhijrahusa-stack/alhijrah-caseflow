import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { db, intakeBody, RUN, signIn, STAFF, staffAction } from "./helpers";

async function createFile(request: APIRequestContext, name: string) {
  const [owner] = await db()`select id from staff where auth_user_id=${STAFF.staff}`;
  const created = await staffAction(request, "admin", { action: "create_client", profile: intakeBody(name).profile, primary: [], backup: [], status: "new_intake", next_step: null, assigned_staff: owner.id, communication_consent: false });
  expect(created.status, JSON.stringify(created.json)).toBe(200);
  return String(created.json.client_id);
}
async function review(context: BrowserContext, clientId: string) {
  const response = await context.request.post("/api/staff/manager-inbox", { data: { kind: "client", client_id: clientId, note: "Spatial filter and keyboard acceptance", request_key: randomUUID() } });
  expect(response.status(), await response.text()).toBe(200);
}

test("spatial dock uses real payment cases, keeps filters precise and restores modal focus and notes", async ({ browser, request, baseURL }, testInfo) => {
  const token = `${RUN}-${randomUUID().slice(0, 6)}`;
  const normalName = `TEST Spatial Normal ${token}`;
  const urgentName = `TEST Spatial Urgent ${token}`;
  const paymentName = `TEST Spatial Payment ${token}`;
  const normalId = await createFile(request, normalName);
  const urgentId = await createFile(request, urgentName);
  const paymentId = await createFile(request, paymentName);
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  try {
    await signIn(context, baseURL!, "manager");
    const urgent = await context.request.post("/api/staff/client-dispatch", { data: { operation: "urgent", client_id: urgentId, urgent: true, operation_id: randomUUID() } });
    expect(urgent.status(), await urgent.text()).toBe(200);
    const payment = await context.request.post("/api/staff/operations", { data: { operation: "bulk_assign", client_ids: [paymentId], target_stage: "payment_required" } });
    expect(payment.status(), await payment.text()).toBe(200);
    for (const id of [normalId, urgentId, paymentId]) await review(context, id);
    const page = await context.newPage();
    await page.goto("/staff/manager-inbox");
    await expect(page.locator(".royal-sidebar")).not.toBeVisible();
    await expect(page.locator(".royal-topbar")).not.toBeVisible();
    await expect(page.getByRole("dialog", { name: "Review workspace", exact: true })).toHaveCount(0);
    const metrics = page.getByLabel("Current operational file counts");
    await expect(metrics.getByRole("link")).toHaveCount(3);
    const paymentCard = metrics.getByRole("button", { name: /Payment issues/i });
    await expect(paymentCard).toBeVisible();
    const result = await context.request.get("/api/staff/manager-inbox");
    const { inbox } = await result.json();
    await expect(paymentCard.locator("strong")).toHaveText(Number(inbox.summary.payment_issues).toLocaleString("en-US"));

    await page.getByRole("searchbox", { name: "Search reviews" }).fill(token);
    const canvas = page.getByTestId("manager-task-canvas");
    await expect(canvas.getByRole("button").filter({ hasText: normalName })).toBeVisible();
    await paymentCard.click();
    await expect(page.getByTestId("manager-segment-payments")).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getByRole("button").filter({ hasText: paymentName })).toBeVisible();
    await expect(canvas.getByRole("button").filter({ hasText: normalName })).toHaveCount(0);
    await expect(canvas.getByRole("button").filter({ hasText: urgentName })).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/staff/manager-inbox");

    await page.getByTestId("manager-segment-urgent").click();
    await expect(canvas.getByRole("button").filter({ hasText: urgentName })).toBeVisible();
    await expect(canvas.getByRole("button").filter({ hasText: paymentName })).toHaveCount(0);
    await page.getByTestId("manager-segment-action").click();
    await page.getByRole("searchbox", { name: "Search reviews" }).fill(token);
    const card = canvas.getByRole("button").filter({ hasText: normalName });
    await expect(card).toBeVisible();
    await card.click();
    const modal = page.getByRole("dialog", { name: "Review workspace", exact: true });
    await expect(modal).toBeVisible();
    await expect.poll(() => modal.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await modal.getByLabel("Manager note (optional)").fill("Persist this note after the spatial dialog closes");
    await page.screenshot({ path: testInfo.outputPath("spatial-review-desktop.png"), animations: "disabled" });
    await modal.getByLabel("Manager note (optional)").press("Control+k");
    const palette = page.getByTestId("command-palette");
    await expect(palette).toBeVisible();
    await expect.poll(() => palette.evaluate(element => element.contains(document.activeElement))).toBe(true);
    expect(await palette.evaluate(element => { const rect = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + 24)); })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("spatial-command-above-review.png"), animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel("Manager note (optional)")).toHaveValue("Persist this note after the spatial dialog closes");
    await expect(modal.getByLabel("Manager note (optional)")).toBeFocused();
    await modal.getByLabel("Manager note (optional)").press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(card).toBeFocused();
    await card.press("Enter");
    await expect(modal.getByLabel("Manager note (optional)")).toHaveValue("Persist this note after the spatial dialog closes");
    await modal.getByRole("button", { name: "Close review", exact: true }).click();
    await expect(card).toBeFocused();

    await page.screenshot({ path: testInfo.outputPath("spatial-canvas-desktop.png"), fullPage: true, animations: "disabled" });
    const teamButton = page.getByTestId("team-now-compact-trigger");
    await expect(teamButton).toBeVisible();
    await teamButton.click();
    await expect(page.getByTestId("team-now-panel")).toBeVisible();
    await expect(page.getByTestId("team-now-panel")).toContainText("TEST Manager");
    await page.screenshot({ path: testInfo.outputPath("spatial-team-popup.png"), animations: "disabled" });
    await page.keyboard.press("Control+k");
    await expect(palette).toBeVisible();
    await expect.poll(() => palette.evaluate(element => element.contains(document.activeElement))).toBe(true);
    expect(await palette.evaluate(element => { const rect = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + 24)); })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("spatial-command-above-team.png"), animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await expect(page.getByTestId("team-now-panel")).toBeVisible();
    await page.getByRole("button", { name: "Close team activity", exact: true }).click();
    await expect(teamButton).toBeFocused();
    await page.getByRole("button", { name: "Quick commands", exact: true }).click();
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("spatial-canvas-mobile.png"), fullPage: true, animations: "disabled" });
    await page.screenshot({ path: testInfo.outputPath("spatial-canvas-mobile-viewport.png"), animations: "disabled" });
    await page.locator('[data-testid="staff-language-toggle"]:visible').click();
    await expect(page.getByRole("heading", { name: "مركز مهام المدير", exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("spatial-canvas-mobile-ar.png"), fullPage: true, animations: "disabled" });
    await page.screenshot({ path: testInfo.outputPath("spatial-canvas-mobile-ar-viewport.png"), animations: "disabled" });
    await card.click();
    await expect(page.getByRole("dialog", { name: "مساحة المراجعة", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("spatial-review-mobile-ar.png"), animations: "disabled" });
    await page.getByRole("button", { name: "إغلاق المراجعة", exact: true }).click();

    // Route isolation: Clients keeps its established executive navigation.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/staff/clients");
    await expect(page.locator(".royal-sidebar")).toBeVisible();
    await expect(page.locator(".royal-topbar")).toBeVisible();
    const open = await context.request.get(`/api/staff/manager-inbox?q=${encodeURIComponent(token)}`);
    const pending = (await open.json()).inbox.items as { id: string; client_version: string }[];
    expect(pending).toHaveLength(3);
    for (const item of pending) {
      const resolved = await context.request.patch("/api/staff/manager-inbox", { data: { id: item.id, destination: "keep_current", note: "Spatial acceptance completed", action: "approve", expected_client_version: item.client_version, operation_id: randomUUID() } });
      expect(resolved.status(), await resolved.text()).toBe(200);
    }
  } finally { await context.close(); }
});
