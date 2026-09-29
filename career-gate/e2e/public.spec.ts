import { expect, test } from "@playwright/test";
import { db, FIXTURE_CATALOG, intakeBody, PNG, RUN, submitIntake, uniqueIp } from "./helpers";

test.describe.serial("public intake and status access", () => {
  let ref = "";

  test("with no catalog openings the wizard says so and still accepts the request", async ({ browser, baseURL }) => {
    test.skip(FIXTURE_CATALOG, "committed-catalog run only");
    const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": uniqueIp() } });
    const page = await context.newPage();
    await page.goto("/apply");
    await expect(page.getByText("No job openings are listed right now")).toBeVisible();
    await page.getByRole("checkbox", { name: /Michigan/ }).check();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Personal information" })).toBeVisible();
    await page.getByLabel("Full name").fill(`TEST NoCatalog ${RUN}`);
    await page.getByLabel("Phone", { exact: true }).fill("313-555-0142");
    await page.getByRole("button", { name: "Next" }).click();
    await page.locator('input[name="amazon_worked_before"][value="no"]').check();
    await page.locator('input[name="amazon_applied_before"][value="no"]').check();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("When are you available for appointments?").fill("Any weekday");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("Printed Name", { exact: true }).fill(`TEST NoCatalog ${RUN}`);
    await page.getByLabel(/Signature/).fill(`TEST NoCatalog ${RUN}`);
    await page.getByText("I have read and agree").click();
    await page.getByText("ALHIJRAH SERVICES LLC is not responsible for the accuracy").click();
    await page.getByRole("button", { name: "Submit" }).click();
    ref = (await page.getByTestId("reference").innerText()).trim();
    expect(ref).toMatch(/^CG-\d{4}-\d{6}$/);
    await context.close();
  });

  test("dynamic wizard: filtering, conditional questions, documents, signature, submit", async ({ browser, baseURL }) => {
    test.skip(!FIXTURE_CATALOG, "needs the test catalog");
    const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": uniqueIp() } });
    const page = await context.newPage();
    await page.goto("/apply");
    await page.getByRole("checkbox", { name: /Michigan/ }).check();
    await page.getByRole("button", { name: "Next" }).click();

    await page.getByText("Testville", { exact: true }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Test Site One (TST1)")).toBeVisible();
    await expect(page.getByText("Test Site Two (TST2)")).toHaveCount(0);
    await expect(page.getByText(/Inactive Site/)).toHaveCount(0);
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByText("Othertown", { exact: true }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByText("Test Site One (TST1)").click();
    await page.getByText("Test Site Two (TST2)").click();
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByText("Test Job A")).toBeVisible();
    await expect(page.getByText("Test Job B")).toBeVisible();
    await page.getByText("Test Job A").click();
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByText(/S3/)).toHaveCount(0);
    await expect(page.getByText(/Closed Job|Not Verified Job|Unknown Site Job/)).toHaveCount(0);
    await page.getByText(/Test Job A — S2/).click();
    await page.getByText(/Test Job A — S1/).click();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.locator('fieldset input[type="checkbox"]:disabled')).toHaveCount(2);
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByText("$2.22/hr (fixture)")).toBeVisible();
    await expect(page.getByText("$1.11/hr (fixture)")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();

    await page.getByLabel("Full name").fill(`TEST Public ${RUN}`);
    await page.getByLabel("Phone", { exact: true }).fill("313-555-0142");
    await page.getByLabel("Email", { exact: true }).fill(`public.${RUN}@test.invalid`);
    await page.getByLabel("Date of birth").fill("1990-04-05");
    await page.getByLabel("Street address").fill("1 Test St");
    await page.getByLabel("City", { exact: true }).fill("Dearborn");
    await page.getByLabel("ZIP").fill("48126");
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByLabel("From", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
    await page.locator('input[name="amazon_worked_before"][value="yes"]').check();
    await page.getByLabel("From", { exact: true }).fill("2021-01-01");
    await page.getByLabel("To", { exact: true }).fill("2022-06-30");
    await page.locator('input[name="amazon_applied_before"][value="no"]').check();
    await expect(page.getByLabel(/Amazon email used/)).toHaveCount(0);
    await page.locator('input[name="amazon_applied_before"][value="yes"]').check();
    await page.getByLabel(/Amazon email used/).fill(`amz.${RUN}@test.invalid`);
    await page.locator('input[name="currently_amazon"][value="no"]').check();
    await page.locator('input[name="via_agency"][value="no"]').check();
    await page.getByRole("button", { name: "Next" }).click();

    await page.getByRole("button", { name: "+ Add employment" }).click();
    await page.getByLabel("Company").fill("Example Logistics");
    await page.getByLabel("Job title / type").fill("Picker");
    await page.getByLabel("From", { exact: true }).fill("2023-01-01");
    await page.getByRole("button", { name: "Next" }).click();

    await page.getByLabel("When are you available for appointments?").fill("Weekdays after 2pm");
    await page.getByRole("button", { name: "Next" }).click();

    await page.getByLabel("Choose file").setInputFiles({ name: "photo-id.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByText("Photo ID — photo-id.png")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByTestId("authorization-text")).toContainText("I authorize ALHIJRAH SERVICES LLC to submit job applications on my behalf to Amazon.");
    const submit = page.getByRole("button", { name: "Submit" });
    await expect(submit).toBeDisabled();
    await page.getByLabel("Printed Name", { exact: true }).fill(`TEST Public ${RUN}`);
    await page.getByLabel(/Signature/).fill(`TEST Public ${RUN}`);
    await page.getByText("I have read and agree").click();
    await page.getByText("ALHIJRAH SERVICES LLC is not responsible for the accuracy").click();
    await page.getByText(/may contact me about this request/).click();
    await submit.click();

    const result = page.getByTestId("submit-result");
    await expect(result).toContainText("Career Gate has received your employment request.");
    await expect(result).toContainText("We will contact you regarding the next available step.");
    ref = (await page.getByTestId("reference").innerText()).trim();
    expect(ref).toMatch(/^CG-\d{4}-\d{6}$/);
    await expect(result.getByRole("alert")).toHaveCount(0);
    await expect(page.getByTestId("confirmation-state")).toContainText("No automatic confirmation message was sent");
    await expect(page.getByRole("link", { name: "Track Status" })).toHaveAttribute("href", `/status?ref=${ref}`);

    const clients = await db()`select id, source, current_status from clients where ref = ${ref}`;
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ source: "public_intake", current_status: "new_intake" });
    const prefs = await db()`select rank, preference_order, shift_code, pay_snapshot, catalog_version, amazon_job_id, source_url, source_verified_at, pay_detail from client_preferences where client_id = ${clients[0].id} order by preference_order`;
    expect(prefs[0]).toMatchObject({ amazon_job_id: "J-A", source_url: "https://www.amazon.jobs/en/jobs/TEST-FIXTURE-A", source_verified_at: "2026-01-01T00:00:00Z" });
    expect(prefs[0].pay_detail).toMatchObject({ pay_status: "PUBLISHED", display_pay: "$2.22/hr (fixture)" });
    expect(prefs.map((p) => [p.rank, p.preference_order, p.shift_code, p.pay_snapshot])).toEqual([
      ["primary", 1, "S2", "$2.22/hr (fixture)"], ["primary", 2, "S1", "$1.11/hr (fixture)"],
    ]);
    expect(prefs[0].catalog_version).toMatch(/^fnv1a64:/);
    const [auth] = await db()`select printed_name, signature, authorization_version, signed_at from client_authorizations where client_id = ${clients[0].id}`;
    expect(auth).toMatchObject({ printed_name: `TEST Public ${RUN}`, authorization_version: "2026-09-26.1" });
    const notes = await db()`select channel, status from notifications where client_id = ${clients[0].id} order by channel`;
    expect(notes.map((n) => `${n.channel}:${n.status}`)).toEqual(["email:not_configured", "sms:not_configured", "whatsapp:not_configured"]);
    const docs = await db()`select status, sha256 from documents where client_id = ${clients[0].id}`;
    expect(docs).toHaveLength(1);
    expect(docs[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    const acts = (await db()`select action from activity_log where client_id = ${clients[0].id}`).map((a) => a.action);
    expect(acts).toEqual(expect.arrayContaining(["client_created", "document_uploaded", "notification_not_configured"]));
    await context.close();
  });

  test("idempotent submit: replay returns the same result; a changed payload is a 409", async ({ request }) => {
    const body = intakeBody(`TEST Idem ${RUN}`);
    const first = await submitIntake(request, body);
    expect(first.res.status()).toBe(201);
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
    let serial = 0;
    const bad = (extra: Record<string, unknown>) => submitIntake(request, intakeBody(`TEST Bad ${RUN} ${serial++}`, extra));
    expect((await bad({ primary: [{ site_code: "TST2", job_id: "J-A", shift_code: "S1" }] })).json.error.code).toBe("invalid_preferences");
    expect((await bad({ primary: [{ site_code: "TST1", job_id: "J-CLOSED", shift_code: "S3" }] })).json.error.code).toBe("invalid_preferences");
    expect((await bad({ primary: [{ site_code: "TST3", job_id: "J-C", shift_code: "S1" }] })).json.error.code).toBe("invalid_preferences");
    expect((await bad({ primary: [{ site_code: "UNKNOWN", job_id: "J-D", shift_code: "S1" }] })).json.error.code).toBe("invalid_preferences");
    expect((await bad({ primary: [{ site_code: "TST1", job_id: "J-A", shift_code: "S3" }] })).json.error.code).toBe("invalid_preferences");
    expect((await bad({ primary: [{ site_code: "TST1", job_id: "J-A", shift_code: "S1" }], backup: [{ site_code: "TST1", job_id: "J-A", shift_code: "S1" }] })).json.error.code).toBe("invalid_preferences");
    expect((await bad({ authorization: { version: "2026-09-26.1", accepted: false, accuracy_acknowledged: true, printed_name: "A B", signature: "A B" } })).res.status()).toBe(400);
    expect((await bad({ authorization: { version: "2026-09-26.1", accepted: true, accuracy_acknowledged: true, printed_name: "A B", signature: "Someone Else" } })).json.error.code).toBe("invalid_signature");
  });

  test("intake rate limit: one accepted submission per 5 minutes per IP", async ({ request }) => {
    const ip = uniqueIp();
    expect((await submitIntake(request, intakeBody(`TEST Rate A ${RUN}`), undefined, ip)).res.status()).toBe(201);
    const second = await submitIntake(request, intakeBody(`TEST Rate B ${RUN}`), undefined, ip);
    expect(second.res.status()).toBe(429);
  });

  test("status lookup is direct by file, email or phone and the status page is public", async ({ browser, baseURL, request }) => {
    const look = async (identifier: string, ip = uniqueIp()) => {
      const r = await request.post("/api/status/lookup", { data: { identifier }, headers: { "x-forwarded-for": ip } });
      return { status: r.status(), json: await r.json() };
    };

    const valid = await look(ref);
    expect(valid.status).toBe(200);
    expect(valid.json.status.ref).toBe(ref);
    expect(valid.json.status.status_label).toBe("New Intake");

    const invalid = await look("CG-1999-000001");
    expect(invalid.status).toBe(404);
    expect(invalid.json.error.code).toBe("not_found");

    const phone = await look("(313) 555-0142");
    expect(phone.status).toBe(200);
    expect(phone.json.status.ref).toBe(ref);

    if (FIXTURE_CATALOG) {
      const email = await look(`public.${RUN}@test.invalid`);
      expect(email.status).toBe(200);
      expect(email.json.status.ref).toBe(ref);
    }

    const ctx = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": uniqueIp() } });
    const page = await ctx.newPage();
    await page.goto(`/status?ref=${encodeURIComponent(ref)}`);
    await expect(page.getByLabel("File number, phone or email")).toHaveValue(ref);
    await page.getByRole("button", { name: "Check Status" }).click();
    await expect(page.getByTestId("status-reference")).toHaveText(ref);
    await expect(page.getByTestId("status-current-status")).toHaveText("New Intake");

    const html = await page.content();
    for (const secret of [`amz.${RUN}`, "photo-id.png", "5550142", "Example Logistics", "1990-04-05"]) expect(html, secret).not.toContain(secret);

    await page.goto(`/status/${encodeURIComponent(ref)}`);
    await expect(page.getByTestId("status-page")).toBeVisible();
    await expect(page.getByTestId("status-reference")).toHaveText(ref);
    const api = await ctx.request.get(`/api/status/${encodeURIComponent(ref)}`);
    expect(api.status()).toBe(200);
    expect((await api.json()).status.ref).toBe(ref);

    await page.goto("/status/CG-1999-000001");
    await expect(page.getByTestId("status-not-found")).toBeVisible();
    await ctx.close();
  });

  test("status lookup rate limit rejects the sixth lookup in 15 minutes", async ({ request }) => {
    const ip = uniqueIp();
    for (let i = 0; i < 5; i++) {
      const r = await request.post("/api/status/lookup", { data: { identifier: `CG-1999-${String(i + 1).padStart(6, "0")}` }, headers: { "x-forwarded-for": ip } });
      expect(r.status()).toBe(404);
    }
    const blocked = await request.post("/api/status/lookup", { data: { identifier: "CG-1999-999999" }, headers: { "x-forwarded-for": ip } });
    expect(blocked.status()).toBe(429);
  });
});
