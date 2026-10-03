import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

function cssDurationSeconds(value: string) {
  const first = value.split(",")[0]?.trim() ?? "";
  if (first.endsWith("ms")) return Number.parseFloat(first) / 1000;
  if (first.endsWith("s")) return Number.parseFloat(first);
  return Number.POSITIVE_INFINITY;
}

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
      ["/staff/import", /SMART CAREER COLLECT CLIENT/i],
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
    expect(navMetrics.height).toBeGreaterThanOrEqual(28);
    expect(navMetrics.font).toBeGreaterThanOrEqual(11);
    expect(navMetrics.border).not.toBe("rgba(0, 0, 0, 0)");

    await page.goto("/staff");
    await expect(page.locator(".command-center")).toBeVisible();
    await expect(page.locator(".command-center")).toHaveCSS("opacity", "1");
    await expect(page.getByText(/Executive Operations/i).first()).toBeVisible();

    const reducedMotion = await browser.newContext({ baseURL, reducedMotion: "reduce" });
    await signIn(reducedMotion, baseURL!, "admin");
    const reducedPage = await reducedMotion.newPage();
    await reducedPage.goto("/staff");
    const duration = await reducedPage.locator(".executive-motion").first().evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(cssDurationSeconds(duration)).toBeLessThanOrEqual(0.2);
    await reducedMotion.close();
    await context.close();
  });
});
