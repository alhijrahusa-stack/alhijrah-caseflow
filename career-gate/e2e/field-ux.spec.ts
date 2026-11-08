import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

async function headerControlOverlaps(page: Page) {
  return page.locator(".royal-topbar").evaluate(header => {
    const roles = new Set(["button", "link", "combobox", "searchbox"]);
    const controls = [...header.querySelectorAll<HTMLElement>('button,a[href],input[type="search"]')].filter(element => {
      const role = element.getAttribute("role") ?? (element.tagName === "A" ? "link" : element.tagName === "INPUT" ? "searchbox" : "button");
      return roles.has(role) && !element.closest('[aria-hidden="true"],[inert]') && getComputedStyle(element).visibility !== "hidden";
    }).map(element => ({ label: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName, box: element.getBoundingClientRect() }))
      .filter(item => item.box.width > 2 && item.box.height > 2);
    const overlaps: string[] = [];
    for (let first = 0; first < controls.length; first++) for (let second = first + 1; second < controls.length; second++) {
      const a = controls[first], b = controls[second];
      if (Math.min(a.box.right,b.box.right) - Math.max(a.box.left,b.box.left) > 1 && Math.min(a.box.bottom,b.box.bottom) - Math.max(a.box.top,b.box.top) > 1) {
        overlaps.push(`${a.label} / ${b.label}`);
      }
    }
    return overlaps;
  });
}

test("field appointment and client workspaces remain usable at laptop and phone widths", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  await signIn(context, baseURL!, "admin");
  const page = await context.newPage();

  for (const width of [390, 768, 1024, 1366, 1920]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    for (const path of ["/staff/appointments?view=all", "/staff/clients?view=active", "/staff/pipeline"]) {
      await page.goto(path);
      const report = await page.evaluate(() => {
        const nav = document.querySelector<HTMLElement>(".royal-topbar");
        const main = document.querySelector<HTMLElement>(".royal-main main");
        const card = document.querySelector<HTMLElement>(".cg-appointment-card,.cg-registry-card");
        const bounds = card?.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          headerBackground: nav ? getComputedStyle(nav).backgroundImage : "",
          headerHeight: nav?.getBoundingClientRect().height ?? 0,
          mainWidth: main?.getBoundingClientRect().width ?? 0,
          cardLeft: bounds?.left ?? null,
          cardRight: bounds?.right ?? null,
        };
      });
      expect(report.overflow, `${path} at ${width}px`).toBeLessThanOrEqual(1);
      expect(report.headerBackground).toContain("linear-gradient");
      expect(report.headerBackground).toContain("rgba(20, 68, 110, 0.84)");
      expect(report.headerHeight).toBeGreaterThan(60);
      expect(report.mainWidth).toBeGreaterThan(200);
      expect(report.mainWidth).toBeLessThanOrEqual(width+1);
      if (width <= 768) expect(await headerControlOverlaps(page), `${path}: Header hitboxes at ${width}px`).toEqual([]);
      if (report.cardLeft !== null && report.cardRight !== null) {
        expect(report.cardLeft, `${path}: card left at ${width}px`).toBeGreaterThanOrEqual(-1);
        expect(report.cardRight, `${path}: card right at ${width}px`).toBeLessThanOrEqual(width+1);
      }
    }
    await page.goto("/staff/pipeline");
    await expect(page.getByTestId("g3-smart-lifecycle")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Active workflow" }).getByRole("button")).toHaveCount(5);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/staff/clients?view=active");
  const compactAssignment = page.locator("details.cg-compact-assignment");
  await expect(compactAssignment).toHaveCount(1);
  await expect(page.getByText("Location & Shift · Assign existing client")).toBeVisible();
  await page.getByText("Location & Shift · Assign existing client").click();
  await expect(compactAssignment.getByRole("combobox", { name: "Client", exact: true })).toBeVisible();
  if (await page.getByTestId("client-registry-responsive-cards").locator("article").count()) {
    await page.getByTestId("client-registry-responsive-cards").getByRole("button", { name: "Quick view · Client 360" }).first().click();
    await expect(page.getByRole("dialog", { name: /Client 360/ })).toBeVisible();
    await page.getByRole("button", { name: "Close Client 360" }).click();
  }
  await page.goto("/staff/smart-client-import/new");
  await expect(page).toHaveURL(/\/staff\/smart-client-import\/new$/);
  await expect(page.getByRole("heading", { name: "SMART CLIENT IMPORT" })).toBeVisible();
  await expect(page.getByTestId("client-intake-link-panel")).toBeVisible();
  await page.goto("/staff/appointments?view=all");
  const actions = page.getByRole("button", { name: /Open actions for/ });
  if (await actions.count()) {
    await actions.first().click();
    await expect(page.getByRole("dialog", { name: /Executive Smart Gate/ })).toBeVisible();
    await page.getByRole("button", { name: "Close drawer" }).click();
  }

  await page.goto("/staff/clients?view=active");
  await expect(page.getByTestId("realtime-state").first()).toHaveAttribute("data-state", /^(live|offline|NOT_CONFIGURED)$/, { timeout: 15_000 });
  await page.getByTestId("staff-language-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ["/staff/clients?view=active", "/staff/clients?view=completed"]) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("lang", "ar");
      expect(await headerControlOverlaps(page), `${path}: Arabic Header hitboxes at ${width}px`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await expect(page.locator('.staff-quick-search input[type="search"]:visible')).toHaveCount(1);
    }
  }
  await context.close();
});
