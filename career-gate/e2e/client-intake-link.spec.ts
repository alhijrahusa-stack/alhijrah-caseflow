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

async function issueLink(page: Page) {
  const res = await page.request.post("/api/staff/client-intake-link", {
    data: {},
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
    await expect(page.getByTestId("intake-upload")).toContainText("ارفع الوثائق");
    await expect(page.getByTestId("intake-submit")).toHaveText("إرسال");

    // One page, both languages.
    await page.getByTestId("locale-en").click();
    await expect(page.locator("div[dir]").first()).toHaveAttribute("dir", "ltr");
    await expect(page.getByTestId("intake-source")).toContainText("Enter your details here");
    await expect(page.getByTestId("intake-upload")).toContainText("Upload Documents");
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
    await expect(success).toContainText("cannot be used again");
    // No internal identifier is shown.
    expect(await success.innerText()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);

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
