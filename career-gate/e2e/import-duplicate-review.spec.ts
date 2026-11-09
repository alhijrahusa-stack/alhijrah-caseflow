import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { db, intakeBody, RUN, signIn, STAFF, staffAction } from "./helpers";

async function queueFile(name: string, phone: string, extras = false) {
  const [actor] = await db()`select id from staff where auth_user_id=${STAFF.manager}`;
  const [batch] = await db()`insert into client_import_batches(source_type,source_file_hash,idempotency_key,created_by) values('csv',${"d".repeat(64)},${randomUUID()},${actor.id}) returning id`;
  if (extras) await db()`insert into client_import_cases(batch_id,source_type,mapped_draft,created_by) select ${batch.id},'csv',jsonb_build_object('profile',jsonb_build_object('full_name',${name}||' Queue '||n,'phone','616554'||lpad(n::text,4,'0'))),${actor.id} from generate_series(1,51) n`;
  const [row] = await db()`insert into client_import_cases(batch_id,source_type,mapped_draft,created_by) values(${batch.id},'csv',${db().json({ profile: { full_name: name, phone, ssn: "123-45-6789" }, primary: [], backup: [] })},${actor.id}) returning id,public_ref`;
  await db()`insert into client_import_documents(import_case_id,storage_reference,original_filename,mime_type,size_bytes,sha256,uploaded_by) values(${row.id},${randomUUID()},'comparison-source.pdf','application/pdf',128,${"e".repeat(64)},${actor.id})`;
  return row as { id: string; public_ref: string };
}

test("employee reviews the complete queue, manager receives saved comparison and approves one recoverable deletion", async ({ browser, request, baseURL }) => {
  const name = `TEST Duplicate Handoff ${RUN}`, body = intakeBody(name);
  const created = await staffAction(request, "admin", { action: "create_client", profile: body.profile, primary: [], backup: [], status: "new_intake", next_step: null, assigned_staff: null, communication_consent: false });
  expect(created.status, JSON.stringify(created.json)).toBe(200);
  const source = await queueFile(name, body.profile.phone, true);
  const staff = await browser.newContext({ baseURL }), manager = await browser.newContext({ baseURL });
  try {
    await signIn(staff, baseURL!, "staff"); await signIn(manager, baseURL!, "manager");
    const page = await staff.newPage();
    await page.goto("/staff/import");
    await page.getByTestId("import-duplicate-launcher").click();
    const dialog = page.getByRole("dialog", { name: "Duplicate Review & Manager Handoff" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Search all queued clients").fill(name);
    await expect(dialog.getByRole("button", { name: /Load more clients/ })).toBeVisible();
    await dialog.getByRole("button", { name: /Load more clients/ }).click();
    await expect(dialog.getByRole("button", { pressed: false }).filter({ hasText: /Queue \d/ })).toHaveCount(51);
    await dialog.getByRole("button").filter({ has: page.locator("strong", { hasText: name }) }).filter({ hasText: source.public_ref }).click();
    const comparison = dialog.getByTestId("import-comparison");
    await expect(comparison).toHaveAttribute("data-level", "exact");
    await expect(comparison.getByText("New Intake", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Handoff reason")).toHaveValue("exact_duplicate");
    await expect(dialog.locator("textarea")).toHaveCount(0);
    await expect(dialog.getByText("123-45-6789")).toHaveCount(0);
    expect(await dialog.getByRole("button", { name: /Send to manager/ }).evaluate(node => getComputedStyle(node).backgroundImage)).toContain("120, 56, 78");
    await page.screenshot({ path: "test-results/import-duplicate-desktop.png", fullPage: true });
    await dialog.getByRole("button", { name: /Send to manager/ }).click();
    await expect(dialog.getByRole("status").filter({ hasText: "Sent to the manager" })).toBeVisible();
    const [held] = await db()`select manager_review_id,created_client_id from client_import_cases where id=${source.id}`;
    expect(held.manager_review_id).toBeTruthy(); expect(held.created_client_id).toBeNull();

    const managerPage = await manager.newPage(); let extraScans = 0;
    managerPage.on("request", request => { if (request.url().includes("import-duplicate-review") && request.url().includes("mode=scan")) extraScans++; });
    await managerPage.goto("/staff/manager-inbox");
    await managerPage.getByTestId("manager-task-canvas").getByRole("button").filter({ hasText: name }).click();
    const review = managerPage.getByTestId("import-manager-review");
    await expect(review.getByTestId("import-comparison")).toHaveAttribute("data-level", "exact");
    expect(extraScans).toBe(0);
    await expect(review.getByRole("button", { name: "Approve deletion of selected record" })).toBeDisabled();
    await review.getByLabel("Record to delete").selectOption(`import:${source.id}`);
    await review.getByRole("button", { name: "Approve deletion of selected record" }).click();
    await expect(review).toHaveCount(0);
    expect((await db()`select archived_at from client_import_cases where id=${source.id}`)[0].archived_at).toBeTruthy();
    expect((await db()`select deleted_at from clients where id=${created.json.client_id}`)[0].deleted_at).toBeNull();
    expect((await db()`select count(*)::int n from client_import_documents where import_case_id=${source.id}`)[0].n).toBe(1);
    await managerPage.goto("/staff/archive");
    const trash = managerPage.getByTestId("import-trash");
    const trashed = trash.getByRole("article").filter({ hasText: name });
    await expect(trashed).toBeVisible();
    await trashed.getByRole("button", { name: "Restore file", exact: true }).click();
    await expect(trash.getByRole("status")).toContainText("restored");
    expect((await db()`select archived_at,manager_review_id from client_import_cases where id=${source.id}`)[0]).toMatchObject({ archived_at: null, manager_review_id: null });
  } finally { await Promise.allSettled([staff.close(), manager.close()]); }
});

test("Arabic mobile comparison shows a real negative and never treats a failed scan as no duplicate", async ({ browser, baseURL }) => {
  const name = `TEST Mobile Unique ${RUN}`, source = await queueFile(name, "7345558991");
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  try {
    await signIn(context, baseURL!, "staff");
    await context.addCookies([{ name: "cg-staff-language", value: "ar", url: baseURL! }]);
    const page = await context.newPage();
    await page.goto("/staff/import"); await page.getByTestId("import-duplicate-launcher").click();
    const dialog = page.getByRole("dialog", { name: "فحص التكرار والتحويل للمدير" });
    await dialog.getByLabel("البحث في جميع عملاء الانتظار").fill(name);
    await dialog.getByRole("button").filter({ hasText: source.public_ref }).click();
    await expect(dialog.getByTestId("import-comparison")).toHaveAttribute("data-level", "none");
    await expect(dialog.getByText("لم يُعثر على سجل مطابق", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "test-results/import-duplicate-arabic-mobile.png", fullPage: true });
    await page.route("**/api/staff/import-duplicate-review?**", async route => {
      if (new URL(route.request().url()).searchParams.get("mode") === "scan") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { message: "تعذر الاتصال بقاعدة البيانات" } }) });
      else await route.continue();
    });
    await dialog.getByRole("button", { name: "فحص التكرار", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText("تعذر الاتصال بقاعدة البيانات");
    await expect(dialog.getByTestId("import-comparison")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /^تحويل للمدير/ })).toBeDisabled();
  } finally { await context.close(); }
});

test("Smart Client Review has the same comparison and manager controls", async ({ browser, baseURL }) => {
  const source = await queueFile(`TEST Smart Review Shortcut ${RUN}`, "7345558992");
  const context = await browser.newContext({ baseURL });
  try {
    await signIn(context, baseURL!, "manager");
    const page = await context.newPage();
    await page.goto(`/staff/import?case=${source.id}`);
    const review = page.locator("#smart-review");
    await expect(review).toBeVisible();
    await review.getByTestId("review-duplicate-launcher").click();
    const dialog = page.getByRole("dialog", { name: "Duplicate Review & Manager Handoff" });
    await expect(dialog.getByTestId("import-comparison")).toHaveAttribute("data-level", "none");
    await expect(dialog.getByRole("button", { name: /Send to manager/ })).toBeEnabled();
  } finally { await context.close(); }
});
