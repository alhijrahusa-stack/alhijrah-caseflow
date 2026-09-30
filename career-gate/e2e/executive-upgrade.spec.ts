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
    await expect(page.getByRole("heading", { name: "Staff" })).toBeVisible();

    const pipelineResponse = await page.goto("/staff/pipeline");
    expect(pipelineResponse?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { name: "Candidate Pipeline" })).toBeVisible();
    await expect(page.getByTestId("pipeline-board")).toBeVisible();
    await page.getByRole("button", { name: "Location & Shift" }).click();
    await expect(page.getByTestId("location-dispatcher")).toBeVisible();

    await context.close();
  });
});
