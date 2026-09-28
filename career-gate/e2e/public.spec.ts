import { expect, test } from "@playwright/test";
import { db, FIXTURE_CATALOG, intakeBody, PNG, RUN, submitIntake, uniqueIp } from "./helpers";

test.describe.serial("public intake and status access", () => {
  let ref = "";

  test("current public Career Gate form submits, uploads documents, and persists the application", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": uniqueIp() } });
    const page = await context.newPage();
    await page.goto("/apply");
    await page.waitForURL("**/career-gate.html");

    await page.locator("#firstName").fill("TEST");
    await page.locator("#lastName").fill(`Public-${RUN}`);
    await page.locator("#phone").fill("313-555-0142");
    await page.locator("#email").fill(`public.${RUN}@test.invalid`);
    await page.locator("#dob").fill("1990-04-05");
    await page.locator("#address1").fill("1 Test St");
    await page.locator("#city").fill("Dearborn");
    await page.locator("#state").fill("MI");
    await page.locator("#zip").fill("48126");
    await page.locator('[data-next="2"]').click();

    await page.locator('input[name="workType"][value="Full-Time"]').check({ force: true });
    await expect(page.locator("#shiftSelector")).toBeVisible();
    await page.locator('input[name="shift"][value="FHD"]').check({ force: true });
    await page.locator("#employmentStatus").selectOption({ label: "Unemployed" });
    await page.locator("#hasExperience").selectOption({ label: "No" });
    await page.locator("#englishLevel").selectOption({ label: "Good" });
    await page.locator('[data-next="3"]').click();

    await page.locator("#docs").setInputFiles({ name: "photo-id.png", mimeType: "image/png", buffer: PNG });
    await expect(page.locator("#docsList")).toContainText("photo-id.png");

    const canvas = page.locator("#signature");
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + 30, box!.y + 70);
    await page.mouse.down();
    await page.mouse.move(box!.x + 90, box!.y + 95, { steps: 5 });
    await page.mouse.move(box!.x + 150, box!.y + 55, { steps: 5 });
    await page.mouse.up();
    await page.locator("#consent").check({ force: true });

    await page.locator("#submitBtn").click();
    await expect(page.locator("#receiptScreen")).toHaveClass(/active/);
    await expect(page.getByText("تم استلام الطلب بنجاح")).toBeVisible();
    ref = (await page.locator("#receiptCase").innerText()).trim();
    expect(ref).toMatch(/^ALH-\d{8}-[A-Z0-9]{4}$/);
    await expect(page.locator("#statusView")).toHaveText("Submitted");

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
