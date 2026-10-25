import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("field appointment and client workspaces remain usable at laptop and phone widths", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  await signIn(context, baseURL!, "admin");
  const page = await context.newPage();

  for (const width of [390, 768, 1024, 1366, 1920]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    for (const path of ["/staff/appointments?view=all", "/staff/clients?view=active", "/staff/pipeline"]) {
      await page.goto(path);
      const report = await page.evaluate(() => {
        const nav = document.querySelector<HTMLElement>(".staff-topbar");
        const main = document.querySelector<HTMLElement>(".staff-shell main");
        const card = document.querySelector<HTMLElement>(".cg-appointment-card,.cg-registry-card");
        const bounds = card?.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          headerColor: nav ? getComputedStyle(nav).backgroundColor : "",
          headerHeight: nav?.getBoundingClientRect().height ?? 0,
          mainWidth: main?.getBoundingClientRect().width ?? 0,
          cardLeft: bounds?.left ?? null,
          cardRight: bounds?.right ?? null,
        };
      });
      expect(report.overflow, `${path} at ${width}px`).toBeLessThanOrEqual(1);
      expect(report.headerColor).toBe("rgb(7, 16, 28)");
      expect(report.headerHeight).toBeGreaterThan(60);
      expect(report.mainWidth).toBeLessThanOrEqual(width+1);
      if (report.cardLeft !== null && report.cardRight !== null) {
        expect(report.cardLeft, `${path}: card left at ${width}px`).toBeGreaterThanOrEqual(-1);
        expect(report.cardRight, `${path}: card right at ${width}px`).toBeLessThanOrEqual(width+1);
      }
    }
    await page.goto("/staff/pipeline");
    await expect(page.getByTestId("g3-smart-lifecycle")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Six-stage lifecycle" }).getByRole("button")).toHaveCount(6);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/staff/clients");
  const compactAssignment = page.locator("details.cg-compact-assignment");
  await expect(compactAssignment).toHaveCount(1);
  await expect(page.getByText("Location & Shift · Assign existing client")).toBeVisible();
  await page.getByText("Location & Shift · Assign existing client").click();
  await expect(compactAssignment.getByRole("combobox", { name: "Client", exact: true })).toBeVisible();
  if (await page.getByTestId("client-registry-responsive-cards").locator("article").count()) {
    await page.getByTestId("client-registry-responsive-cards").getByRole("button", { name: "Open Client 360" }).first().click();
    await expect(page.getByRole("dialog", { name: /Client 360/ })).toBeVisible();
    await page.getByRole("button", { name: "Close Client 360" }).click();
  }
  await page.goto("/staff/smart-client-import/new");
  await expect(page).toHaveURL(/\/staff\/import$/);
  await page.goto("/staff/appointments?view=all");
  const actions = page.getByRole("button", { name: /Open actions for/ });
  if (await actions.count()) {
    await actions.first().click();
    await expect(page.getByRole("dialog", { name: /Executive Smart Gate/ })).toBeVisible();
    await page.getByRole("button", { name: "Close drawer" }).click();
  }
  await context.close();
});
