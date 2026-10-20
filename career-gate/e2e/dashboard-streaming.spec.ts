import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("dashboard streams operational, system and team sections without losing KPI links", async ({browser,baseURL}) => {
  const context=await browser.newContext({baseURL});
  try {
    await signIn(context,baseURL!,"admin");
    const page=await context.newPage();
    await page.goto("/staff");
    await expect(page.getByRole("heading",{name:"Operations Command Center"})).toBeVisible();
    await expect(page.getByTestId("dashboard-core")).toBeVisible();
    await expect(page.getByTestId("dashboard-system-signals")).toBeVisible();
    await expect(page.getByTestId("dashboard-team-health")).toBeVisible();
    await expect(page.getByTestId("dashboard-exceptions")).toContainText("exceptions");
    await expect(page.getByRole("link",{name:"Open Accounting"})).toHaveAttribute("href","/staff/accounting");
    await expect(page.getByRole("link",{name:"Open Pipeline"})).toHaveAttribute("href","/staff/pipeline");
  } finally {
    await context.close();
  }
});
