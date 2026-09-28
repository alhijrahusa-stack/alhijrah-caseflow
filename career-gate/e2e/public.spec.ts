import { expect, type Page, test } from "@playwright/test";
import { db, FIXTURE_CATALOG, intakeBody, PNG, RUN, submitIntake, uniqueIp } from "./helpers";

async function openPublicForm(page: Page) {
  await page.goto("/apply");
  await page.waitForURL("**/career-gate.html");
}

async function fillIdentity(page: Page, lastName: string, phone: string, email: string) {
  await page.locator("#firstName").fill("TEST");
  await page.locator("#lastName").fill(lastName);
  await page.locator("#phone").fill(phone);
  await page.locator("#email").fill(email);
  await page.locator("#dob").fill("1990-04-05");
  await page.locator("#address1").fill("1 Test St");
  await page.locator("#city").fill("Dearborn");
  await page.locator("#state").fill("MI");
  await page.locator("#zip").fill("48126");
}

async function chooseWork(page: Page) {
  await page.locator('[data-next="2"]').click();
  await page.locator('input[name="workType"][value="Full-Time"]').check({ force: true });
  await expect(page.locator("#shiftSelector")).toBeVisible();
  await page.locator('input[name="shift"][value="FHD"]').check({ force: true });
  await page.locator("#employmentStatus").selectOption({ label: "Unemployed" });
  await page.locator("#hasExperience").selectOption({ label: "No" });
  await page.locator("#englishLevel").selectOption({ label: "Good" });
  await page.locator('[data-next="3"]').click();
  await expect(page.locator('[data-page="3"]')).toHaveClass(/active/);
}

async function signAndConsent(page: Page) {
  await expect.poll(async () => Math.round(await page.evaluate(() => window.scrollY))).toBe(0);
  const canvas = page.locator("#signature");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + 30, box!.y + 70);
  await page.mouse.down();
  await page.mouse.move(box!.x + 90, box!.y + 95, { steps: 5 });
  await page.mouse.move(box!.x + 150, box!.y + 55, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#sigWrap")).toHaveClass(/has/);
  await page.locator("#consent").check({ force: true });
}

test.describe.serial("public intake and status access", () => {
  let ref = "";

  test("IndexedDB draft restores field values and selected document after reload", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": uniqueIp() } });
    const page = await context.newPage();
    await openPublicForm(page);
    await fillIdentity(page, `Draft-${RUN}`, "313-555-0131", `draft.${RUN}@test.invalid`);
    await page.locator("#docs").setInputFiles({ name: "draft-id.png", mimeType: "image/png", buffer: PNG });
    await expect(page.locator("#docsList")).toContainText("draft-id.png");
    await expect(page.locator("#docsList")).toContainText("SELECTED");
    await expect(page.locator("#saveView")).toHaveText("Saved");

    await page.reload();
    await expect(page.locator("#firstName")).toHaveValue("TEST");
    await expect(page.locator("#lastName")).toHaveValue(`Draft-${RUN}`);
    await expect(page.locator("#phone")).toHaveValue("313-555-0131");
    await expect(page.locator("#email")).toHaveValue(`draft.${RUN}@test.invalid`);
    await expect(page.locator("#docsList")).toContainText("draft-id.png");
    await expect(page.locator("#saveView")).toHaveText("Restored");

    const persisted = await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("alhijrah.career.form", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const draft = await new Promise<unknown>((resolve, reject) => {
          const request = database.transaction("draft", "readonly").objectStore("draft").get("main");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const files = await new Promise<unknown[]>((resolve, reject) => {
          const request = database.transaction("files", "readonly").objectStore("files").getAll();
          request.onsuccess = () => resolve(request.result as unknown[]);
          request.onerror = () => reject(request.error);
        });
        return { draft: Boolean(draft), files: files.length };
      } finally {
        database.close();
      }
    });
    expect(persisted).toEqual({ draft: true, files: 1 });
    await context.close();
  });

  test("current public Career Gate form submits, uploads documents, and persists the application", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": uniqueIp() } });
    const page = await context.newPage();
    await openPublicForm(page);
    await fillIdentity(page, `Public-${RUN}`, "313-555-0142", `public.${RUN}@test.invalid`);
    await chooseWork(page);

    await page.locator("#docs").setInputFiles({ name: "photo-id.png", mimeType: "image/png", buffer: PNG });
    await expect(page.locator("#docsList")).toContainText("photo-id.png");
    await signAndConsent(page);

    await page.locator("#submitBtn").click();
    await expect(page.locator("#receiptScreen")).toHaveClass(/active/);
    await expect(page.getByText("تم استلام الطلب بنجاح")).toBeVisible();
    ref = (await page.locator("#receiptCase").innerText()).trim();
    expect(ref).toMatch(/^ALH-\d{8}-[A-Z0-9]{4}$/);
    await expect(page.locator("#statusView")).toHaveText("COMPLETED");

    const apps = await db()`
      select a.id,a.client_id,a.case_number,a.status,c.source,c.current_status,c.full_name
      from career_gate_applications a join clients c on c.id=a.client_id
      where a.case_number=${ref}`;
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ case_number: ref, status: "new_intake", source: "public_intake", current_status: "new_intake" });
    expect(String(apps[0].full_name)).toBe(`TEST Public-${RUN}`);

    const prefs = await db()`select rank,preference_order,site_code,shift_code,shift_period,dispatch_mode from client_preferences where client_id=${apps[0].client_id} order by preference_order`;
    expect(prefs).toHaveLength(1);
    expect(prefs[0]).toMatchObject({ rank: "primary", preference_order: 1, shift_code: "FHD" });

    const docs = await db()`select file_name,status,sha256,upload_confirmed_at from documents where client_id=${apps[0].client_id} order by created_at`;
    expect(docs.length).toBeGreaterThanOrEqual(2);
    expect(docs.some((d) => d.file_name === "photo-id.png")).toBe(true);
    expect(docs.every((d) => Boolean(d.upload_confirmed_at))).toBe(true);
    expect(docs.every((d) => /^[0-9a-f]{64}$/.test(String(d.sha256)))).toBe(true);

    await expect(page.locator("#receiptTrackLink")).toHaveAttribute("href", new RegExp(`case=${ref}$`));
    await context.close();
  });

  test("failed required attachment keeps the application and draft, then retries without duplicates", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": uniqueIp() } });
    const page = await context.newPage();
    await openPublicForm(page);
    const email = `retry.${RUN}@test.invalid`;
    await fillIdentity(page, `Retry-${RUN}`, "313-555-0153", email);
    await chooseWork(page);
    await page.locator("#docs").setInputFiles({ name: "retry-id.png", mimeType: "image/png", buffer: PNG });
    await signAndConsent(page);

    let injected = false;
    await page.route("**/api/intake/documents", async (route) => {
      if (!injected) {
        injected = true;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: { message: "Injected upload failure" } }),
        });
        return;
      }
      await route.continue();
    });

    await page.locator("#submitBtn").click();
    await expect(page.locator("#statusView")).toHaveText("ATTACHMENT_FAILED");
    await expect(page.locator("#receiptScreen")).not.toHaveClass(/active/);
    await expect(page.locator("#submitBtn")).toHaveText("إعادة محاولة المرفقات");
    await expect(page.locator("#docsList")).toContainText("FAILED");

    const first = await db()`
      select a.id,a.client_id,a.case_number
      from career_gate_applications a join clients c on c.id=a.client_id
      where lower(c.email)=lower(${email})`;
    expect(first).toHaveLength(1);
    const draftBeforeRetry = await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("alhijrah.career.form", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<boolean>((resolve, reject) => {
          const request = database.transaction("draft", "readonly").objectStore("draft").get("main");
          request.onsuccess = () => resolve(Boolean(request.result));
          request.onerror = () => reject(request.error);
        });
      } finally {
        database.close();
      }
    });
    expect(draftBeforeRetry).toBe(true);

    await page.unroute("**/api/intake/documents");
    await page.locator("#submitBtn").click();
    await expect(page.locator("#receiptScreen")).toHaveClass(/active/);
    await expect(page.locator("#statusView")).toHaveText("COMPLETED");

    const after = await db()`
      select a.id,a.client_id,a.case_number
      from career_gate_applications a join clients c on c.id=a.client_id
      where lower(c.email)=lower(${email})`;
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(first[0].id);
    const docs = await db()`select file_name,upload_key from documents where client_id=${after[0].client_id} order by created_at`;
    expect(docs.filter((d) => d.file_name === "retry-id.png")).toHaveLength(1);
    expect(docs.filter((d) => d.file_name === "signature.png")).toHaveLength(1);

    const draftAfterSuccess = await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("alhijrah.career.form", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<boolean>((resolve, reject) => {
          const request = database.transaction("draft", "readonly").objectStore("draft").get("main");
          request.onsuccess = () => resolve(Boolean(request.result));
          request.onerror = () => reject(request.error);
        });
      } finally {
        database.close();
      }
    });
    expect(draftAfterSuccess).toBe(false);
    await context.close();
  });

  test("idempotent intake submit: replay returns the same result; a changed payload is a 409", async ({ request }) => {
    const body = intakeBody(`TEST Idem ${RUN}`);
    const first = await submitIntake(request, body);
    expect(first.res.status()).toBe(201);
    expect(first.json.ref).toMatch(/^CG-\d{4}-\d{6}$/);
    const again = await submitIntake(request, body, first.key, first.ip);
    expect(again.json.ref).toBe(first.json.ref);
    expect(again.json.replayed).toBe(true);
    const [{ n }] = await db()`select count(*)::int as n from clients where full_name = ${`TEST Idem ${RUN}`}`;
    expect(n).toBe(1);
    const changed = await submitIntake(request, { ...body, communication_consent: false }, first.key, first.ip);
    expect(changed.res.status()).toBe(409);
    expect(changed.json.error.code).toBe("idempotency_conflict");
    const missingKey = await request.post("/api/intake", { data: body });
    expect(missingKey.status()).toBe(400);
  });

  test("server re-validates catalog relations, consent and signature", async ({ request }) => {
    test.skip(!FIXTURE_CATALOG, "needs the test catalog");
    const bad = (extra: Record<string, unknown>) => submitIntake(request, intakeBody(`TEST Bad ${RUN}-${crypto.randomUUID()}`, extra));
    expect((await bad({ primary: [{ site_code: "TST2", job_id: "J-A", shift_code: "S1" }] })).json.error.code).toBe("invalid_preferences");
    expect((await bad({ primary: [{ site_code: "TST1", job_id: "J-CLOSED", shift_code: "S3" }] })).json.error.code).toBe("invalid_preferences");
    expect((await bad({ primary: [{ site_code: "TST3", job_id: "J-C", shift_code: "S1" }] })).json.error.code).toBe("invalid_preferences");
    expect((await bad({ primary: [{ site_code: "UNKNOWN", job_id: "J-D", shift_code: "S1" }] })).json.error.code).toBe("invalid_preferences");
    expect((await bad({ primary: [{ site_code: "TST1", job_id: "J-A", shift_code: "S3" }] })).json.error.code).toBe("invalid_preferences");
    expect((await bad({ primary: [{ site_code: "TST1", job_id: "J-A", shift_code: "S1" }], backup: [{ site_code: "TST1", job_id: "J-A", shift_code: "S1" }] })).json.error.code).toBe("invalid_preferences");
    expect((await bad({ authorization: { version: "2026-09-28.1", accepted: false, accuracy_acknowledged: true, printed_name: "A B", signature: "A B" } })).res.status()).toBe(400);
    expect((await bad({ authorization: { version: "2026-09-28.1", accepted: true, accuracy_acknowledged: true, printed_name: "A B", signature: "Someone Else" } })).json.error.code).toBe("invalid_signature");
  });

  test("intake rate limit: one accepted submission per 5 minutes per IP", async ({ request }) => {
    const ip = uniqueIp();
    expect((await submitIntake(request, intakeBody(`TEST Rate A ${RUN}`), undefined, ip)).res.status()).toBe(201);
    const second = await submitIntake(request, intakeBody(`TEST Rate B ${RUN}`), undefined, ip);
    expect(second.res.status()).toBe(429);
  });

  test("direct status lookup works by reference, email and phone without OTP and stays public-safe", async ({ browser, baseURL, request }) => {
    expect(ref).toMatch(/^ALH-\d{8}-[A-Z0-9]{4}$/);
    const [client] = await db()`
      select c.full_name,c.email,c.phone
      from career_gate_applications a join clients c on c.id=a.client_id
      where a.case_number=${ref}`;
    expect(client).toBeTruthy();

    const lookup = async (identifier: string, ip = uniqueIp()) => {
      const response = await request.post("/api/status/lookup", { data: { identifier }, headers: { "x-forwarded-for": ip } });
      return { status: response.status(), json: await response.json() };
    };

    for (const identifier of [ref, client.email, client.phone]) {
      const result = await lookup(String(identifier));
      expect(result.status).toBe(200);
      expect(result.json.status.ref).toBe(ref);
    }
    expect((await lookup("ALH-19990101-XXXX")).status).toBe(404);

    const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": uniqueIp() } });
    const page = await context.newPage();
    await page.goto(`/status?ref=${encodeURIComponent(ref)}`);
    await expect(page.getByLabel("File number, phone or email")).toHaveValue(ref);
    await page.getByRole("button", { name: "Check Status" }).click();
    await expect(page.getByTestId("status-reference")).toHaveText(ref);
    const html = await page.content();
    for (const secret of ["photo-id.png", "1990-04-05", "1 Test St"]) expect(html).not.toContain(secret);

    await page.goto(`/status/${encodeURIComponent(ref)}`);
    await expect(page.getByTestId("status-reference")).toHaveText(ref);
    const api = await context.request.get(`/api/status/${encodeURIComponent(ref)}`);
    expect(api.status()).toBe(200);
    expect((await api.json()).status.ref).toBe(ref);
    await context.close();

    const limitedIp = uniqueIp();
    for (let i = 0; i < 5; i++) await lookup(ref, limitedIp);
    expect((await lookup(ref, limitedIp)).status).toBe(429);
  });
});
