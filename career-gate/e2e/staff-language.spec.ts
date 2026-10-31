import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("staff workspace defaults to English, mirrors to Arabic, and keeps the saved language across reloads", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  await signIn(context, baseURL!, "admin");
  const page = await context.newPage();
  const hydrationErrors: string[] = [];
  page.on("pageerror", error => { if (/hydration|#418/i.test(error.message)) hydrationErrors.push(error.message); });
  await page.goto("/staff");
  const shell = page.getByTestId("executive-shell");
  await expect(shell).toHaveAttribute("lang", "en");
  await expect(shell).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { name: "Operations Command Center" })).toBeVisible();
  await expect(page.locator('.royal-nav-item[aria-current="page"]')).toHaveAttribute("aria-label", "Dashboard");
  const left = await page.locator(".royal-sidebar").boundingBox();
  expect(left?.x).toBe(0);

  const search = page.locator(".staff-quick-search input");
  await search.fill("language check");
  await page.getByTestId("staff-language-toggle").click();
  await expect(shell).toHaveAttribute("lang", "ar");
  await expect(shell).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "مركز قيادة العمليات" })).toBeVisible();
  await expect(page.locator('.royal-nav-item[aria-current="page"]')).toHaveAttribute("aria-label", "مركز القيادة");
  await expect(search).toHaveValue("language check");
  const right = await page.locator(".royal-sidebar").boundingBox();
  expect(Math.round((right?.x ?? 0) + (right?.width ?? 0))).toBe(1440);

  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "لوحة الأوامر" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "البحث في الأوامر والعملاء" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-palette")).not.toBeVisible();
  await page.reload();
  await expect(shell).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("heading", { name: "مركز قيادة العمليات" })).toBeVisible();
  await page.getByTestId("staff-language-toggle").click();
  await expect(shell).toHaveAttribute("dir", "ltr");
  await page.goto("/staff/clients");
  await expect(shell).toHaveAttribute("lang", "en");
  expect(hydrationErrors).toEqual([]);
  await context.close();
});

test("mobile navigation and language controls stay usable in both directions", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await signIn(context, baseURL!, "admin");
  const page = await context.newPage();
  await page.goto("/staff");
  await expect(page.getByTestId("staff-language-toggle")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Executive navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Close navigation", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Executive navigation" })).not.toBeVisible();
  await page.getByTestId("staff-language-toggle").click();
  await page.getByRole("button", { name: "فتح قائمة الأقسام", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "القائمة التنفيذية" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "القائمة التنفيذية" })).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await context.close();
});

test("single-file executive view shares the language preference and never renders a native assignment menu", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  await signIn(context, baseURL!, "admin");
  const page = await context.newPage();
  await page.goto("/career-gate-royal.html");
  await expect(page.getByRole("heading", { name: "Operations Command Center", exact: true })).toBeVisible();
  await expect(page.locator("select, option")).toHaveCount(0);
  await expect(page.locator(".royal-shell")).toHaveClass(/staff-shell/);
  await expect(page.locator(".royal-shell")).toHaveAttribute("dir", "ltr");
  await page.getByTestId("staff-language-toggle").click();
  await expect(page.getByRole("heading", { name: "مركز قيادة العمليات", exact: true })).toBeVisible();
  await expect(page.locator(".royal-shell")).toHaveAttribute("dir", "rtl");
  await page.reload();
  await expect(page.locator(".royal-shell")).toHaveAttribute("lang", "ar");
  await page.goto("/staff");
  await expect(page.getByTestId("executive-shell")).toHaveAttribute("lang", "ar");
  await page.getByTestId("staff-language-toggle").click();
  await page.goto("/career-gate-royal.html");
  await expect(page.getByRole("heading", { name: "Operations Command Center", exact: true })).toBeVisible();
  await context.close();
});

test("Arabic selection translates legacy server-page headings, filters and report metadata", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  await signIn(context, baseURL!, "admin");
  const page = await context.newPage();
  await page.goto("/staff/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await page.getByTestId("staff-language-toggle").click();
  await expect(page.getByRole("heading", { name: "المهام", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "تصفية", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "الموظف المسؤول", exact: true })).toBeVisible();
  const routes: Array<[string, string]> = [
    ["/staff/appointments", "المواعيد"],
    ["/staff/follow-ups", "المتابعات"],
    ["/staff/reports", "التقارير"],
    ["/staff/staff", "الموظفون"],
    ["/staff/settings", "الإعدادات"],
    ["/staff/settings/availability", "توافر المكتب"],
    ["/staff/archive", "الأرشيف"],
    ["/staff/audit-alerts", "تنبيهات التدقيق"],
  ];
  for (const [route, heading] of routes) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBeLessThan(400);
    await expect(page.getByTestId("executive-shell")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await page.goto("/staff/reports");
  await expect(page.getByText("العملاء حسب الحالة", { exact: true })).toBeVisible();
  await expect(page.getByText("الوثائق حسب حالة التدقيق", { exact: true })).toBeVisible();
  await context.close();
});
