import { expect, type Page, request as pwRequest, test } from "@playwright/test";

// Runs against local (e2e/run.sh) or a deployed URL:
//   BASE_URL=https://… STAFF_ACCESS_KEY=… PW_CHROMIUM=… npx playwright test
// Catalog steps pick the first available options, so any catalog works.

const KEY = process.env.STAFF_ACCESS_KEY ?? "e2e-office-key";
const RUN = Date.now().toString(36);
// Smallest valid PNG (1×1).
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

const tomorrow = () => {
  const d = new Date(Date.now() + 36 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
};

async function enterOffice(page: Page) {
  await page.goto("/staff");
  if (page.url().includes("/staff-access")) {
    await page.getByLabel("Office access key").fill(KEY);
    await page.getByRole("button", { name: "Enter" }).click();
    await page.waitForURL(/\/staff$/);
  }
  await page.getByTestId("handled-by").selectOption({ label: "Yusuf" });
}

async function next(page: Page) {
  await page.getByRole("button", { name: "Next" }).click();
}

async function pickFirst(page: Page) {
  const box = page.locator('fieldset input[type="checkbox"]:not(:disabled)').first();
  if (await box.count()) await box.check();
}

test.describe.serial("Career Gate workflow", () => {
  let ref = "";
  let statusUrl = "";
  let clientUrl = "";
  let payTexts: string[] = [];

  test("public application creates a client with a CG reference", async ({ page }) => {
    await page.goto("/apply");
    await page.getByRole("group").getByText("Michigan", { exact: true }).click();
    await next(page);

    const catalogSteps = ["City", "Site", "Job", "Primary shift"];
    for (const title of catalogSteps) {
      if (!(await page.getByRole("heading", { level: 2, name: title, exact: true }).count())) break;
      await pickFirst(page);
      await next(page);
    }
    if (await page.getByRole("heading", { level: 2, name: "Backup shift", exact: true }).count()) {
      await pickFirst(page);
      await next(page);
    }
    if (await page.getByRole("heading", { level: 2, name: "Pay", exact: true }).count()) {
      payTexts = (await page.locator("ol li span.whitespace-nowrap").allInnerTexts()).map((s) => s.trim());
      await next(page);
    }

    await expect(page.getByRole("heading", { level: 2, name: "Personal information" })).toBeVisible();
    await page.getByLabel("Full name").fill(`E2E Public ${RUN}`);
    await page.getByLabel("Phone").fill("313-555-0142");
    await page.getByLabel("Email", { exact: true }).fill(`e2e.${RUN}@example.com`);
    await page.getByLabel("Date of birth").fill("1990-04-05");
    await page.getByLabel("Street address").fill("100 Example St");
    await page.getByLabel("City", { exact: true }).fill("Dearborn");
    await page.getByLabel("ZIP").fill("48126");
    await page.getByLabel("When are you available for appointments?").fill("Weekdays after 2pm");
    await page.locator('input[name="amazon_worked_before"][value="yes"]').check();
    await page.getByLabel("From", { exact: true }).fill("2021-01-01");
    await page.getByLabel("To", { exact: true }).fill("2022-06-30");
    await page.locator('input[name="amazon_applied_before"][value="yes"]').check();
    await page.getByLabel(/Amazon email used/).fill(`amz.${RUN}@example.com`);
    await page.getByRole("button", { name: "+ Add employment" }).click();
    await page.getByLabel("Company").fill("Example Logistics");
    await page.getByLabel("Job title / type").fill("Picker");
    await page.getByLabel("From", { exact: true }).nth(1).fill("2023-01-01");
    await next(page);

    await expect(page.getByRole("heading", { level: 2, name: "Documents" })).toBeVisible();
    await page.getByLabel("Choose file").setInputFiles({ name: "photo-id.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByText("Photo ID — photo-id.png")).toBeVisible();
    await next(page);

    await expect(page.getByTestId("authorization-text")).toContainText("I authorize ALHIJRAH SERVICES LLC to submit job applications on my behalf to Amazon.");
    const submit = page.getByRole("button", { name: "Submit" });
    await expect(submit).toBeDisabled();
    await page.getByLabel("Printed Name", { exact: true }).fill(`E2E Public ${RUN}`);
    await page.getByLabel(/Signature/).fill(`E2E Public ${RUN}`);
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
    statusUrl = (await page.getByRole("link", { name: "Track Status" }).getAttribute("href"))!;
    expect(statusUrl).toContain(`/status/${ref}?t=`);

    await page.goto(statusUrl);
    await expect(page.getByTestId("status-reference")).toHaveText(ref);
    await expect(page.getByTestId("status-current-status")).toHaveText("New Intake");
  });

  test("office operates the full client file", async ({ page, context }) => {
    await enterOffice(page);
    await expect(Number(await page.getByTestId("count-new_intake").innerText())).toBeGreaterThan(0);
    await page.getByTestId("card-new_intake").click();
    await expect(page.getByRole("link", { name: ref })).toBeVisible();

    await page.goto("/staff/clients");
    await page.getByLabel("Search").fill(ref);
    await page.getByRole("button", { name: "Apply" }).click();
    await page.getByRole("link", { name: ref }).click();
    await expect(page.getByTestId("client-ref")).toHaveText(ref);
    clientUrl = page.url();

    // Profile, history, preferences and pay snapshot.
    await expect(page.getByTestId("section-client-info")).toContainText("Weekdays after 2pm");
    await expect(page.getByTestId("section-amazon-history")).toContainText(`amz.${RUN}@example.com`);
    await expect(page.getByTestId("section-employment-history")).toContainText("Picker — Example Logistics");
    await expect(page.getByTestId("authorization-record")).toContainText(`E2E Public ${RUN}`);
    if (payTexts.length) {
      const snaps = (await page.getByTestId("pay-snapshot").allInnerTexts()).map((s) => s.trim());
      expect(snaps).toEqual(payTexts.map((p) => (p === "Pay not listed" ? "Not listed" : p)));
      await expect(page.getByTestId("preference-row").first().locator("td").first()).toHaveText("1");
    }

    // Edit client.
    await page.getByRole("link", { name: "Edit Client" }).click();
    await page.getByLabel("When are you available for appointments?").fill("Mornings only");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(clientUrl);
    await expect(page.getByTestId("section-client-info")).toContainText("Mornings only");

    // Documents: the applicant's upload plus one from the office; open through a signed URL.
    await page.getByRole("button", { name: "Add Document" }).click();
    await page.getByLabel("Document file").setInputFiles({ name: "work-auth.png", mimeType: "image/png", buffer: PNG });
    await page.getByTestId("form-document").getByRole("button", { name: "Upload" }).click();
    await expect(page.getByTestId("document-row")).toHaveCount(2);
    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.getByTestId("document-row").first().getByRole("button", { name: "Open" }).click(),
    ]);
    await popup.waitForURL(/\/storage\/v1\/object\/sign\/documents\/.+token=/);
    expect(await popup.evaluate(() => document.contentType)).toBe("image/png");
    await popup.close();
    await page.reload();
    await expect(page.getByTestId("document-row").first()).toContainText("opened 1×");
    await page.getByTestId("document-row").first().getByRole("button", { name: "Verify" }).click();
    await expect(page.getByTestId("document-status").first()).toContainText("verified");
    await page.getByTestId("document-row").nth(1).getByRole("button", { name: "Reject" }).click();
    await page.getByLabel("Rejection reason").fill("Image unreadable");
    await page.getByTestId("document-row").nth(1).getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("document-status").nth(1)).toContainText("Image unreadable");

    // Appointment.
    await page.getByRole("button", { name: "Add Appointment" }).click();
    await page.getByLabel("Date & time (Michigan time)").fill(`${tomorrow()}T10:30`);
    await page.getByLabel("Location").fill(`Office Room ${RUN}`);
    await page.getByTestId("form-appointment").getByRole("button", { name: "Save appointment" }).click();
    await expect(page.getByTestId("appointment-row")).toHaveCount(1);
    await page.getByTestId("appointment-row").getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByTestId("appointment-status")).toHaveText("confirmed");
    // Regression: a status-only update must not clear other fields.
    await expect(page.getByTestId("appointment-row")).toContainText(`Office Room ${RUN}`);

    // Note.
    await page.getByRole("button", { name: "Add Note" }).click();
    await page.getByLabel("Note", { exact: true }).fill(`INTERNAL-NOTE-${RUN}`);
    await page.getByTestId("form-note").getByRole("button", { name: "Add note" }).click();
    await expect(page.getByTestId("note-row")).toContainText(`INTERNAL-NOTE-${RUN}`);

    // Task: add then complete.
    await page.getByRole("button", { name: "Add Task" }).click();
    await page.getByLabel("Title", { exact: true }).fill(`INTERNAL-TASK-${RUN}`);
    await page.getByTestId("form-task").getByRole("button", { name: "Add task" }).click();
    await expect(page.getByTestId("task-row")).toContainText(`INTERNAL-TASK-${RUN}`);
    await page.getByTestId("task-row").getByRole("button", { name: "Complete" }).click();
    await expect(page.getByTestId("task-status")).toContainText("completed");

    // Mark contacted (creates a follow-up), then add and complete another follow-up.
    await page.getByRole("button", { name: "Mark Contacted" }).click();
    await page.getByLabel("Method").selectOption("whatsapp");
    await page.getByLabel("Result").fill("Reached client");
    await page.getByLabel("Next action").fill("Confirm appointment");
    await page.getByLabel("Follow-up date (optional)").fill(tomorrow());
    await page.getByTestId("form-contacted").getByRole("button", { name: "Save contact" }).click();
    await expect(page.getByTestId("contact-row")).toContainText("WhatsApp — Reached client");
    await expect(page.getByTestId("followup-row")).toHaveCount(1);

    await page.getByRole("button", { name: "Add Follow-up" }).click();
    await page.getByLabel("Due date").fill(tomorrow());
    await page.getByLabel("Reason", { exact: true }).fill("Check screening");
    await page.getByTestId("form-followup").getByRole("button", { name: "Add follow-up" }).click();
    await expect(page.getByTestId("followup-row")).toHaveCount(2);
    await page.getByTestId("followup-row").first().getByRole("button", { name: "Complete" }).click();
    await expect(page.getByTestId("followup-status").filter({ hasText: "completed" })).toHaveCount(1);

    // Status and next step.
    await page.getByRole("button", { name: "Change Status" }).click();
    await page.getByLabel("Status", { exact: true }).selectOption("appointment_scheduled");
    await page.getByTestId("form-status").getByRole("button", { name: "Save status" }).click();
    await expect(page.getByTestId("current-status")).toHaveText("Appointment Scheduled");
    await page.getByRole("button", { name: "Set Next Step" }).click();
    await page.getByLabel(/Next step \(shown/).fill(`Bring two IDs ${RUN}`);
    await page.getByTestId("form-next-step").getByRole("button", { name: "Save next step" }).click();
    await expect(page.getByTestId("next-step")).toHaveText(`Bring two IDs ${RUN}`);

    // Post-hire start date.
    const row = page.getByTestId("post-hire-start_date");
    await row.getByLabel("Start date status").selectOption("confirmed");
    await row.getByLabel("Start date", { exact: true }).fill("2030-01-15");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(row).toContainText("Yusuf");

    // Activity log.
    const actions = await page.getByTestId("activity-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-action")));
    for (const a of [
      "client_created", "client_updated", "document_uploaded", "document_opened", "document_verified", "document_rejected",
      "appointment_created", "appointment_updated", "note_added", "task_added", "task_completed", "contact_logged",
      "followup_created", "followup_completed", "status_changed", "next_step_changed", "post_hire_updated",
    ]) expect(actions, a).toContain(a);

    // Public status page shows only public-safe fields.
    const [status] = await Promise.all([context.waitForEvent("page"), page.getByTestId("open-status-page").click()]);
    await status.waitForLoadState();
    await expect(status.getByTestId("status-current-status")).toHaveText("Appointment Scheduled");
    await expect(status.getByTestId("status-next-step")).toHaveText(`Bring two IDs ${RUN}`);
    await expect(status.getByTestId("status-appointment-location")).toHaveText(`Office Room ${RUN}`);
    await expect(status.getByTestId("status-appointment-time")).toHaveText("10:30 AM");
    await expect(status.getByTestId("status-start-date")).toHaveText("Jan 15, 2030");
    const html = await status.content();
    for (const secret of [`INTERNAL-NOTE-${RUN}`, `INTERNAL-TASK-${RUN}`, "photo-id.png", "work-auth.png", `amz.${RUN}`, "Reached client", "5550142", "Yusuf", "Mornings only"]) {
      expect(html, secret).not.toContain(secret);
    }
    await status.close();
  });

  test("office-created client uses the same workflow", async ({ page }) => {
    await enterOffice(page);
    await page.goto("/staff/new-client");
    await page.getByLabel("Full name").fill(`E2E Office ${RUN}`);
    await page.getByLabel("Phone", { exact: true }).fill("3135550199");
    await page.locator('input[name="amazon_worked_before"][value="no"]').check();
    await page.locator('input[name="amazon_applied_before"][value="no"]').check();
    if (await page.getByTestId("pref-city").count()) {
      for (const k of ["city", "site", "job", "primary"]) {
        await page.getByTestId(`pref-${k}`).locator('input[type="checkbox"]:not(:disabled)').first().check();
      }
      await expect(page.getByTestId("pref-primary").locator("input:checked")).toHaveCount(1);
    }
    await page.getByLabel("Document type").selectOption("resume");
    await page.getByLabel("Choose file").setInputFiles({ name: "resume.png", mimeType: "image/png", buffer: PNG });
    await page.getByLabel("Initial status").selectOption("needs_review");
    await page.getByLabel("Initial note").fill(`Walk-in ${RUN}`);
    await page.getByRole("button", { name: "Create client file" }).click();
    await page.waitForURL(/\/staff\/client\/[0-9a-f-]{36}$/);
    const officeRef = (await page.getByTestId("client-ref").innerText()).trim();
    expect(officeRef).toMatch(/^CG-\d{4}-\d{6}$/);
    expect(officeRef).not.toBe(ref);
    await expect(page.getByTestId("current-status")).toHaveText("Needs Review");
    await expect(page.getByTestId("note-row")).toContainText(`Walk-in ${RUN}`);
    await expect(page.getByTestId("document-row")).toHaveCount(1);

    await page.getByRole("button", { name: "Add Task" }).click();
    await page.getByLabel("Title", { exact: true }).fill("Call back");
    await page.getByTestId("form-task").getByRole("button", { name: "Add task" }).click();
    await page.getByTestId("task-row").getByRole("button", { name: "Complete" }).click();
    await expect(page.getByTestId("task-status")).toContainText("completed");
    await page.getByRole("button", { name: "Change Status" }).click();
    await page.getByLabel("Status", { exact: true }).selectOption("ready_to_apply");
    await page.getByTestId("form-status").getByRole("button", { name: "Save status" }).click();
    await expect(page.getByTestId("current-status")).toHaveText("Ready to Apply");

    await page.goto("/staff");
    await page.getByTestId("card-ready_to_apply").click();
    await expect(page.getByRole("link", { name: officeRef })).toBeVisible();

    const [status] = await Promise.all([page.context().waitForEvent("page"), page.goto(`/staff/clients?q=${officeRef}`).then(() => page.getByRole("link", { name: officeRef }).click()).then(() => page.getByTestId("open-status-page").click())]);
    await status.waitForLoadState();
    await expect(status.getByTestId("status-reference")).toHaveText(officeRef);
    await expect(status.getByTestId("status-current-status")).toHaveText("Ready to Apply");
    await status.close();
  });

  test("server rejects unauthorized and invalid requests", async ({ baseURL }) => {
    const anon = await pwRequest.newContext({ baseURL });
    const noCookie = await anon.post("/api/staff/action", { data: { action: "add_note" } });
    expect(noCookie.status()).toBe(401);
    expect((await anon.get("/api/documents/00000000-0000-0000-0000-000000000000")).status()).toBe(401);
    expect((await anon.get("/staff", { maxRedirects: 0 })).status()).toBe(307);

    const bad = await anon.post("/api/intake", {
      data: {
        idempotency_key: crypto.randomUUID(), state: "MI",
        profile: { full_name: "X Y", phone: "3135550100", employment_history: [] },
        primary: [{ site_code: "NOPE", job_id: "NOPE", shift_code: "NOPE" }], backup: [],
        communication_consent: false,
        authorization: { version: "2026-09-26.1", accepted: true, accuracy_acknowledged: true, printed_name: "X Y", signature: "X Y" },
      },
    });
    expect(bad.status()).toBe(400);
    const noConsent = await anon.post("/api/intake", {
      data: {
        idempotency_key: crypto.randomUUID(), state: "MI",
        profile: { full_name: "X Y", phone: "3135550100", employment_history: [] }, primary: [], backup: [],
        communication_consent: false,
        authorization: { version: "2026-09-26.1", accepted: false, accuracy_acknowledged: true, printed_name: "X Y", signature: "X Y" },
      },
    });
    expect(noConsent.status()).toBe(400);

    const wrongToken = await anon.get(`/status/${ref}?t=${"0".repeat(48)}`);
    expect(await wrongToken.text()).toContain("Status not available");
    const upload = await anon.post("/api/intake/documents", {
      multipart: { ref, token: "0".repeat(48), doc_type: "other", file: { name: "x.png", mimeType: "image/png", buffer: PNG } },
    });
    expect(upload.status()).toBe(404);

    await anon.dispose();
  });

  test("references are unique under concurrent submissions and retries are idempotent", async ({ baseURL }) => {
    const api = await pwRequest.newContext({ baseURL });
    const payload = (key: string, i: number) => ({
      idempotency_key: key, state: "MI",
      profile: { full_name: `Concurrent ${RUN} ${i}`, phone: "3135550100", employment_history: [] },
      primary: [], backup: [], communication_consent: false,
      authorization: { version: "2026-09-26.1", accepted: true, accuracy_acknowledged: true, printed_name: `Concurrent ${RUN} ${i}`, signature: `Concurrent ${RUN} ${i}` },
    });
    // Catalog-dependent: when the catalog has options, a primary shift is required.
    const probe = await api.post("/api/intake", { data: payload(crypto.randomUUID(), 0) });
    test.skip(probe.status() === 400 && (await probe.json()).error.code === "invalid_preferences", "catalog requires a preference");
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => api.post("/api/intake", { data: payload(crypto.randomUUID(), i + 1) }).then((r) => r.json())),
    );
    const refs = results.map((r) => r.ref);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(refs).size).toBe(20);

    const key = crypto.randomUUID();
    const [a, b] = await Promise.all([api.post("/api/intake", { data: payload(key, 99) }), api.post("/api/intake", { data: payload(key, 99) })]);
    expect((await a.json()).ref).toBe((await b.json()).ref);
    await api.dispose();
  });
});
