import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("executive staff upgrade acceptance", () => {
  test("admin can render dashboard, pipeline, operations and management surfaces", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    await signIn(context, baseURL!, "admin");
    const page = await context.newPage();

    const routes: Array<[string, RegExp]> = [
      ["/staff", /CAREER GATE/i],
      ["/staff/clients", /^Clients$/i],
      ["/staff/appointments", /^Appointments$/i],
      ["/staff/tasks", /^Tasks$/i],
      ["/staff/follow-ups", /^Follow-Ups$/i],
      ["/staff/reports", /^Reports$/i],
      ["/staff/accounting", /Accounting/i],
      ["/staff/distribution", /Distribution/i],
      ["/staff/import", /Import Applications/i],
      ["/staff/settings/team", /^Team$/i],
      ["/staff/settings/availability", /Office Availability/i],
    ];

    for (const [path, text] of routes) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBeLessThan(400);
      await expect(page.getByText(text).first(), path).toBeVisible();
    }

    const pipelineResponse = await page.goto("/staff/pipeline");
    expect(pipelineResponse?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { name: "Candidate Pipeline" })).toBeVisible();
    await expect(page.getByTestId("pipeline-board")).toBeVisible();
    await page.getByRole("button", { name: "Location & Shift" }).click();
    await expect(page.getByTestId("location-dispatcher")).toBeVisible();

    await context.close();
  });
});
