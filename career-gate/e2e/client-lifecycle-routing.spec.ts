import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("dashboard stations route into one canonical clients registry with safe actions", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1366, height: 900 } });
  await signIn(context, baseURL!, "admin");
  const page = await context.newPage();
  await page.goto("/staff");

  const lifecycle = page.locator('section[aria-label="Six-stage lifecycle"]');
  const stageLinks = lifecycle.locator("div.grid > a");
  await expect(stageLinks).toHaveCount(6);
  for (const [label, href] of [
    ["New Intake", "/staff/clients?stage=new_intake"],
    ["Account Setup", "/staff/clients?stage=account_setup"],
    ["Job Ready", "/staff/clients?stage=job_ready"],
    ["Appointments", "/staff/appointments"],
    ["Payment & Paperwork", "/staff/clients?stage=paperwork_pending"],
    ["Master Registry", "/staff/clients?view=completed"],
  ]) {
    await expect(stageLinks.filter({ hasText: label })).toHaveAttribute("href", href);
  }

  for (const stage of ["new_intake", "account_setup", "job_ready", "payment_required", "paperwork_pending"]) {
    const response = await page.goto(`/staff/clients?stage=${stage}`);
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByRole("navigation", { name: "Operational client lifecycle stages" })
      .locator(`a[href="/staff/clients?stage=${stage}"]`)).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: /Clients/i })).toBeVisible();
  }

  await page.goto("/staff/clients");
  await expect(page.getByRole("navigation", {name:"Operational client lifecycle stages"}).getByRole("link",{name:/New Intake/})).toHaveAttribute("aria-current","page");
  await page.goto("/staff/clients?view=active");
  await expect(page.getByRole("combobox", { name: "Move selected clients to lifecycle stage" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Assign selected cases to" })).toBeVisible();
  const optionLabels = await page.getByRole("combobox", { name: "Move selected clients to lifecycle stage" }).locator("option").allTextContents();
  for (const text of ["New Intake", "Account Setup", "Job Ready", "Appointments", "Payment Required", "Paperwork Pending"])
    expect(optionLabels).toContain(text);

  const open = page.getByRole("button", { name: "Quick view · Client 360" }).first();
  if (await open.count()) {
    await open.click();
    const drawer = page.getByRole("dialog", { name: /Client 360:/ });
    await expect(drawer).toBeVisible();
    const width = await drawer.evaluate(element => element.getBoundingClientRect().width);
    expect(width).toBeLessThanOrEqual(505);
    await page.getByRole("button", { name: "Close Client 360" }).click();
  }
  await context.close();
});
