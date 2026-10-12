import { createHash, randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { accessToken, db, RUN, signIn, STAFF, uniqueIp } from "./helpers";

/**
 * The one-time client intake link, end to end.
 *
 * A staff member issues a link; the client opens it with no session at all,
 * enters their details, corrects a detected value, attaches a document and
 * submits. The submission must reach the existing Smart Client Import staging
 * and the link must then be spent for good.
 */

/**
 * A letters-only run tag. The deterministic extractor declines a free-text line
 * containing digits as a name — correctly, since a name has none — so a unique
 * fixture name must not carry the numeric run id.
 */
const NAME_TAG = RUN.replace(/[0-9]/g, (digit) => "abcdefghij"[Number(digit)]);

const PNG_1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907724" +
  "7f0000000a49444154089963000100000500010d0a2db40000000049454e44ae426082",
  "hex",
);

async function issueLink(page: Page, caseNumber?: string) {
  const res = await page.request.post("/api/staff/client-intake-link", {
    data: caseNumber ? { case_number: caseNumber } : {},
    headers: { cookie: `cg_at=${await accessToken("admin")}`, "x-forwarded-for": uniqueIp() },
  });
  const json = await res.json();
  expect(res.status(), JSON.stringify(json)).toBe(201);
  return { id: String(json.id), url: String(json.url), token: String(json.url).split("/intake/")[1] };
}

test.describe.serial("Career Gate one-time client intake link", () => {
  let staffPage: Page;

  test.beforeAll(async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL });
    await signIn(ctx, baseURL!, "admin");
    staffPage = await ctx.newPage();
  });

  test("the staff panel sits above the existing Smart import form and issues a link", async () => {
    await staffPage.goto("/staff/smart-client-import/new");
    const panel = staffPage.getByTestId("client-intake-link-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("CLIENT SELF-INTAKE");
    await expect(panel).toContainText("رابط إدخال العميل");
    // The existing form is untouched and still present below it.
    await expect(staffPage.getByRole("heading", { name: "SMART CLIENT IMPORT" })).toBeVisible();
    await expect(staffPage.locator("#smart-source-text")).toBeVisible();

    await panel.getByTestId("generate-client-link").click();
    const url = panel.getByTestId("client-link-url");
    await expect(url).toHaveValue(/\/intake\/[A-Za-z0-9_-]{32,}/);
    await expect(panel.getByTestId("intake-link-status")).toHaveText("ACTIVE");
    await expect(panel.getByTestId("client-link-expiry")).toContainText("single use");
  });

  test("plain staff cannot issue a link", async ({ request }) => {
    const res = await request.post("/api/staff/client-intake-link", {
      data: {},
      headers: { cookie: `cg_at=${await accessToken("staff")}`, "x-forwarded-for": uniqueIp() },
    });
    expect(res.status()).toBe(403);
  });

  test("an unauthenticated visitor cannot issue or revoke a link", async ({ request }) => {
    expect((await request.post("/api/staff/client-intake-link", { data: {} })).status()).toBe(401);
    expect((await request.delete("/api/staff/client-intake-link", { data: { link_id: randomUUID() } })).status()).toBe(401);
  });

  test("an invalid token is not found and reveals nothing about other tokens", async ({ page, request }) => {
    const bogus = createHash("sha256").update(RUN).digest("hex").slice(0, 43);
    await page.goto(`/intake/${bogus}`);
    await expect(page.getByTestId("intake-closed")).toBeVisible();
    await expect(page.getByTestId("intake-closed")).toContainText("رابط غير صالح");

    const res = await request.post(`/api/public/client-intake/${bogus}`, { multipart: { source_text: "probe" } });
    expect(res.status()).toBe(404);
  });

  test("the client page needs no login, is bilingual, and offers camera capture", async ({ page }) => {
    const link = await issueLink(staffPage);
    // A brand new browser context with no staff cookie whatsoever.
    await page.goto(`/intake/${link.token}`);

    // Arabic by default, right to left.
    await expect(page.locator("div[dir]").first()).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("intake-source")).toContainText("أدخل بياناتك هنا");
    await expect(page.getByTestId("intake-upload")).toContainText("ارفع الوثائق هنا");
    await expect(page.getByTestId("intake-submit")).toHaveText("إرسال");

    // One page, both languages.
    await page.getByTestId("locale-en").click();
    await expect(page.locator("div[dir]").first()).toHaveAttribute("dir", "ltr");
    await expect(page.getByTestId("intake-source")).toContainText("Enter your information here");
    await expect(page.getByTestId("intake-upload")).toContainText("Upload your documents here");
    await expect(page.getByTestId("intake-submit")).toHaveText("Submit");

    // Camera capture is a dedicated input, so a phone opens the camera.
    const camera = page.getByTestId("intake-take-photo");
    await expect(camera).toHaveAttribute("capture", "environment");
    await expect(camera).toHaveAttribute("accept", "image/*");
    await expect(page.getByTestId("intake-choose-files")).toHaveAttribute("accept", /application\/pdf/);

    // Nothing staff-facing is on the page. The word "review" appears in the
    // client's own instruction ("review the detected data"), so what matters is
    // that no staff control, internal status or internal identifier is present.
    for (const control of ["Verify", "Approve", "Mark Reviewed", "Telemetry", "Digital Handshake"]) {
      await expect(page.getByRole("button", { name: new RegExp(control, "i") }), control).toHaveCount(0);
    }
    const body = await page.locator("body").innerText();
    for (const internal of ["PENDING", "UNDER_REVIEW", "APPROVED_FILE", "batch_id", "case_id", "idempotency"]) {
      expect(body, internal).not.toContain(internal);
    }
    // No UUID of any kind is rendered to the client.
    expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    // No staff navigation.
    await expect(page.locator('a[href^="/staff"]')).toHaveCount(0);

    // Not indexable: the URL carries a secret.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("the Smart Guide is local, step-aware, minimizable and reopenable", async ({ page }) => {
    const link = await issueLink(staffPage);
    let guidanceRequests = 0;
    page.on("request", (request) => { if (/guide|assist|chat|llm/i.test(request.url())) guidanceRequests += 1; });

    await page.goto(`/intake/${link.token}`);
    await page.getByTestId("locale-en").click();
    const guide = page.getByTestId("smart-guide");
    await expect(guide).toContainText("Smart Guide");
    await expect(page.getByTestId("smart-guide-message")).toContainText("Welcome");

    // The message follows the client's context, with no request of its own.
    await page.getByTestId("intake-source-text").fill("Hana Guide Tester");
    await expect(page.getByTestId("smart-guide-message")).toContainText("documents");
    await page.getByTestId("intake-choose-files").setInputFiles({ name: "doc.png", mimeType: "image/png", buffer: PNG_1x1 });
    await expect(page.getByTestId("smart-guide-message")).toContainText("ready");

    // A validation problem moves it to the issue hint.
    await page.getByTestId("intake-field-phone").fill("12");
    await expect(page.getByTestId("smart-guide-message")).toContainText("correct the field");

    // Minimizable and reopenable, never blocking.
    await page.getByTestId("smart-guide-minimize").click();
    await expect(guide).toHaveCount(0);
    await page.getByTestId("smart-guide-open").click();
    await expect(page.getByTestId("smart-guide")).toBeVisible();

    expect(guidanceRequests).toBe(0);

    // Arabic guidance is the exact required wording.
    await page.getByTestId("locale-ar").click();
    await page.getByTestId("intake-field-phone").fill("");
    await page.getByTestId("intake-source-text").fill("");
    await expect(page.getByTestId("smart-guide")).toContainText("الموجّه الذكي");
  });

  test("inline validation is exact, blocks submit, and never loses what was typed", async ({ page }) => {
    const link = await issueLink(staffPage);
    await page.goto(`/intake/${link.token}`);
    await page.getByTestId("locale-en").click();

    await page.getByTestId("intake-source-text").fill("Lina Validation Tester\nphone 313-555-0133");
    await expect(page.getByTestId("intake-field-phone")).toHaveValue("3135550133");
    // A field the extraction did not find is still offered, empty, so the
    // client can supply it rather than being unable to.
    await expect(page.getByTestId("intake-field-email")).toHaveValue("");
    await expect(page.getByTestId("intake-field-zip")).toHaveValue("");

    await page.getByTestId("intake-field-phone").fill("12345");
    await expect(page.getByTestId("intake-error-phone")).toHaveText("Enter a valid 10-digit US phone number.");
    await expect(page.getByTestId("intake-field-phone")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByTestId("intake-submit")).toBeDisabled();

    // Correcting it clears the error and re-enables submit; the source is intact.
    await page.getByTestId("intake-field-phone").fill("3135550144");
    await expect(page.getByTestId("intake-error-phone")).toHaveCount(0);
    await expect(page.getByTestId("intake-submit")).toBeEnabled();
    await expect(page.getByTestId("intake-source-text")).toHaveValue(/Lina Validation Tester/);

    // Mobile-appropriate input affordances.
    await expect(page.getByTestId("intake-field-phone")).toHaveAttribute("inputmode", "tel");
    await expect(page.getByTestId("intake-field-email")).toHaveAttribute("type", "email");
  });

  test("a chosen document previews locally and can be replaced or removed before submit", async ({ page }) => {
    const link = await issueLink(staffPage);
    await page.goto(`/intake/${link.token}`);
    await page.getByTestId("locale-en").click();

    await page.getByTestId("intake-choose-files").setInputFiles({ name: "front.png", mimeType: "image/png", buffer: PNG_1x1 });
    const card = page.getByTestId("intake-file");
    await expect(card).toHaveCount(1);
    // Previewed from a local object URL — nothing was uploaded yet.
    await expect(card.getByTestId("intake-file-preview")).toHaveAttribute("src", /^blob:/);

    // Replace swaps the file in place, keeping exactly one attachment.
    await card.getByTestId("intake-file-replace").click();
    await page.locator('input[type="file"][aria-hidden="true"]').setInputFiles({ name: "back.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 qa") });
    await expect(page.getByTestId("intake-file")).toHaveCount(1);
    await expect(page.getByTestId("intake-file")).toContainText("back.pdf");
    // A PDF has no image preview, so the generic document mark is shown instead.
    await expect(page.getByTestId("intake-file-preview")).toHaveCount(0);

    await page.getByTestId("intake-file-remove").click();
    await expect(page.getByTestId("intake-file")).toHaveCount(0);
  });

  test("form state survives a language switch", async ({ page }) => {
    const link = await issueLink(staffPage);
    await page.goto(`/intake/${link.token}`);
    const typed = "Maya State Keeper\nphone 313-555-0122";
    await page.getByTestId("intake-source-text").fill(typed);
    await page.getByTestId("intake-choose-files").setInputFiles({ name: "kept.png", mimeType: "image/png", buffer: PNG_1x1 });
    await page.getByTestId("intake-field-city").fill("Dearborn");

    await page.getByTestId("locale-en").click();
    await expect(page.getByTestId("intake-source-text")).toHaveValue(typed);
    await expect(page.getByTestId("intake-field-city")).toHaveValue("Dearborn");
    await expect(page.getByTestId("intake-file")).toHaveCount(1);

    await page.getByTestId("locale-ar").click();
    await expect(page.getByTestId("intake-source-text")).toHaveValue(typed);
    await expect(page.getByTestId("intake-field-city")).toHaveValue("Dearborn");
    await expect(page.getByTestId("intake-file")).toHaveCount(1);
  });

  test("mobile layout has no horizontal scroll and touch targets are large enough", async ({ page }) => {
    const link = await issueLink(staffPage);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/intake/${link.token}`);
    await page.getByTestId("intake-source-text").fill("Rana Mobile Tester\nphone 313-555-0111");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    for (const id of ["intake-submit", "locale-ar", "locale-en"]) {
      const target = page.getByTestId(id);
      if ((await target.count()) === 0) continue;
      const box = await target.first().boundingBox();
      expect(box!.height, id).toBeGreaterThanOrEqual(40);
    }
    // Measured through the inputs they wrap, so this holds in either language.
    for (const id of ["intake-choose-files", "intake-take-photo"]) {
      const box = await page.locator(`label:has([data-testid="${id}"])`).boundingBox();
      expect(box!.height, id).toBeGreaterThanOrEqual(44);
    }
  });

  test("opening and refreshing the link does not consume it", async ({ page }) => {
    const link = await issueLink(staffPage);
    for (let i = 0; i < 3; i += 1) {
      await page.goto(`/intake/${link.token}`);
      await expect(page.getByTestId("intake-source")).toBeVisible();
      await page.reload();
      await expect(page.getByTestId("intake-source")).toBeVisible();
    }
    const [row] = await db()`select status,used_at from client_import_links where id=${link.id}`;
    expect(row.status).toBe("ACTIVE");
    expect(row.used_at).toBeNull();
  });

  test("live intelligence detects fields as the client types and the client can correct them", async ({ page }) => {
    const link = await issueLink(staffPage);
    await page.goto(`/intake/${link.token}`);
    await page.getByTestId("locale-en").click();

    await expect(page.getByTestId("intake-detected-empty")).toBeVisible();
    await page.getByTestId("intake-source-text").fill(
      [`Sara Intake Tester ${NAME_TAG}`, "phone 313-555-0188", "email detected@test.invalid", "Detroit MI 48212"].join("\n"),
    );

    // Detected, without a request — the existing deterministic engine, in page.
    await expect(page.getByTestId("intake-field-full_name")).toHaveValue(new RegExp(NAME_TAG));
    await expect(page.getByTestId("intake-field-phone")).toHaveValue("3135550188");
    await expect(page.getByTestId("intake-field-email")).toHaveValue("detected@test.invalid");
    await expect(page.getByTestId("intake-field-state")).toHaveValue("MI");

    // The client corrects one of them.
    await page.getByTestId("intake-field-email").fill("corrected@test.invalid");
    await expect(page.getByTestId("intake-field-email")).toHaveValue("corrected@test.invalid");
  });

  test("the client submits once: it reaches Smart staging and the link is spent", async ({ page }) => {
    const link = await issueLink(staffPage);
    await page.goto(`/intake/${link.token}`);
    await page.getByTestId("locale-en").click();

    const name = `Nadia Intake Submit ${NAME_TAG}`;
    await page.getByTestId("intake-source-text").fill(
      [name, "phone 313-555-0177", "email detected@test.invalid", "28772 Goodson St", "Detroit MI 48212"].join("\n"),
    );
    await expect(page.getByTestId("intake-field-email")).toHaveValue("detected@test.invalid");
    await page.getByTestId("intake-field-email").fill("client.corrected@test.invalid");

    await page.getByTestId("intake-choose-files").setInputFiles({ name: "id-card.png", mimeType: "image/png", buffer: PNG_1x1 });
    await expect(page.getByTestId("intake-file")).toHaveCount(1);
    await expect(page.getByTestId("intake-file")).toContainText("id-card.png");

    await page.getByTestId("intake-submit").click();
    const success = page.getByTestId("intake-success");
    await expect(success).toBeVisible({ timeout: 30000 });
    await expect(success).toContainText("submitted successfully");
    await expect(success).toContainText("closed after successful use");
    // No internal identifier is shown.
    expect(await success.innerText()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);

    // The two client-safe next steps, pointing at the existing destinations.
    await expect(success.getByTestId("intake-case-status")).toHaveAttribute("href", /^\/status\?ref=CG-\d{4}-\d{6}$/);
    await expect(success.getByTestId("intake-whatsapp")).toHaveAttribute("href", /^https:\/\/wa\.me\/1\d{10}$/);
    await expect(success.getByTestId("intake-closed-note")).toContainText("closed after successful use");

    // The link is spent and points at the case it created.
    const [row] = await db()`select status,used_at,import_case_id from client_import_links where id=${link.id}`;
    expect(row.status).toBe("USED");
    expect(row.used_at).toBeTruthy();
    expect(row.import_case_id).toBeTruthy();

    // It reached the EXISTING Smart import pipeline, attributed to the issuer,
    // with the client's correction winning over the detected value.
    const [importCase] = await db()`
      select c.status,c.source_type,c.mapped_draft,c.created_by,b.idempotency_key
      from client_import_cases c join client_import_batches b on b.id=c.batch_id
      where c.id=${row.import_case_id as string}`;
    expect(importCase.status).toBe("PENDING");
    expect(importCase.source_type).toBe("mobile");
    expect(String(importCase.idempotency_key)).toMatch(/^client-link:[0-9a-f]{64}$/);
    const [issuer] = await db()`select id from staff where auth_user_id=${STAFF.admin}`;
    expect(importCase.created_by).toBe(issuer.id);
    const profile = (importCase.mapped_draft as { profile?: Record<string, unknown> })?.profile ?? {};
    expect(profile.email).toBe("client.corrected@test.invalid");
    expect(String(profile.full_name)).toContain(NAME_TAG);

    // The document was attached to that case.
    const [{ docs }] = await db()`select count(*)::int docs from client_import_documents where import_case_id=${row.import_case_id as string}`;
    expect(docs).toBe(1);
  });



  test("a staff-bound Client Intake Link updates the ORIGINAL case without creating another", async ({ page, request }) => {
    const original = await issueLink(staffPage);
    const name = `Bound Applicant ${NAME_TAG}`;
    const email = `bound-${RUN}@test.invalid`;
    const initial = await request.post(`/api/public/client-intake/${original.token}`, {
      multipart: {
        source_text: `Full Name: ${name}\nDate of Birth: 1994-05-15\nEmail: ${email}\nPhone: 3135550156`,
      },
    });
    const first = await initial.json();
    expect(initial.status(), JSON.stringify(first)).toBe(201);
    const ref = String(first.case_number);
    const [before] = await db()`select id,public_ref from client_import_cases where public_ref=${ref}`;
    const bound = await issueLink(staffPage, ref);
    await page.goto(`/intake/${bound.token}`);
    await expect(page.getByTestId("intake-existing-case-number")).toHaveValue(ref);
    await expect(page.getByTestId("intake-existing-case-number")).toHaveAttribute("readonly", "");
    await page.getByTestId("locale-en").click();
    await page.getByTestId("intake-source-text").fill(`Full Name: ${name}\nDate of Birth: 1994-05-15\nEmail: ${email}\nPhone: 3135550167`);
    await expect(page.getByTestId("intake-field-site_code")).toBeVisible();
    await page.getByTestId("intake-field-site_code").fill("Romulus DTW1");
    await page.getByTestId("intake-field-shift_code").fill("BHN");
    await page.getByTestId("intake-field-shift_days").fill("Wednesday-Saturday");
    await page.getByTestId("intake-field-shift_start_time").fill("18:00");
    await page.getByTestId("intake-field-shift_end_time").fill("04:30");
    await page.getByTestId("intake-choose-files").setInputFiles({ name: "bound.png", mimeType: "image/png", buffer: PNG_1x1 });
    const view = page.getByTestId("intake-file-view");
    await expect(view).toBeVisible();
    await view.click();
    await expect(page.getByTestId("intake-document-viewer")).toBeVisible();
    await page.getByRole("button",{name:"Close preview"}).click();
    await expect(page.getByTestId("intake-document-viewer")).toHaveCount(0);
    // Use the same browser form to exercise the actual authorized submission.
    await page.getByTestId("intake-submit").click();
    await expect(page.getByTestId("intake-success")).toBeVisible({timeout:45000});
    await expect(page.getByTestId("intake-case-number")).toContainText(ref);
    const [after] = await db()`select id,public_ref,raw_input,mapped_draft from client_import_cases where public_ref=${ref}`;
    expect(String(after.id)).toBe(String(before.id));
    expect(after.public_ref).toBe(ref);
    expect(JSON.stringify(after.raw_input)).toContain("Romulus DTW1");
    expect(after.mapped_draft.profile.phone).toBe("3135550167");
    const [{ docs }] = await db()`select count(*)::int as docs from client_import_documents where import_case_id=${String(before.id)}`;
    expect(Number(docs)).toBe(1);
    const [linkState] = await db()`select status,import_case_id from client_import_links where id=${bound.id}`;
    expect(linkState.status).toBe("USED");
    expect(String(linkState.import_case_id)).toBe(String(before.id));
    const rows = await db()`select id from client_import_cases where public_ref=${ref}`;
    expect(rows).toHaveLength(1);
  });


  test("staff-reviewed MANUAL phone authority survives a linked client correction", async ({ request }) => {
    const initialLink = await issueLink(staffPage);
    const name = `Authority Applicant ${NAME_TAG}`;
    const email = `authority-${RUN}@test.invalid`;
    const initial = await request.post(`/api/public/client-intake/${initialLink.token}`, {
      multipart: { source_text: `Full Name: ${name}\nDate of Birth: 1992-09-19\nEmail: ${email}\nPhone: 3135550101` },
    });
    expect(initial.status()).toBe(201);
    const ref = String((await initial.json()).case_number);
    const [caseRow] = await db()`select id from client_import_cases where public_ref=${ref}`;
    const manualEvidence = JSON.stringify([{field_key:"phone",authority:"MANUAL",value:"3135550199",source:"staff_review"}]);
    await db()`update client_import_cases
      set mapped_draft=jsonb_set(mapped_draft,'{profile,phone}',to_jsonb('3135550199'::text)),
      field_evidence=coalesce(field_evidence,'[]'::jsonb)||${manualEvidence}::jsonb,
      review_started_at=now() where id=${String(caseRow.id)}`;
    const bound = await issueLink(staffPage,ref);
    const correction = await request.post(`/api/public/client-intake/${bound.token}`, {
      multipart: { source_text: `Full Name: ${name}\nDate of Birth: 1992-09-19\nEmail: ${email}\nPhone: 3135550122`,case_number:ref },
    });
    const result = await correction.json();
    expect(correction.status(),JSON.stringify(result)).toBe(201);
    const [latest] = await db()`select mapped_draft,public_ref from client_import_cases where id=${String(caseRow.id)}`;
    expect(latest.mapped_draft.profile.phone).toBe("3135550199");
    expect(latest.public_ref).toBe(ref);
  });

  test("bound link blocks a different person's identity and preserves the original case", async ({ request }) => {
    const created = await issueLink(staffPage);
    const first = await request.post(`/api/public/client-intake/${created.token}`, {
      multipart: { source_text: `Full Name: Protected Applicant ${NAME_TAG}\nDate of Birth: 1991-01-01\nEmail: identity-${RUN}@test.invalid` },
    });
    expect(first.status()).toBe(201);
    const ref = String((await first.json()).case_number);
    const linked = await issueLink(staffPage, ref);
    const wrong = await request.post(`/api/public/client-intake/${linked.token}`, {
      multipart: { source_text: `Full Name: Different Person ${NAME_TAG}\nDate of Birth: 2000-01-01\nPhone: 3135550100`, case_number: ref },
    });
    expect(wrong.status()).toBe(409);
    expect((await wrong.json()).error?.code).toBe("identity_conflict");
    const [state] = await db()`select status from client_import_links where id=${linked.id}`;
    expect(state.status).toBe("ACTIVE");
  });

  test("Client Intake Link remains fluid in Arabic and English on phone, tablet and ultrawide", async ({ page }) => {
    const linked = await issueLink(staffPage);
    for (const width of [320,360,390,600,768,1024,1440,1920,2560]) {
      await page.setViewportSize({ width, height:850 });
      await page.goto(`/intake/${linked.token}`);
      const m = await page.evaluate(() => ({
        width:document.documentElement.scrollWidth,
        viewport:document.documentElement.clientWidth,
        inputs:Array.from(document.querySelectorAll("input,textarea")).filter(el=>(el as HTMLElement).offsetParent).map(el=>(el as HTMLElement).getBoundingClientRect()).filter(r=>r.width>0).map(r=>({left:r.left,right:r.right}))
      }));
      expect(m.width,`overflow at ${width}`).toBeLessThanOrEqual(m.viewport+1);
      for(const rect of m.inputs) {
        expect(rect.left).toBeGreaterThanOrEqual(-1);
        expect(rect.right).toBeLessThanOrEqual(width+1);
      }
      await page.getByTestId("locale-en").click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
      await page.getByTestId("locale-ar").click();
    }
  });

  test("shared contact stays valid, but duplicate person and Case Number are blocked without leaking records", async ({ request }) => {
    const sharedEmail = `family-${RUN}@test.invalid`;
    const firstName = `Amina Applicant ${NAME_TAG}`;
    const secondName = `Omar Applicant ${NAME_TAG}`;
    const identity = (name: string, dob: string) => ({
      source_text: `Full Name: ${name}\nEmail: ${sharedEmail}\nPhone: 3135550182\nDate of Birth: ${dob}`,
      field_full_name: name,
      field_email: sharedEmail,
      field_phone: "3135550182",
      field_date_of_birth: dob,
    });
    const firstLink = await issueLink(staffPage);
    const first = await request.post(`/api/public/client-intake/${firstLink.token}`, {
      multipart: identity(firstName, "1990-04-12"),
    });
    const firstData = await first.json();
    expect(first.status(), JSON.stringify(firstData)).toBe(201);
    expect(firstData.case_number).toMatch(/^CG-\d{4}-\d{6}$/);

    const secondLink = await issueLink(staffPage);
    const probe = await request.post(`/api/public/client-intake/${secondLink.token}/duplicate`, {
      data: {
        email: sharedEmail, fullName: secondName,
        dateOfBirth: "1997-08-24", phone: "3135550182",
      },
    });
    const probeData = await probe.json();
    expect(probe.status()).toBe(200);
    expect(probeData.duplicate).toBe(false);
    expect(probeData.shared_email).toBe(true);
    for (const key of ["case_number", "public_ref", "client_id", "name", "phone", "date_of_birth"]) {
      expect(probeData).not.toHaveProperty(key);
    }
    const second = await request.post(`/api/public/client-intake/${secondLink.token}`, {
      multipart: identity(secondName, "1997-08-24"),
    });
    const secondData = await second.json();
    expect(second.status(), JSON.stringify(secondData)).toBe(201);
    expect(secondData.case_number).toMatch(/^CG-\d{4}-\d{6}$/);
    expect(secondData.case_number).not.toBe(firstData.case_number);

    const duplicateLink = await issueLink(staffPage);
    const duplicate = await request.post(`/api/public/client-intake/${duplicateLink.token}`, {
      multipart: identity(firstName, "1990-04-12"),
    });
    expect(duplicate.status()).toBe(409);
    expect((await duplicate.json()).error?.code).toBe("duplicate_application");

    const refLink = await issueLink(staffPage);
    const exactRef = await request.post(`/api/public/client-intake/${refLink.token}`, {
      multipart: {
        ...identity(`Different Applicant ${NAME_TAG}`, "2000-01-01"),
        case_number: firstData.case_number,
      },
    });
    expect(exactRef.status()).toBe(409);
    expect((await exactRef.json()).error?.code).toBe("duplicate_application");
  });

  test("concurrent submissions of the same applicant create exactly one staged lifecycle", async ({ request }) => {
    const email = `race-${RUN}@test.invalid`;
    const applicant = `Concurrent Applicant ${NAME_TAG}`;
    const body = {
      source_text: `Full Name: ${applicant}\nEmail: ${email}\nDate of Birth: 1993-01-18\nPhone: 3135550193`,
      field_full_name: applicant,
      field_email: email,
      field_date_of_birth: "1993-01-18",
      field_phone: "3135550193",
    };
    const a = await issueLink(staffPage);
    const b = await issueLink(staffPage);
    const replies = await Promise.all([
      request.post(`/api/public/client-intake/${a.token}`, { multipart: body }),
      request.post(`/api/public/client-intake/${b.token}`, { multipart: body }),
    ]);
    expect(replies.map(r => r.status()).sort()).toEqual([201, 409]);
    const rows = await db()`
      select id from client_import_cases
      where mapped_draft #>> '{profile,email}'=${email}`;
    expect(rows).toHaveLength(1);
  });

  test("a used link is closed for good, on the page and at the API", async ({ page, request }) => {
    const link = await issueLink(staffPage);
    const first = await request.post(`/api/public/client-intake/${link.token}`, {
      multipart: { source_text: `TEST Intake Reuse ${RUN}\nphone 313-555-0166` },
    });
    expect(first.status(), await first.text()).toBe(201);

    // Second submission of the same link.
    const second = await request.post(`/api/public/client-intake/${link.token}`, {
      multipart: { source_text: "should never be staged" },
    });
    expect(second.status()).toBe(410);

    await page.goto(`/intake/${link.token}`);
    await expect(page.getByTestId("intake-closed")).toBeVisible();
    await expect(page.getByTestId("intake-source")).toHaveCount(0);

    // Exactly one case for that link — the second attempt staged nothing.
    const [{ cases }] = await db()`
      select count(*)::int cases from client_import_batches
      where idempotency_key like 'client-link:%' and created_by=(select id from staff where auth_user_id=${STAFF.admin})
        and idempotency_key=${`client-link:${createHash("sha256").update(link.token).digest("hex")}`}`;
    expect(cases).toBe(1);
  });

  test("a revoked link and an expired link are both closed", async ({ page, request }) => {
    const revoked = await issueLink(staffPage);
    const del = await request.delete("/api/staff/client-intake-link", {
      data: { link_id: revoked.id },
      headers: { cookie: `cg_at=${await accessToken("admin")}`, "x-forwarded-for": uniqueIp() },
    });
    expect(del.status()).toBe(200);
    expect((await request.post(`/api/public/client-intake/${revoked.token}`, { multipart: { source_text: "x" } })).status()).toBe(410);
    await page.goto(`/intake/${revoked.token}`);
    await expect(page.getByTestId("intake-closed")).toBeVisible();

    const expired = await issueLink(staffPage);
    await db()`update client_import_links set expires_at=now()-interval '1 minute' where id=${expired.id}`;
    expect((await request.post(`/api/public/client-intake/${expired.token}`, { multipart: { source_text: "x" } })).status()).toBe(410);
    await page.goto(`/intake/${expired.token}`);
    await expect(page.getByTestId("intake-closed")).toBeVisible();
  });

  test("an unsupported file type and an empty submission are refused", async ({ request }) => {
    const link = await issueLink(staffPage);
    const bad = await request.post(`/api/public/client-intake/${link.token}`, {
      multipart: {
        source_text: "",
        files: { name: "payload.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") },
      },
    });
    expect(bad.status()).toBe(415);
    // The link survives a rejected submission and can still be used.
    const [afterBad] = await db()`select status from client_import_links where id=${link.id}`;
    expect(afterBad.status).toBe("ACTIVE");

    const empty = await request.post(`/api/public/client-intake/${link.token}`, { multipart: { source_text: "   " } });
    expect(empty.status()).toBe(400);
    const [afterEmpty] = await db()`select status from client_import_links where id=${link.id}`;
    expect(afterEmpty.status).toBe("ACTIVE");
  });
});
