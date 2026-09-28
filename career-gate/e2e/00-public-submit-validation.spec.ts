import { expect, test } from "@playwright/test";
import { PNG, RUN, uniqueIp } from "./helpers";

test("diagnostic: public submit button is form-bound and reaches the submit handler", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": uniqueIp() } });
  const page = await context.newPage();
  await page.goto("/apply");
  await page.waitForURL("**/career-gate.html");

  await page.locator("#firstName").fill("TEST");
  await page.locator("#lastName").fill(`Validation-${RUN}`);
  await page.locator("#phone").fill("313-555-0198");
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

  const binding = await page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>("#form");
    const button = document.querySelector<HTMLButtonElement>("#submitBtn");
    return {
      buttonFormId: button?.form?.id ?? null,
      onsubmitType: typeof form?.onsubmit,
      noValidate: form?.noValidate ?? null,
      buttonType: button?.type ?? null,
      buttonDisabled: button?.disabled ?? null,
      page3Active: document.querySelector('[data-page="3"]')?.classList.contains("active") ?? false,
      signatureMarked: document.querySelector("#sigWrap")?.classList.contains("has") ?? false,
      consent: document.querySelector<HTMLInputElement>("#consent")?.checked ?? false,
    };
  });
  console.log("PUBLIC_SUBMIT_BINDING", JSON.stringify(binding));
  expect(binding).toMatchObject({
    buttonFormId: "form",
    onsubmitType: "function",
    noValidate: true,
    buttonType: "submit",
    buttonDisabled: false,
    page3Active: true,
    signatureMarked: true,
    consent: true,
  });

  await page.evaluate(() => {
    const w = window as typeof window & { __cgSubmitSeen?: boolean };
    w.__cgSubmitSeen = false;
    document.querySelector<HTMLFormElement>("#form")?.addEventListener("submit", () => {
      w.__cgSubmitSeen = true;
    }, { capture: true, once: true });
  });

  let applicationRequests = 0;
  await page.route("**/api/application", async (route) => {
    applicationRequests += 1;
    await route.abort("failed");
  });

  await page.locator("#submitBtn").click();
  await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & { __cgSubmitSeen?: boolean }).__cgSubmitSeen))).toBe(true);
  await expect.poll(() => applicationRequests).toBe(1);
  await expect(page.locator("#statusView")).toHaveText("LOCAL_DRAFT");

  await context.close();
});
