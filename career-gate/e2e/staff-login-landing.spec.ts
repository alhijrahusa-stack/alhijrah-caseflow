import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("interactive sign-in starts at the dashboard even when a manager deep link initiated it", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    // Isolate the landing policy from email delivery. Protected pages still use
    // the suite's signed local staff token and the real role/RLS checks.
    await page.route("**/api/staff/auth/login", route => route.fulfill({
      json: { ok: true, message: "A local test sign-in code is ready." },
    }));
    await page.route("**/api/staff/auth/verify", async route => {
      await signIn(context, baseURL!, "manager");
      await route.fulfill({ json: { ok: true, signed_in: true } });
    });
    await page.goto("/staff/login?next=%2Fstaff%2Fmanager-inbox");
    await page.getByLabel("Work Email", { exact: true }).fill("manager@test.invalid");
    await page.getByRole("button", { name: "Send sign-in code", exact: true }).click();
    await page.getByLabel("6-Digit Code", { exact: true }).fill("123456");
    await page.getByRole("button", { name: "Verify sign-in code", exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/staff`);
    await expect(page.getByRole("heading", { name: "Operations Command Center", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Manager's Task Center", exact: true })).toHaveCount(0);

    // Once signed in, opening the Manager workspace remains intentional and
    // does not get redirected back to the dashboard.
    await page.goto("/staff/manager-inbox");
    await expect(page).toHaveURL(`${baseURL}/staff/manager-inbox`);
    await expect(page.getByRole("heading", { name: "Manager's Task Center", exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
