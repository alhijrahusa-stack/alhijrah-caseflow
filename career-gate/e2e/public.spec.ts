import { expect, test } from "@playwright/test";
import { db, FIXTURE_CATALOG, intakeBody, RUN, seedOtp, submitIntake, uniqueIp } from "./helpers";

test.describe.serial("public intake and status access", () => {
  let ref = "";

  test("current public apply entry redirects to the production form", async ({ page }) => {
    await page.goto("/apply");
    await page.waitForURL("**/career-gate.html");
    expect(new URL(page.url()).pathname).toBe("/career-gate.html");
  });

  test("intake API accepts a current request and persists canonical data", async ({ request }) => {
    const name = `TEST Public ${RUN}`;
    const body = intakeBody(name);
    body.profile = {
      ...body.profile,
      phone: "3135550142",
      email: `public.${RUN}@test.invalid`,
    };
    if (FIXTURE_CATALOG) {
      body.primary = [
        { site_code: "TST1", job_id: "J-A", shift_code: "S2" },
        { site_code: "TST1", job_id: "J-A", shift_code: "S1" },
      ];
    }

    const submitted = await submitIntake(request, body);
    expect(submitted.res.status()).toBe(201);
    expect(submitted.json.ok).toBe(true);
    ref = String(submitted.json.ref ?? "");
    expect(ref).toMatch(/^CG-\d{4}-\d{6}$/);

    const clients = await db()`select id, source, current_status from clients where ref = ${ref}`;
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ source: "public_intake", current_status: "new_intake" });

    const [auth] = await db()`select printed_name, authorization_version from client_authorizations where client_id = ${clients[0].id}`;
    expect(auth).toMatchObject({ printed_name: name, authorization_version: "2026-09-28.1" });

    if (FIXTURE_CATALOG) {
      const prefs = await db()`select rank, preference_order, shift_code, pay_snapshot, amazon_job_id, source_url, source_verified_at, pay_detail from client_preferences where client_id = ${clients[0].id} order by preference_order`;
      expect(prefs.map((p) => [p.rank, p.preference_order, p.shift_code, p.pay_snapshot])).toEqual([
        ["primary", 1, "S2", "$2.22/hr (fixture)"],
        ["primary", 2, "S1", "$1.11/hr (fixture)"],
      ]);
      expect(prefs[0]).toMatchObject({ amazon_job_id: "J-A", source_url: "https://www.amazon.jobs/en/jobs/TEST-FIXTURE-A", source_verified_at: "2026-01-01T00:00:00Z" });
      expect(prefs[0].pay_detail).toMatchObject({ pay_status: "PUBLISHED", display_pay: "$2.22/hr (fixture)" });
    }
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
    const bad = (extra: Record<string, unknown>) => submitIntake(request, intakeBody(`TEST Bad ${RUN}`, extra));
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

  test("status lookup gives the same response for any identifier; OTP gates the page", async ({ browser, baseURL, request }) => {
    const ip = uniqueIp();
    const look = async (identifier: string) => {
      const r = await request.post("/api/status/lookup", { data: { identifier }, headers: { "x-forwarded-for": ip } });
      return { status: r.status(), json: await r.json() };
    };
    const [valid, invalid] = [await look(ref), await look("CG-1999-000001")];
    expect(valid.status).toBe(200);
    expect(invalid.status).toBe(200);
    expect(valid.json.message).toBe(invalid.json.message);
    const [vEmail, iEmail] = [await look(`public.${RUN}@test.invalid`), await look("nobody@test.invalid")];
    expect(vEmail.json.message).toBe(iEmail.json.message);
    expect((await look("(313) 555-0142")).json.message).toBe(valid.json.message);
    expect((await look("(313) 555-0000")).status).toBe(429);

    const anon = await browser.newContext({ baseURL });
    const p0 = await anon.newPage();
    await p0.goto(`/status/${ref}`);
    await expect(p0.getByTestId("status-locked")).toBeVisible();
    expect((await anon.request.get(`/api/status/${ref}`)).status()).toBe(401);

    const ctx = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": uniqueIp() } });
    const page = await ctx.newPage();
    await page.goto(`/status?ref=${ref}`);
    await expect(page.getByLabel(/Reference/)).toHaveValue(ref);
    const lookupResp = page.waitForResponse("**/api/status/lookup");
    await page.getByRole("button", { name: "Send me a code" }).click();
    const { challenge_id } = await (await lookupResp).json();
    expect(await seedOtp(challenge_id, "246810")).toBe(true);
    await page.getByLabel("6-digit code").fill("111111");
    await page.getByRole("button", { name: "View status" }).click();
    await expect(page.locator("p[role=alert]")).toContainText("not valid");
    await page.getByLabel("6-digit code").fill("246810");
    await page.getByRole("button", { name: "View status" }).click();
    await page.waitForURL(`**/status/${ref}`);
    await expect(page.getByTestId("status-reference")).toHaveText(ref);
    await expect(page.getByTestId("status-current-status")).toHaveText("New Intake");
    const cookies = await ctx.cookies();
    const sess = cookies.find((c) => c.name === "cg_status");
    expect(sess?.httpOnly).toBe(true);
    expect(page.url()).not.toContain(sess!.value);
    await page.goto(`/status/CG-1999-000001`);
    await expect(page.getByTestId("status-locked")).toBeVisible();
    await ctx.close();
    await anon.close();
  });

  test("OTP lockout after three wrong codes", async ({ request }) => {
    const r = await request.post("/api/status/lookup", { data: { identifier: ref }, headers: { "x-forwarded-for": uniqueIp() } });
    const { challenge_id } = await r.json();
    await seedOtp(challenge_id, "135791");
    const verify = (code: string) => request.post("/api/status/verify", { data: { challenge_id, code }, headers: { "x-forwarded-for": uniqueIp() } });
    expect((await verify("000000")).status()).toBe(400);
    expect((await verify("000001")).status()).toBe(400);
    expect((await verify("000002")).status()).toBe(429);
    expect((await verify("135791")).status()).toBe(429);
  });
});
