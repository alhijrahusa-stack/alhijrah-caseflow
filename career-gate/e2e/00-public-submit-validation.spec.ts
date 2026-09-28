import { expect, test } from "@playwright/test";
import { PNG, RUN, uniqueIp } from "./helpers";

test("diagnostic: public form reaches submit with all local validation predicates satisfied", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": uniqueIp() } });
  const page = await context.newPage();
  await page.goto("/apply");
  await page.waitForURL("**/career-gate.html");

  await page.locator("#firstName").fill("TEST");
  await page.locator("#lastName").fill(`Validation-${RUN}`);
  await page.locator("#phone").fill("313-555-0142");
  await page.locator("#email").fill(`validation.${RUN}@test.invalid`);
  await page.locator('[data-next="2"]').click();
  await page.locator('input[name="workType"][value="Full-Time"]').check({ force: true });
  await page.locator('input[name="shift"][value="FHD"]').check({ force: true });
  await page.locator('[data-next="3"]').click();
  await page.locator("#docs").setInputFiles({ name: "photo-id.png", mimeType: "image/png", buffer: PNG });

  const canvas = page.locator("#signature");
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + 30, box!.y + 70);
  await page.mouse.down();
  await page.mouse.move(box!.x + 90, box!.y + 95, { steps: 5 });
  await page.mouse.move(box!.x + 150, box!.y + 55, { steps: 5 });
  await page.mouse.up();
  await page.locator("#consent").check({ force: true });

  const state = await page.evaluate(() => ({
    page3Active: document.querySelector('[data-page="3"]')?.classList.contains("active") ?? false,
    firstName: (document.querySelector("#firstName") as HTMLInputElement | null)?.value ?? "",
    lastName: (document.querySelector("#lastName") as HTMLInputElement | null)?.value ?? "",
    phone: (document.querySelector("#phone") as HTMLInputElement | null)?.value ?? "",
    email: (document.querySelector("#email") as HTMLInputElement | null)?.value ?? "",
    workType: (document.querySelector('input[name="workType"]:checked') as HTMLInputElement | null)?.value ?? "",
    shift: (document.querySelector('input[name="shift"]:checked') as HTMLInputElement | null)?.value ?? "",
    signatureMarked: document.querySelector("#sigWrap")?.classList.contains("has") ?? false,
    consent: (document.querySelector("#consent") as HTMLInputElement | null)?.checked ?? false,
    honeypot: (document.querySelector("#website") as HTMLInputElement | null)?.value ?? "",
  }));
  console.log("PUBLIC_PRE_SUBMIT_STATE", JSON.stringify(state));

  expect(state).toMatchObject({
    page3Active: true,
    firstName: "TEST",
    lastName: `Validation-${RUN}`,
    phone: "313-555-0142",
    email: `validation.${RUN}@test.invalid`,
    workType: "Full-Time",
    shift: "FHD",
    signatureMarked: true,
    consent: true,
    honeypot: "",
  });
  await context.close();
});
