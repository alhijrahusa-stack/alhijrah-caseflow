import { expect, test } from "@playwright/test";
import { intakeBody, RUN, signIn, submitIntake } from "./helpers";

for (const width of [1440, 390]) {
  test(`one click opens and closes Client 360 at ${width}px while its code and data are delayed`, async ({ browser, baseURL, request }, testInfo) => {
    if (!baseURL || !["127.0.0.1", "localhost"].includes(new URL(baseURL).hostname)) throw new Error("Requires an isolated loopback application");
    const name = `TEST Immediate Drawer ${width} ${RUN}`;
    const intake = await submitIntake(request, intakeBody(name));
    expect(intake.res.status(), JSON.stringify(intake.json)).toBe(201);
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
    await signIn(context, baseURL, "admin");
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/staff/clients?q=${encodeURIComponent(intake.json.ref)}`);
    const trigger = page.getByRole("button", { name: "Quick view · Client 360", exact: true });
    await expect(trigger).toBeVisible();
    await page.waitForLoadState("networkidle");
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const delay = 1800;
    let reads = 0;
    await page.route("**/_next/static/chunks/*.js", async route => {
      await new Promise(resolve => setTimeout(resolve, delay));
      await route.continue().catch(() => {});
    });
    await page.route("**/api/staff/client-resource?*", async route => {
      reads++;
      await new Promise(resolve => setTimeout(resolve, delay));
      await route.continue().catch(() => {});
    });
    const started = Date.now();
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: `Client 360: ${name}`, exact: true });
    await expect(dialog).toBeVisible({ timeout: 750 });
    const openMs = Date.now() - started;
    await expect(dialog.getByRole("status")).toBeVisible();
    // Closing must remain urgent even while the dynamic module is downloading.
    await dialog.getByRole("button", { name: "Close Client 360", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 750 });
    await page.waitForTimeout(delay + 100);
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(reads, "a drawer closed before its code arrived must not fetch client data").toBe(0);
    await trigger.click();
    await expect(dialog).toBeVisible({ timeout: 750 });
    await expect(dialog.getByRole("region", { name: "Client summary" })).toBeVisible({ timeout: 10_000 });
    expect(reads, "the initial drawer snapshot uses one combined read").toBe(1);
    expect(errors).toEqual([]);
    const timing = { width, cpuThrottle: 4, delayedCodeAndDataMs: delay, firstClickToDialogMs: openMs };
    console.log(`INTERACTION_TIMING ${JSON.stringify(timing)}`);
    await page.screenshot({ path: testInfo.outputPath("client360.png") });
    await testInfo.attach("interaction-timing.json", {
      body: Buffer.from(JSON.stringify(timing)),
      contentType: "application/json",
    });
    await context.close();
  });
}
