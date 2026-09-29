import { expect, test } from "@playwright/test";
import { db, FIXTURE_CATALOG, intakeBody, RUN, submitIntake, uniqueIp } from "./helpers";

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
    body.profile = { ...body.profile, phone: "3135550142", email: `public.${RUN}@test.invalid` };
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

  test("direct public status lookup returns current file data and 404 for unknown identifiers", async ({ page, request }) => {
    const ip = uniqueIp();
    const lookup = async (identifier: string) => {
      const response = await request.post("/api/status/lookup", { data: { identifier }, headers: { "x-forwarded-for": ip } });
      return { status: response.status(), json: await response.json() };
    };
    const valid = await lookup(ref);
    expect(valid.status).toBe(200);
    expect(valid.json.ok).toBe(true);
    expect(valid.json.ref).toBe(ref);
    const byEmail = await lookup(`public.${RUN}@test.invalid`);
    expect(byEmail.status).toBe(200);
    expect(byEmail.json.ref).toBe(ref);
    const byPhone = await lookup("(313) 555-0142");
    expect(byPhone.status).toBe(200);
    expect(byPhone.json.ref).toBe(ref);
    const missing = await lookup("CG-1999-000001");
    expect(missing.status).toBe(404);
    expect(missing.json.error.code).toBe("not_found");

    await page.goto(`/status?ref=${ref}`);
    await expect(page.getByLabel("File number, phone or email")).toHaveValue(ref);
    await page.getByRole("button", { name: "Check Status" }).click();
    await expect(page.getByTestId("status-page")).toBeVisible();
    await expect(page.getByText(ref, { exact: true })).toBeVisible();
    await expect(page.getByText("New Intake", { exact: true })).toBeVisible();
  });
});
