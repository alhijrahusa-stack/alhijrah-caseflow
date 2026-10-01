import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("executive staff upgrade acceptance", () => {
  test("admin can render dashboard, pipeline, operations and unified staff surfaces", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    await signIn(context, baseURL!, "admin");
    const page = await context.newPage();

    const routes: Array<[string, RegExp]> = [
      ["/staff", /CAREER GATE/i],
      ["/staff/clients", /^Clients$/i],
      ["/staff/appointments", /^Appointments$/i],
      ["/staff/tasks", /^Tasks$/i],
      ["/staff/follow-ups", /^Follow-Ups$/i],
      ["/staff/staff", /^Staff$/i],
      ["/staff/staff?tab=assignments", /^Assignments$/i],
      ["/staff/staff?tab=activity", /Operational Activity/i],
      ["/staff/reports", /^Reports$/i],
      ["/staff/accounting", /Accounting/i],
      ["/staff/import", /Import Applications/i],
      ["/staff/settings/availability", /Office Availability/i],
    ];

    for (const [path, text] of routes) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBeLessThan(400);
      await expect(page.getByText(text).first(), path).toBeVisible();
    }

    const legacyDistribution = await page.goto("/staff/distribution");
    expect(legacyDistribution?.status(), "/staff/distribution").toBeLessThan(400);
    await page.waitForURL(/\/staff\/staff\?tab=assignments/);
    await expect(page.getByText(/^Assignments$/i).first()).toBeVisible();

    const legacyTeam = await page.goto("/staff/settings/team");
    expect(legacyTeam?.status(), "/staff/settings/team").toBeLessThan(400);
    await page.waitForURL(/\/staff\/staff\?tab=team/);
    await expect(page.getByRole("heading", { name: "Staff", exact: true })).toBeVisible();

    const pipelineResponse = await page.goto("/staff/pipeline");
    expect(pipelineResponse?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { name: "Candidate Pipeline" })).toBeVisible();
    await expect(page.getByTestId("pipeline-board")).toBeVisible();
    await page.getByRole("button", { name: "Location & Shift" }).click();
    await expect(page.getByTestId("location-dispatcher")).toBeVisible();

    await context.close();
  });

  test("canonical design system is route-aware, truthful and responsive", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    await signIn(context, baseURL!, "admin");
    const page = await context.newPage();

    await page.goto("/staff/clients");
    const current = page.locator('.staff-nav-link[aria-current="page"]');
    await expect(current).toHaveText("Clients");
    await expect(current).toHaveCSS("font-weight", "600");
    const navMetrics = await current.evaluate((el) => {
      const s = getComputedStyle(el);
      return { height: el.getBoundingClientRect().height, font: Number.parseFloat(s.fontSize), border: s.borderTopColor };
    });
    expect(navMetrics.height).toBeGreaterThanOrEqual(40);
    expect(navMetrics.font).toBeGreaterThanOrEqual(14);
    expect(navMetrics.border).not.toBe("rgba(0, 0, 0, 0)");

    await current.focus();
    const focus = await current.evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: Number.parseFloat(s.outlineWidth) };
    });
    expect(focus.style).not.toBe("none");
    expect(focus.width).toBeGreaterThanOrEqual(2);

    const health = await page.evaluate(async () => {
      const r = await fetch("/api/health/ui", { cache: "no-store" });
      return { statusCode: r.status, body: await r.json() };
    });
    expect(health.statusCode).toBe(200);
    expect(health.body.ok).toBe(true);
    expect(["HEALTHY", "DEGRADED"]).toContain(health.body.status);
    expect(typeof health.body.dbMs).toBe("number");

    await page.goto("/staff");
    await expect(page.getByTestId("realtime-state")).toBeVisible();
    await expect(page.getByTestId("realtime-state")).toContainText(/Live|Connecting|NOT_CONFIGURED|offline/i);

    const matrix = [
      { width: 1440, height: 900, routes: ["/staff", "/staff/clients", "/staff/pipeline"] },
      { width: 1024, height: 768, routes: ["/staff/tasks", "/staff/accounting", "/staff/staff"] },
      { width: 390, height: 844, routes: ["/staff", "/staff/clients", "/staff/appointments"] },
    ];
    for (const entry of matrix) {
      await page.setViewportSize({ width: entry.width, height: entry.height });
      for (const route of entry.routes) {
        await page.goto(route);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${route} @ ${entry.width}px should not create page-level overflow`).toBeLessThanOrEqual(1);
      }
    }

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/staff/clients");
    const reducedDuration = await page.locator(".staff-nav-link").first().evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(reducedDuration).toMatch(/0\.01ms|0s/);

    await context.close();

    const touch = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await signIn(touch, baseURL!, "admin");
    const mobile = await touch.newPage();
    await mobile.goto("/staff");
    const targetHeight = await mobile.locator(".staff-nav-link").first().evaluate((el) => el.getBoundingClientRect().height);
    expect(targetHeight).toBeGreaterThanOrEqual(44);
    await touch.close();
  });
});
