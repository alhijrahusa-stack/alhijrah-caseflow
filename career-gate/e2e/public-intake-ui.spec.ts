import { expect, test, type Page } from "@playwright/test";
import { db, RUN, uniqueIp } from "./helpers";

// Runtime assertions are intentionally unchanged; this commit re-triggers PR checks after restoring intake initialization.
async function fillStepOne(page: Page) {
  await page.locator("#firstName").fill("عبدالله");
  await page.locator("#lastName").fill("Tester");
  await page.locator("#phone").fill("+1 313 555 0199");
  await page.locator("#email").fill("public-ui@test.invalid");
}

async function chooseStepTwo(page: Page) {
  const workType = page.locator('input[name="workType"]').first();
  await expect(workType).toBeAttached();
  await workType.check({ force: true });
  const shift = page.locator('input[name="shift"]').first();
  await expect(shift).toBeAttached();
  await shift.check({ force: true });
}

async function sign(page: Page) {
  // Why this is not a plain mouse drag.
  //
  // Step 4 contains the consent and signature area; the signature canvas can sit
  // below the fold: it was measured at y=833 in a 720px viewport, with
  // `elementsFromPoint` at that y returning nothing at all. `page.mouse` takes
  // viewport coordinates, so a drag built from `boundingBox()` was being
  // dispatched off-screen — the canvas received zero pointer events, `drawing`
  // never became true, and nothing marked the signature. The step also keeps
  // reflowing as the Arabic web font loads, which moved the canvas by over
  // 100px between runs, so a box read once can be stale by the time it is used.
  //
  // `hover` fixes both: it is element-relative, scrolls the canvas into view at
  // action time, and waits for a stable box before placing the pointer. The box
  // for the drag is then read with the canvas already on screen. A stroke is
  // additive, so repeating the gesture is harmless and is what a real person
  // does when the first one does not take; the loop ends as soon as the page
  // itself reports the signature.
  //
  // The assertion is unchanged: the pad must set `has`, and a pad that never
  // does still fails.
  await expect(page.locator('.page.active[data-page="4"]')).toBeVisible();
  const canvas = page.locator("#signature");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  await expect
    .poll(async () => {
      await canvas.hover({ position: { x: 30, y: 50 } });
      await page.mouse.down();
      const box = await canvas.boundingBox();
      if (box) {
        await page.mouse.move(box.x + 90, box.y + 80, { steps: 4 });
        await page.mouse.move(box.x + 150, box.y + 45, { steps: 4 });
      }
      await page.mouse.up();
      return ((await page.locator("#sigWrap").getAttribute("class")) ?? "").includes("has");
    }, { timeout: 15000, intervals: [150, 300, 600, 1000] })
    .toBe(true);

  await expect(page.locator("#sigWrap")).toHaveClass(/has/);
}

async function reachReview(page: Page) {
  await fillStepOne(page);
  await page.locator('[data-next="2"]').click();
  await chooseStepTwo(page);
  await page.locator('[data-next="3"]').click();
  await page.locator('[data-next="4"]').click();
  await sign(page);
  await expect(page.locator('.page.active[data-page="4"]')).toBeVisible();
}

test("public HTML application submits and stores an idempotent case without phone-only merging", async ({ request }) => {
  const email = `public-html-${RUN}@test.invalid`;
  const common = {
    service: "employment", firstName: "TEST", phone: "3135550148", email,
    workType: "Full-Time", shiftCode: "FHD", branch: "DET3",
    branchName: "Pontiac - DET3", signature: { captured: true, type: "image/png" }, consent: true,
  };
  const post = async (lastName: string, uid: string) => {
    const response = await request.post("/api/application", {
      data: { ...common, lastName, uid },
      headers: { "x-forwarded-for": uniqueIp() },
    });
    return { status: response.status(), result: await response.json() };
  };
  const firstUid = `public-html-one-${RUN}`;
  const first = await post("Shared-A", firstUid);
  expect(first.status, JSON.stringify(first.result)).toBe(201);
  expect(first.result.ok).toBe(true);
  expect(first.result.caseNumber).toMatch(/^ALH-\d{8}-[A-Z0-9]{4}$/);
  expect(first.result.systemId).toMatch(/^CG-\d{4}-\d{6}$/);
  const duplicate = await post("Shared-A", firstUid);
  expect(duplicate.status).toBe(200);
  expect(duplicate.result.caseNumber).toBe(first.result.caseNumber);
  const existing = await post("Shared-A", `public-html-same-${RUN}`);
  expect(existing.status).toBe(409);
  expect(existing.result.code).toBe("existing_applicant");
  const other = await post("Shared-B", `public-html-other-${RUN}`);
  expect(other.status, JSON.stringify(other.result)).toBe(201);
  expect(other.result.caseNumber).not.toBe(first.result.caseNumber);
  const apps = await db()`select case_number from career_gate_applications where submission_uid in (${firstUid}, ${`public-html-other-${RUN}`})`;
  expect(apps).toHaveLength(2);
});

test.describe("Career Gate public intake presentation system", () => {
  test("AR/EN switch is complete at the shell level and preserves active state", async ({ page }) => {
    await page.goto("/career-gate.html");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator(".title")).toHaveText("نموذج التقديم على الوظيفة");
    await expect(page.locator(".career-brand-logo")).toBeVisible();
    await expect(page.locator(".office-brand-logo")).toBeVisible();

    await fillStepOne(page);
    await page.locator('[data-next="2"]').click();
    await expect(page.locator('.page.active[data-page="2"]')).toBeVisible();

    await page.locator("#langEn").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.locator(".title")).toHaveText("Job Application Form");
    await expect(page.locator("#firstName")).toHaveValue("عبدالله");
    await expect(page.locator('.page.active[data-page="2"]')).toBeVisible();
    await expect(page.locator('[data-next="3"]')).toContainText("Next");

    await page.locator("#langAr").click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("#firstName")).toHaveValue("عبدالله");
    await expect(page.locator('.page.active[data-page="2"]')).toBeVisible();
  });

  test("step transitions stay in the form workflow instead of jumping to the hero", async ({ page }) => {
    await page.goto("/career-gate.html");
    await fillStepOne(page);
    await page.locator('[data-next="2"]').click();
    await expect.poll(async () => page.evaluate(() => {
      const progress = document.querySelector("#formProgress")!.getBoundingClientRect();
      const hero = document.querySelector(".hero")!.getBoundingClientRect();
      return window.scrollY > 0 && progress.top >= -24 && progress.top < 160 && hero.bottom < progress.top;
    })).toBe(true);
  });

  test("files, photo, signature and step survive locale switching; review supports edit without reset", async ({ page }) => {
    await page.goto("/career-gate.html");
    await fillStepOne(page);
    await page.locator('[data-next="2"]').click();
    await chooseStepTwo(page);
    await page.locator('[data-next="3"]').click();

    await page.locator("#docs").setInputFiles({ name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
    await page.locator("#photo").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("fake-png") });
    await page.locator('[data-next="4"]').click();
    await sign(page);

    await page.locator("#langEn").click();
    expect(await page.locator("#docs").evaluate((el: HTMLInputElement) => el.files?.length ?? 0)).toBe(1);
    expect(await page.locator("#photo").evaluate((el: HTMLInputElement) => el.files?.length ?? 0)).toBe(1);
    await expect(page.locator("#sigWrap")).toHaveClass(/has/);
    await expect(page.locator('.page.active[data-page="4"]')).toBeVisible();

    await page.locator('[data-step="3"]').click();
    await page.locator('[data-next="4"]').click();
    await expect(page.locator("#reviewClientName")).toContainText("عبدالله");
    await expect(page.locator("#reviewDocumentsGrid")).toContainText("resume.pdf");
    await expect(page.locator("#reviewPhoto img")).toBeVisible();
    await page.locator("#consent").check({ force: true });
    await page.locator("#editPersonal").click();
    await expect(page.locator('.page.active[data-page="1"]')).toBeVisible();
    await expect(page.locator("#firstName")).toHaveValue("عبدالله");
    await page.locator('[data-step="4"]').click();
    await expect(page.locator("#consent")).toBeChecked();
    await expect(page.locator("#reviewClientName")).toContainText("عبدالله");
  });

  test("submit is single-fire and receipt uses the server submission timestamp", async ({ page }) => {
    let posts = 0;
    await page.route("**/api/application", async (route) => {
      posts += 1;
      await new Promise((resolve) => setTimeout(resolve, 120));
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          duplicate: false,
          caseNumber: "ALH-20261001-TEST",
          systemId: "CG-2026-012345",
          trackingUrl: "/career-gate.html?track=1&case=ALH-20261001-TEST",
          submittedAt: "2026-10-01T00:15:00.000Z"
        })
      });
    });

    await page.goto("/career-gate.html");
    await reachReview(page);
    await page.locator("#consent").check({ force: true });

    const started = Date.now();
    await page.locator("#form").evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
    await expect(page.locator("#receiptScreen")).toHaveClass(/active/);
    const elapsed = Date.now() - started;
    expect(posts).toBe(1);
    expect(elapsed).toBeLessThan(5000);
    await expect(page.locator("#receiptCase")).toHaveText("ALH-20261001-TEST");
    await expect(page.locator("#receiptSystemId")).toHaveText("System ID: CG-2026-012345");
    await expect(page.locator("#receiptTime")).not.toContainText("—");
    await expect(page.locator("#receiptCard")).toContainText("CAREER GATE");
    await expect(page.locator("#receiptCard")).toContainText("313-919-4192");
  });

  test("tracking states localize and render only after the server response", async ({ page }) => {
    await page.route("**/api/track", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          application: {
            fullName: "Test Client",
            caseNumber: "ALH-20261001-TRACK",
            submittedAt: "2026-10-01T00:15:00.000Z",
            jobLocation: "Romulus - DTW1",
            shiftDays: "Sunday – Wednesday",
            shiftHours: "7:00 AM – 5:30 PM",
            currentStatus: "needs_review",
            nextStep: "Office will review your information and documents.",
            documentsStatus: "needs_review",
            lastStatusUpdate: "2026-10-01T00:16:00.000Z"
          },
          updates: []
        })
      });
    });
    await page.goto("/career-gate.html");
    await page.locator("#langEn").click();
    await expect(page.locator("#statusModal")).toBeHidden();
    await page.locator("#openTrack").click();
    await expect(page.locator("#statusModal")).toBeVisible();
    await expect(page.locator("#trackResult")).toBeEmpty();
    await page.locator("#trackValue").fill("ALH-20261001-TRACK");
    await page.locator("#trackBtn").click();
    await expect(page.locator("#trackResult")).toContainText("Current Status");
    await expect(page.locator("#trackResult")).toContainText("Needs Review");
    await page.locator("#closeTrack").click();
    await expect(page.locator("#statusModal")).toBeHidden();
    await page.locator("#langAr").click();
    await page.locator("#openTrack").click();
    await page.locator("#trackBtn").click();
    await expect(page.locator("#trackResult")).toContainText("الحالة الحالية");
    await expect(page.locator("#trackResult")).toContainText("بحاجة للمراجعة");
    await page.keyboard.press("Escape");
    await expect(page.locator("#statusModal")).toBeHidden();
  });

  test("progress reflects completed fields and preferred language survives navigation", async ({ page }) => {
    await page.goto("/career-gate.html");
    await expect(page.locator("#progressPctView")).toHaveText("0%");
    await fillStepOne(page);
    await page.locator("#preferredLanguage").selectOption("en");
    await expect(page.locator("#progressPctView")).toHaveText("50%");
    await page.locator('[data-next="2"]').click();
    await page.locator('[data-step="1"]').click();
    await expect(page.locator("#preferredLanguage")).toHaveValue("en");
  });

  test("narrow mobile has no horizontal overflow and exposes accessible progress/language controls", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto("/career-gate.html");
    const widths = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.inner + 1);
    await expect(page.locator("#formProgress")).toHaveAttribute("role", "progressbar");
    await expect(page.locator("#langAr")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#langEn").click();
    await expect(page.locator("#langEn")).toHaveAttribute("aria-pressed", "true");
    await context.close();
  });
  test("executive preferred sites and salary schedule removal preserve shift wages", async ({ page }) => {
    await page.goto("/career-gate.html");
    await fillStepOne(page);
    await page.locator('[data-next="2"]').click();
    await expect(page.locator("#payTable")).toHaveCount(0);
    await expect(page.locator("#preferredSitesExecutive")).toBeVisible();
    await expect(page.locator("#preferredSitesTitle")).toHaveText("المواقع المفضلة");
    await expect(page.locator("#preferredSitesExecutive #location1")).toBeVisible();
    const color = await page.locator("#preferredSitesExecutive").evaluate(el => getComputedStyle(el).backgroundImage);
    expect(color).toContain("rgb(6, 17, 35)");
    const inner = await page.locator("#preferredSitesExecutive .preferred-sites-inner").evaluate(el => getComputedStyle(el).backgroundImage);
    expect(inner).toContain("rgb(255, 255, 255)");
    await page.locator('input[name="workType"]').first().check({ force: true });
    await expect(page.locator(".shift-pay").first()).toContainText("/hr");
    await page.locator("#langEn").click();
    await expect(page.locator("#preferredSitesTitle")).toHaveText("Preferred Locations");
  });

  test("selected document offers local VIEW, no false upload success, and a dismissible preview", async ({ page }) => {
    await page.goto("/career-gate.html");
    await fillStepOne(page);
    await page.locator('[data-next="2"]').click();
    await chooseStepTwo(page);
    await page.locator('[data-next="3"]').click();
    await page.locator("#docs").setInputFiles({
      name: "sample-identity.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF")
    });
    await expect(page.locator("#docsList")).toContainText("sample-identity.pdf");
    await expect(page.locator("#uploadGuidance")).toContainText("ستُرفع بعد إرسال الطلب");
    await page.getByRole("button", { name: "معاينة sample-identity.pdf" }).click();
    await expect(page.locator("#documentViewer")).toBeVisible();
    await expect(page.locator("#documentViewerPdf")).toHaveAttribute("src", /^blob:/);
    await page.locator("#closeDocumentViewer").click();
    await expect(page.locator("#documentViewer")).toBeHidden();
  });

  test("receipt exposes ready-to-use inline case tracking after contact details", async ({ page }) => {
    const ref = "ALH-20261012-UX83";
    await page.route("**/api/application", route => route.fulfill({
      status: 201, contentType: "application/json",
      body: JSON.stringify({ ok: true, duplicate: false, caseNumber: ref,
        systemId: "CG-2026-012346", submittedAt: "2026-10-12T00:15:00.000Z" })
    }));
    await page.route("**/api/track", route => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ok:true,application:{fullName:"Test Client",caseNumber:ref,
        currentStatus:"needs_review",nextStep:"Office will review your information and documents.",
        documentsStatus:"pending",submittedAt:"2026-10-12",lastStatusUpdate:"2026-10-12"},
        updates:[]})
    }));
    await page.goto("/career-gate.html");
    await reachReview(page);
    await page.locator("#consent").check({force:true});
    await page.locator("#form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect(page.locator("#receiptScreen")).toHaveClass(/active/);
    await expect(page.locator("#receiptTrackValue")).toHaveValue(ref);
    await expect(page.locator("#receiptStatusExecutive")).toBeVisible();
    expect(await page.locator("#receiptCard #receiptStatusExecutive").count()).toBe(0);
    await expect(page.locator("#receiptCard .receipt-data-group")).toHaveCount(4);
    await expect(page.locator(".receipt-actions>.btn")).toHaveCount(4);
    await page.locator("#receiptStatusJump").click();
    await expect(page.locator("#receiptVoiceBtn")).toBeVisible();
    await page.locator("#receiptVoiceBtn").click();
    await page.locator("#receiptTrackBtn").click();
    await expect(page.locator("#receiptTrackResult")).toContainText("بحاجة للمراجعة");
    await expect(page.locator("#receiptTrackResult .receipt-read-aloud")).toBeVisible();
    await page.locator("#receiptTrackResult .receipt-read-aloud").click();
  });

  test("public duplicate confirmation shows support actions without revealing another applicant", async ({ page }) => {
    await page.route("**/api/application", route => route.fulfill({
      status: 409, contentType: "application/json",
      body: JSON.stringify({ ok: false, code: "existing_applicant",
        message: "An application for this applicant already exists." })
    }));
    await page.goto("/career-gate.html");
    await reachReview(page);
    await page.locator("#consent").check({force:true});
    await page.locator("#form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect(page.locator("#duplicateGuard")).toBeVisible();
    await expect(page.locator("#duplicateGuard")).toContainText("يرجى التواصل مع خدمة العملاء");
    await expect(page.locator("#duplicateGuard a")).toHaveCount(3);
    await expect(page.locator("#receiptScreen")).not.toHaveClass(/active/);
    await expect(page.locator("#duplicateGuard")).not.toContainText("CG-2026");
  });

  test("light footer keeps all customer contact channels and accessible voice tracker", async ({ page }) => {
    await page.goto("/career-gate.html");
    await expect(page.locator("#contactFooter .contact-grid a")).toHaveCount(3);
    await expect(page.locator("#openTrack")).toHaveAttribute("aria-controls", "statusModal");
    const color = await page.locator("#contactFooter").evaluate(el => getComputedStyle(el).backgroundImage);
    expect(color).toContain("rgb(255, 255, 255)");
    await page.locator("#openTrack").click();
    await expect(page.locator("#statusModal")).toBeVisible();
  });

});