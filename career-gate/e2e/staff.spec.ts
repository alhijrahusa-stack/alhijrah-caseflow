import { expect, type Page, test } from "@playwright/test";
import { accessToken, db, FIXTURE_CATALOG, intakeBody, PNG, RUN, signIn, STAFF, staffAction, submitIntake } from "./helpers";

const tomorrowLocal = () => {
  const d = new Date(Date.now() + 36 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
};

async function staffId(role: keyof typeof STAFF) {
  const [s] = await db()`select id from staff where auth_user_id = ${STAFF[role]}`;
  return s.id as string;
}

test.describe.serial("office workflow", () => {
  let ref = "";
  let clientId = "";
  let page: Page;

  test.beforeAll(async ({ request, browser, baseURL }) => {
    const r = await submitIntake(request, intakeBody(`TEST Office Flow ${RUN}`));
    ref = r.json.ref;
    const [c] = await db()`select id from clients where ref = ${ref}`;
    clientId = c.id;
    const ctx = await browser.newContext({ baseURL });
    await signIn(ctx, baseURL!, "admin");
    page = await ctx.newPage();
  });

  test("dashboard shows real counts and the new application", async () => {
    await page.goto("/staff");
    await expect(page.getByTestId("me")).toContainText("TEST Admin");
    const [{ n }] = await db()`select count(*)::int as n from clients where current_status = 'new_intake' and deleted_at is null`;
    await expect(page.getByTestId("count-new_intake")).toHaveText(String(n));
    await page.getByTestId("card-new_intake").click();
    await expect(page.getByRole("link", { name: ref })).toBeVisible();
    await expect(page.getByTestId("client-total")).toContainText("page 1 of");
  });

  test("command palette finds and opens the client", async () => {
    await page.goto("/staff");
    await page.keyboard.press("Control+k");
    const palette = page.getByTestId("command-palette");
    await expect(palette).toBeVisible();
    await palette.getByRole("combobox").fill(ref);
    await expect(palette.getByRole("option", { name: new RegExp(ref) })).toBeVisible();
    await page.keyboard.press("Enter");
    await page.waitForURL(`**/staff/client/${clientId}`);
    await expect(page.getByTestId("client-ref")).toHaveText(ref);
  });

  test("client file: preferences with pay snapshot, NOT_CONFIGURED truth labels", async () => {
    await page.getByRole("button", { name: /Job Preferences/ }).click();
    if (FIXTURE_CATALOG) await expect(page.getByTestId("pay-snapshot").first()).toHaveText("$1.11/hr (fixture)");
    else await expect(page.getByTestId("section-preferences")).toContainText("no active openings");
    await expect(page.getByTestId("realtime-state").first()).toContainText("NOT_CONFIGURED");
    await page.getByRole("button", { name: /Notes \/ Tasks \/ Contacts/ }).click();
    await expect(page.getByTestId("notification-status").first()).toHaveText("NOT_CONFIGURED");
    await page.getByRole("button", { name: "Profile" }).click();
  });

  test("inline editing saves only on server success and rolls back on failure", async () => {
    await page.getByTestId("inline-appointment_availability").click();
    await page.getByTestId("inline-edit-appointment_availability").getByLabel("Appointment availability").fill("Mornings only");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("toast-success")).toBeVisible();
    await expect(page.getByTestId("inline-appointment_availability")).toContainText("Mornings only");

    await page.getByTestId("inline-email").click();
    await page.getByTestId("inline-edit-email").getByLabel("Email", { exact: true }).fill("not-an-email");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("toast-error")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("inline-email")).toContainText("@test.invalid");
    const [c] = await db()`select email from clients where id = ${clientId}`;
    expect(c.email).toContain("@test.invalid");
  });

  test("edit client and assign staff", async () => {
    await page.getByRole("link", { name: "Correct Data", exact: true }).click();
    await page.locator('input[name="via_agency"][value="yes"]').check();
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(`**/staff/client/${clientId}`);
    await expect(page.getByTestId("section-amazon-history")).toContainText("Via third-party agency");
    await page.getByTestId("quick-actions").getByRole("button", { name: "Assign Staff" }).click();
    const assign = page.getByTestId("form-assign");
    await expect(assign).toBeVisible();
    await assign.locator(".staff-picker-trigger").click();
    await assign.getByRole("option", { name: /TEST Staff/ }).click();
    await assign.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("assigned-name")).toHaveText("TEST Staff");
  });

  test("documents: upload, private signed access, extraction NOT_CONFIGURED, human review", async () => {
    await page.getByTestId("quick-actions").getByRole("button", { name: "Add Document" }).click();
    await page.getByTestId("form-document").getByLabel("Document file").setInputFiles({ name: "work-auth.png", mimeType: "image/png", buffer: PNG });
    await page.getByTestId("form-document").getByLabel("Type", { exact: true }).selectOption("work_authorization");
    await page.getByTestId("form-document").getByRole("button", { name: "Upload" }).click();
    await expect(page.getByTestId("document-row")).toHaveCount(1);
    await expect.poll(async () => (await db()`select status from documents where client_id = ${clientId}`)[0]?.status, { timeout: 15_000 }).toBe("needs_review");
    await page.reload();
    await page.getByRole("button", { name: /Documents/ }).click();
    await expect(page.getByTestId("extraction-state")).toContainText("NOT_CONFIGURED");
    await expect(page.getByTestId("document-row").locator("img")).toHaveJSProperty("complete", true);

    const [popup] = await Promise.all([page.context().waitForEvent("page"), page.getByTestId("document-row").getByRole("button", { name: "View" }).click()]);
    await popup.waitForURL(/\/storage\/v1\/object\/sign\/documents\/.+token=/);
    expect(await popup.evaluate(() => document.contentType)).toBe("image/png");
    await popup.close();
    const [log] = await db()`select count(*)::int as n from document_access_log where client_id = ${clientId} and access_type = 'view'`;
    expect(log.n).toBe(1);

    await page.reload();
    await page.getByRole("button", { name: /Documents/ }).click();
    await page.getByTestId("document-row").getByRole("button", { name: "Verify" }).click();
    await expect(page.getByTestId("document-status")).toHaveText("Verified");
    const [doc] = await db()`select status, reviewed_by, reviewed_at, sha256 from documents where client_id = ${clientId}`;
    expect(doc.reviewed_by).toBe(await staffId("admin"));
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("scheduling: book a suggested slot, collisions refused, reschedule", async ({ request }) => {
    for (let d = 0; d < 7; d++) {
      const r = await staffAction(request, "manager", { action: "upsert_availability", resource_key: "office", weekday: d, start_time: "08:00", end_time: "20:00", slot_minutes: 30 });
      expect(r.status).toBe(200);
    }
    await page.reload();
    await page.getByTestId("quick-actions").getByRole("button", { name: "Add Appointment" }).click();
    await page.getByTestId("form-appointment").getByLabel("Location").fill(`Office Room ${RUN}`);
    const slot = page.getByTestId("slot").first();
    await expect(slot).toBeVisible();
    const label = await slot.innerText();
    await slot.click();
    await expect(page.getByTestId("appointment-row")).toHaveCount(1);
    await expect(page.getByTestId("appointment-row")).toContainText(`Office Room ${RUN}`);

    const [appt] = await db()`select scheduled_at, ends_at from appointments where client_id = ${clientId}`;
    const other = await submitIntake(request, intakeBody(`TEST Collide ${RUN}`));
    const [oc] = await db()`select id from clients where ref = ${other.json.ref}`;
    const clash = await staffAction(request, "manager", {
      action: "book_slot", client_id: oc.id, start: new Date(appt.scheduled_at).toISOString(), end: new Date(appt.ends_at).toISOString(),
      resource_key: "office", appointment_type: "Test",
    });
    expect(clash.status).toBe(409);
    expect(label).toMatch(/^Book /);

    await page.getByTestId("appointment-row").getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByTestId("appointment-status")).toHaveText("confirmed");
    await expect(page.getByTestId("appointment-row")).toContainText(`Office Room ${RUN}`);
    await page.getByTestId("appointment-row").getByRole("button", { name: "Edit / Reschedule" }).click();
    await page.getByTestId("appointment-row").getByLabel("New date and time").fill(`${tomorrowLocal()}T19:00`);
    await page.getByTestId("appointment-row").getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByTestId("appointment-status")).toHaveText("rescheduled");
  });

  test("notes, tasks, contact, follow-ups", async () => {
    await page.getByTestId("quick-actions").getByRole("button", { name: "Add Note" }).click();
    await page.getByTestId("form-note").getByLabel("Note", { exact: true }).fill(`INTERNAL-NOTE-${RUN}`);
    await page.getByTestId("form-note").getByRole("button", { name: "Add note" }).click();
    await expect(page.getByTestId("note-row")).toContainText(`INTERNAL-NOTE-${RUN}`);

    await page.getByTestId("quick-actions").getByRole("button", { name: "Add Task" }).click();
    await page.getByTestId("form-task").getByLabel("Title", { exact: true }).fill(`INTERNAL-TASK-${RUN}`);
    await page.getByTestId("form-task").getByRole("button", { name: "Add task" }).click();
    await page.getByTestId("task-row").getByRole("button", { name: "Complete" }).click();
    await expect(page.getByTestId("task-status")).toContainText("completed");

    await page.getByTestId("quick-actions").getByRole("button", { name: "Mark Contacted" }).click();
    await page.getByTestId("form-contacted").getByLabel("Method").selectOption("whatsapp");
    await page.getByTestId("form-contacted").getByLabel("Result").fill("Reached client");
    await page.getByTestId("form-contacted").getByLabel("Next action").fill("Confirm appointment");
    await page.getByTestId("form-contacted").getByLabel("Follow-up date (optional)").fill(tomorrowLocal());
    await page.getByTestId("form-contacted").getByRole("button", { name: "Save contact" }).click();
    await expect(page.getByTestId("contact-row")).toContainText("WhatsApp — Reached client");

    await page.getByTestId("quick-actions").getByRole("button", { name: "Add Follow-Up" }).click();
    await page.getByTestId("form-followup").getByLabel("Due date").fill(tomorrowLocal());
    await page.getByTestId("form-followup").getByLabel("Reason", { exact: true }).fill("Check screening");
    await page.getByTestId("form-followup").getByRole("button", { name: "Add follow-up" }).click();
    await expect(page.getByTestId("followup-row")).toHaveCount(2);
    await page.getByTestId("followup-row").first().getByRole("button", { name: "Complete" }).click();
    await expect(page.getByTestId("followup-status").filter({ hasText: "completed" })).toHaveCount(1);
  });

  test("status engine: only allowed transitions, next step, timeline", async () => {
    await page.getByTestId("quick-actions").getByRole("button", { name: "Change Status" }).click();
    const options = await page.getByTestId("form-status").getByLabel("New status").locator("option").allInnerTexts();
    expect(options).toEqual(["Needs Review", "Ready to Apply", "Cancelled"]);
    await page.getByTestId("form-status").getByLabel("New status").selectOption("ready_to_apply");
    await page.getByTestId("form-status").getByRole("button", { name: "Save status" }).click();
    await expect(page.getByTestId("current-status")).toContainText("Ready to Apply");
    await expect(page.getByTestId("status-timeline")).toContainText("New Intake");
    await expect(page.getByTestId("status-timeline")).toContainText("Application in Progress (possible next)");

    await page.getByTestId("quick-actions").getByRole("button", { name: "Set Next Step" }).click();
    await page.getByTestId("form-next-step").getByLabel(/Next step \(shown/).fill(`Bring two IDs ${RUN}`);
    await page.getByTestId("form-next-step").getByRole("button", { name: "Save next step" }).click();
    await expect(page.getByTestId("next-step")).toContainText(`Bring two IDs ${RUN}`);
  });

  test("assessments stay UNRESOLVED until the client confirms", async () => {
    await page.getByRole("button", { name: /Documents/ }).click();
    await page.getByTestId("section-assessments").getByRole("button", { name: "+ Add standard items" }).click();
    await expect(page.getByTestId("assessment-item_10")).toContainText("UNRESOLVED — NEEDS CLIENT CONFIRMATION");
    await page.getByTestId("assessment-education").getByRole("button", { name: "Update" }).click();
    await page.getByTestId("assessment-education").getByLabel("Assessment status").selectOption("completed");
    await page.getByTestId("assessment-education").getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("assessment-education").getByRole("alert")).toContainText("confirmed");
    await page.getByTestId("assessment-education").getByLabel("Answer the client confirmed").fill("High school diploma");
    await page.getByTestId("assessment-education").getByLabel("Source").selectOption("client_confirmed");
    await page.getByTestId("assessment-education").getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("assessment-education")).toContainText("High school diploma");
    await page.getByRole("button", { name: "Profile" }).click();
  });

  test("post-hire start date, intake agent, activity log", async () => {
    const row = page.getByTestId("post-hire-start_date");
    await row.getByLabel("Start Date status").selectOption("confirmed");
    await row.getByLabel("Start date", { exact: true }).fill("2030-01-15");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("post-hire-start_date")).toContainText("TEST Admin");

    await page.getByRole("button", { name: /Notes \/ Tasks \/ Contacts/ }).click();
    await page.getByTestId("section-intake-agent").getByRole("button", { name: "Run check" }).click();
    await expect(page.getByTestId("intake-agent-output")).toContainText("agent model NOT_CONFIGURED");

    await page.reload();
    await page.getByRole("button", { name: "Activity Log" }).click();
    const actions = await page.getByTestId("activity-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-action")));
    for (const a of [
      "client_created", "client_updated", "staff_assigned", "document_uploaded", "document_processed", "document_opened",
      "document_verified", "appointment_created", "appointment_updated", "appointment_rescheduled", "note_added",
      "task_added", "task_completed", "contact_logged", "followup_created", "followup_completed", "status_changed",
      "next_step_changed", "assessment_updated", "post_hire_updated",
    ]) expect(actions, a).toContain(a);
    const [t] = await db()`select count(*)::int as n from activity_log where client_id = ${clientId} and trace_id is not null`;
    expect(t.n).toBeGreaterThan(10);
  });

  test("status preview shows only public-safe data", async () => {
    await page.getByTestId("open-status-page").click();
    await expect(page.getByTestId("status-current-status")).toHaveText("Ready to Apply");
    await expect(page.getByTestId("status-next-step")).toHaveText(`Bring two IDs ${RUN}`);
    await expect(page.getByTestId("status-appointment-location")).toHaveText(`Office Room ${RUN}`);
    await expect(page.getByTestId("status-start-date")).toHaveText("Jan 15, 2030");
    const text = await page.getByTestId("status-page").innerText();
    for (const secret of [`INTERNAL-NOTE-${RUN}`, `INTERNAL-TASK-${RUN}`, "work-auth.png", "Reached client", "TEST Admin", "High school"]) expect(text, secret).not.toContain(secret);
  });

  test("audit alert: known inconsistency raises an alert without changing data", async ({ request }) => {
    const r = await submitIntake(request, intakeBody(`TEST Audit ${RUN}`));
    const [c] = await db()`select id from clients where ref = ${r.json.ref}`;
    const o = await staffAction(request, "superadmin", { action: "override_status", client_id: c.id, status: "appointment_scheduled", reason: "e2e audit test" });
    expect(o.status).toBe(200);
    await expect.poll(async () => (await db()`select count(*)::int as n from audit_alerts where client_id = ${c.id} and rule = 'appointment_scheduled_without_appointment' and status = 'open'`)[0].n, { timeout: 10_000 }).toBe(1);
    await page.goto("/staff/audit-alerts");
    const alertRow = page.locator(`[data-rule="appointment_scheduled_without_appointment"]`).filter({ hasText: r.json.ref });
    await expect(alertRow).toBeVisible();
    const [{ current_status }] = await db()`select current_status from clients where id = ${c.id}`;
    expect(current_status).toBe("appointment_scheduled");
    await alertRow.getByRole("button", { name: "Ignore" }).click();
    await alertRow.getByLabel("Ignore reason").fill("Appointment booked by phone; record pending");
    await alertRow.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("toast-success")).toBeVisible();
  });

  test("office-created client uses the same workflow", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL });
    await signIn(ctx, baseURL!, "manager");
    const p = await ctx.newPage();
    await p.goto("/staff/new-client");
    await p.getByLabel("Full name").fill(`TEST Office Made ${RUN}`);
    await p.getByLabel("Phone", { exact: true }).fill("3135550199");
    await p.locator('input[name="amazon_worked_before"][value="no"]').check();
    await p.locator('input[name="amazon_applied_before"][value="no"]').check();
    if (FIXTURE_CATALOG) for (const k of ["city", "site", "job", "primary"]) await p.getByTestId(`pref-${k}`).locator('input[type="checkbox"]:not(:disabled)').first().check();
    await p.getByLabel("Document type").selectOption("resume");
    await p.getByLabel("Choose file").setInputFiles({ name: "resume.png", mimeType: "image/png", buffer: PNG });
    await p.getByLabel("Initial status").selectOption("needs_review");
    await p.getByLabel("Initial note").fill(`Walk-in ${RUN}`);
    await p.getByRole("button", { name: "Create client file" }).click();
    await p.waitForURL(/\/staff\/client\/[0-9a-f-]{36}$/);
    const officeRef = (await p.getByTestId("client-ref").innerText()).trim();
    expect(officeRef).toMatch(/^CG-\d{4}-\d{6}$/);
    expect(officeRef).not.toBe(ref);
    await expect(p.getByTestId("current-status")).toContainText("Needs Review");
    await expect(p.getByTestId("note-row")).toContainText(`Walk-in ${RUN}`);
    await expect(p.getByTestId("document-row")).toHaveCount(1);
    await p.getByTestId("quick-actions").getByRole("button", { name: "Change Status" }).click();
    await p.getByTestId("form-status").getByLabel("New status").selectOption("ready_to_apply");
    await p.getByTestId("form-status").getByRole("button", { name: "Save status" }).click();
    await expect(p.getByTestId("current-status")).toContainText("Ready to Apply");
    await p.goto("/staff");
    await p.getByTestId("card-ready_to_apply").click();
    await expect(p.getByRole("link", { name: officeRef })).toBeVisible();
    const [clientRow] = await db()`select source, created_by from clients where ref = ${officeRef}`;
    expect(clientRow.source).toBe("staff_manual");
    expect(clientRow.created_by).toBe(await staffId("manager"));
    await ctx.close();
  });
});

test.describe("role security", () => {
  test("unauthenticated access is refused", async ({ request, browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL });
    const p = await ctx.newPage();
    await p.goto("/staff");
    await p.waitForURL(/\/staff\/login\?next=%2Fstaff/);
    expect((await request.post("/api/staff/action", { data: {} })).status()).toBe(401);
    expect((await request.get("/api/documents/00000000-0000-0000-0000-000000000000")).status()).toBe(401);
    expect((await request.get("/api/audit/alerts")).status()).toBe(401);
    await ctx.close();
  });

  test("forged or expired tokens are refused", async ({ request }) => {
    expect((await request.get("/api/staff/search?q=te", { headers: { cookie: "cg_at=eyJhbGciOiJIUzI1NiJ9.e30.x" } })).status()).toBe(401);
  });

  test("full-scope staff has operational access but cannot manage team policy", async ({ browser, baseURL, request }) => {
    const r = await submitIntake(request, intakeBody(`TEST Full Scope ${RUN}`));
    const [c] = await db()`select id from clients where ref = ${r.json.ref}`;
    const ctx = await browser.newContext({ baseURL });
    await signIn(ctx, baseURL!, "staff");
    const p = await ctx.newPage();
    await p.goto("/staff/settings/team");
    await expect(p.getByTestId("forbidden")).toBeVisible();
    await p.goto(`/staff/client/${c.id}`);
    await expect(p.getByTestId("client-name")).toContainText(`TEST Full Scope ${RUN}`);

    const before = (await db()`select count(*)::int as n from security_events where event = 'access_denied'`)[0].n;
    expect((await staffAction(request, "staff", { action: "add_note", client_id: c.id, note: "Full-scope staff note" })).status).toBe(200);
    expect((await staffAction(request, "staff", { action: "create_staff", display_name: "X", role: "admin" })).status).toBe(403);

    const up = await request.post("/api/staff/documents", {
      multipart: { client_id: c.id, doc_type: "photo_id", file: { name: "id.png", mimeType: "image/png", buffer: PNG } },
      headers: { cookie: `cg_at=${await accessToken("staff")}` },
    });
    expect(up.status()).toBe(201);
    const { id: docId } = await up.json();
    await expect.poll(async () => (await db()`select status from documents where id = ${docId}`)[0].status, { timeout: 15_000 }).not.toBe("pending");
    expect((await staffAction(request, "staff", { action: "verify_document", document_id: docId })).status).toBe(200);
    const [verified] = await db()`select status, reviewed_by from documents where id = ${docId}`;
    expect(verified.status).toBe("verified");
    expect(verified.reviewed_by).toBe(await staffId("staff"));
    const view = await request.get(`/api/documents/${docId}`, { headers: { cookie: `cg_at=${await accessToken("staff")}` } });
    expect(view.status()).toBe(200);
    expect((await view.json()).expires_in).toBe(600);
    const after = (await db()`select count(*)::int as n from security_events where event = 'access_denied'`)[0].n;
    expect(after - before).toBeGreaterThanOrEqual(1);
    await ctx.close();
  });

  test("manager and admin cannot manage team; super admin can", async ({ request }) => {
    expect((await staffAction(request, "manager", { action: "update_staff_role", staff_id: await staffId("staff"), role: "manager" })).status).toBe(403);
    expect((await staffAction(request, "admin", { action: "create_staff", display_name: `TEST Admin Denied ${RUN}`, email: null, role: "staff" })).status).toBe(403);
    const created = await staffAction(request, "superadmin", { action: "create_staff", display_name: `TEST New ${RUN}`, email: null, role: "staff" });
    expect(created.status).toBe(200);
    const invite = await staffAction(request, "superadmin", { action: "invite_staff", staff_id: created.json.staff_id });
    expect(invite.status).toBe(409);
  });

  test("cross-origin mutations and bad cron secrets are rejected", async ({ request }) => {
    const csrf = await request.post("/api/staff/action", { data: { action: "add_note" }, headers: { origin: "https://evil.example" } });
    expect(csrf.status()).toBe(403);
    expect((await request.get("/api/cron/maintenance")).status()).toBe(401);
    const ok = await request.get("/api/cron/maintenance", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(ok.status()).toBe(200);
  });

  test("staff sign-in reports NOT_CONFIGURED instead of pretending to send a code", async ({ page }) => {
    await page.goto("/staff/login");
    await page.getByLabel("Work email").fill("admin@test.invalid");
    await page.getByRole("button", { name: "Send sign-in code" }).click();
    await expect(page.locator("p[role=alert]")).toContainText("NOT_CONFIGURED");
  });
});
