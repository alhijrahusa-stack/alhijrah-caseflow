import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { db, intakeBody, RUN, signIn, STAFF, staffAction, submitIntake, uniqueIp } from "./helpers";

async function createClient(request: APIRequestContext, suffix: string) {
  const body = intakeBody(`TEST P2 ${suffix} ${RUN}`);
  const profile = {
    ...body.profile, date_of_birth: "1992-03-04", preferred_language: "ar", english_proficiency: "GOOD",
    street: "100 Test Street", city: "Dearborn", state: "MI", zip: "48126", appointment_availability: "Weekday mornings",
    amazon_worked_before: true, amazon_worked_from: "2020-01-02", amazon_worked_to: "2021-02-03",
    amazon_applied_before: true, amazon_application_email: `amazon.${suffix}.${RUN}@test.invalid`, currently_amazon: false, via_agency: true,
    employment_history: [{ employment_kind: "company", company: "TEST Employer", job_title: "Associate", from_date: "2022-01-01", to_date: "2023-01-01" }],
  };
  const result = await submitIntake(request, { ...body, profile });
  expect(result.res.status(), JSON.stringify(result.json)).toBe(201);
  const [client] = await db()`select * from clients where ref=${result.json.ref}`;
  return { client, profile };
}

test("AC-01 / AC-07: every profile field survives intake, edit, atomic save, reload and database comparison", async ({ request, page, baseURL }) => {
  const { client, profile } = await createClient(request, "allfields");
  for (const [key, value] of Object.entries(profile)) {
    if (key !== "employment_history") expect(client[key], key).toEqual(value);
  }
  const [authorization] = await db()`select signature,printed_name from client_authorizations where client_id=${client.id}`;
  expect(authorization).toMatchObject({ signature: profile.full_name, printed_name: profile.full_name });
  const [history] = await db()`select employment_kind,company,job_title,from_date,to_date from employment_history where client_id=${client.id}`;
  expect(history).toEqual(profile.employment_history[0]);
  await signIn(page.context(), baseURL!, "admin");
  await page.goto(`/staff/client/${client.id}/edit`);
  for (const key of ["full_name", "phone", "email", "date_of_birth", "preferred_language", "english_proficiency", "street", "city", "state", "zip", "appointment_availability", "amazon_worked_from", "amazon_worked_to", "amazon_application_email"] as const) {
    await expect(page.locator(`#${key === "city" ? "addr_city" : key === "state" ? "addr_state" : key}`), key).toHaveValue(profile[key]);
  }
  for (const key of ["amazon_worked_before", "amazon_applied_before", "currently_amazon", "via_agency"] as const) {
    await expect(page.locator(`input[name="${key}"][value="${profile[key] ? "yes" : "no"}"]`)).toBeChecked();
  }
  await expect(page.locator("#emp_company_0")).toHaveValue("TEST Employer");
  await page.getByLabel("English proficiency", { exact: true }).selectOption("EXCELLENT");
  await page.getByLabel("Street address", { exact: true }).fill("101 Test Street");
  await page.getByLabel("Preferred location", { exact: true }).fill("Romulus");
  await page.getByLabel("Location option 1", { exact: true }).fill("Detroit");
  await page.getByLabel("Location option 2", { exact: true }).fill("Livonia");
  await page.getByLabel("THU", { exact: true }).check();
  await page.getByLabel("FRI", { exact: true }).check();
  await page.getByLabel("Shift start", { exact: true }).fill("18:00");
  await page.getByLabel("Shift end", { exact: true }).fill("04:30");
  await page.locator("#ec_next").fill("Verify test documents");
  const writes: string[] = [];
  page.on("request", (r) => { if (new URL(r.url()).pathname === "/api/staff/action" && r.method() === "POST") writes.push(r.postData() ?? ""); });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.waitForURL(`**/staff/client/${client.id}`);
  expect(writes).toHaveLength(1);
  await page.reload();
  const [saved] = await db()`select *,shift_start_time::text as starts,shift_end_time::text as ends from clients where id=${client.id}`;
  const expected = { ...profile, street: "101 Test Street", english_proficiency: "EXCELLENT" };
  for (const [key, value] of Object.entries(expected)) if (key !== "employment_history") expect(saved[key], key).toEqual(value);
  expect(saved).toMatchObject({ preferred_location: "Romulus", location_option_1: "Detroit", location_option_2: "Livonia", shift_days: ["THU", "FRI"], starts: "18:00:00", ends: "04:30:00", next_step: "Verify test documents" });
  for (const [key, value] of Object.entries(expected.employment_history[0])) expect((await db()`select * from employment_history where client_id=${client.id}`)[0][key], key).toEqual(value);
  await expect(page.getByTestId("inline-english_proficiency")).toContainText("EXCELLENT");
  const info = page.locator("#client-info");
  for (const value of [profile.full_name, profile.email, "101 Test Street", "Dearborn", "48126", "Romulus", "Detroit", "Livonia", "THU, FRI", "18:00:00 – 04:30:00"]) await expect(info).toContainText(value);
  await page.getByRole("link", { name: "Edit Client", exact: true }).click();
  await expect(page.getByLabel("Location option 2", { exact: true })).toHaveValue("Livonia");
  await expect(page.getByLabel("Shift start", { exact: true })).toHaveValue("18:00");
  await expect(page.getByLabel("FRI", { exact: true })).toBeChecked();
});

test("AC-02: interrupted staff save preserves the draft through reload and a real retry", async ({ request, page, baseURL }) => {
  const { client } = await createClient(request, "network");
  await signIn(page.context(), baseURL!, "admin");
  await page.goto(`/staff/client/${client.id}/edit`);
  await page.getByLabel("City", { exact: true }).fill("Livonia");
  await page.getByLabel("Location option 2", { exact: true }).fill("Detroit");
  await page.route("**/api/staff/action", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert").last()).toBeVisible();
  expect((await db()`select city from clients where id=${client.id}`)[0].city).toBe("Dearborn");
  await expect.poll(() => page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? "{}").profile?.city, `career-gate:client-draft:${client.id}`)).toBe("Livonia");
  await page.reload();
  await expect(page.getByLabel("City", { exact: true })).toHaveValue("Livonia");
  await expect(page.getByLabel("Location option 2", { exact: true })).toHaveValue("Detroit");
  await page.unroute("**/api/staff/action");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.waitForURL(`**/staff/client/${client.id}`);
  await page.reload();
  await expect(page.getByTestId("inline-city")).toContainText("Livonia");
  expect((await db()`select city,location_option_2 from clients where id=${client.id}`)[0]).toMatchObject({ city: "Livonia", location_option_2: "Detroit" });
});

test("combined save rolls back every mutation and audit row on domain failure and retains command permissions", async ({ request }) => {
  const { client, profile } = await createClient(request, "atomic");
  const [staff] = await db()`select id,permission_mode,custom_permissions from staff where auth_user_id=${STAFF.staff}`;
  const beforeLogs = (await db()`select count(*)::int n from activity_log where client_id=${client.id}`)[0].n;
  const failed = await staffAction(request, "admin", { action: "update_client", client_id: client.id, profile: { ...profile, city: "Must roll back" }, next_step: "Must roll back", assigned_staff: randomUUID() });
  expect(failed.status, JSON.stringify(failed.json)).toBe(400);
  expect(failed.json.error.code).toBe("invalid_staff");
  expect((await db()`select city,next_step from clients where id=${client.id}`)[0]).toMatchObject({ city: client.city, next_step: client.next_step });
  expect((await db()`select count(*)::int n from activity_log where client_id=${client.id}`)[0].n).toBe(beforeLogs);
  const assigned = await staffAction(request, "admin", { action: "assign_staff", client_id: client.id, staff_id: staff.id });
  expect(assigned.status).toBe(200);
  const escalation = await staffAction(request, "staff", { action: "update_client", client_id: client.id, profile: { ...profile, city: "Forbidden" }, assigned_staff: null });
  expect(escalation.status).toBe(403);
  try {
    await db()`update staff set permission_mode='custom',custom_permissions=${["update_client"]} where id=${staff.id}`;
    const denied = await staffAction(request, "staff", { action: "update_client", client_id: client.id, profile: { ...profile, city: "Forbidden" }, next_step: "Forbidden" });
    expect(denied.status).toBe(403);
    expect((await db()`select city from clients where id=${client.id}`)[0].city).toBe(client.city);
  } finally {
    await db()`update staff set permission_mode=${staff.permission_mode},custom_permissions=${staff.custom_permissions} where id=${staff.id}`;
  }
});

test("concurrent profile saves reject the stale writer without losing the winner's data or duplicating its audit", async ({ request }) => {
  const { client, profile } = await createClient(request, "concurrency");
  const expected_updated_at = new Date(client.updated_at).toISOString();
  const results = await Promise.all(["Detroit", "Livonia"].map((city) => staffAction(request, "admin", { action: "update_client", client_id: client.id, profile: { ...profile, city }, expected_updated_at })));
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(results.find((r) => r.status === 409)?.json.error.code).toBe("edit_conflict");
  const winner = results.findIndex((r) => r.status === 200);
  expect((await db()`select city from clients where id=${client.id}`)[0].city).toBe(["Detroit", "Livonia"][winner]);
  expect((await db()`select count(*)::int n from activity_log where client_id=${client.id} and action='client_updated'`)[0].n).toBe(1);
});

test("AC-01 / AC-05 / AC-07: concurrent HTML intake retains canonical language, address, location and overnight shift fields", async ({ request, page, baseURL }) => {
  const payload = { uid: randomUUID(), service: "employment", firstName: "TEST", lastName: `P2 HTML ${RUN}`, phone: "2025550168", email: `p2-html-${RUN}@test.invalid`, dob: "1991-02-03", preferredLanguage: "es", englishLevel: "Good", address1: "123 Test Road", city: "Dearborn", state: "MI", zip: "48126", workType: "Full-Time", shiftCode: "FHD", branch: "DET3", branchName: "Pontiac - DET3", preferredLocations: ["Romulus", "Detroit", "Livonia"], shiftDays: "Thursday–Monday", shiftHours: "6pm – 4:30am", signature: { captured: true }, consent: true };
  const invalidDate = await request.post("/api/application", { data: { ...payload, dob: "1991-02-31" }, headers: { "x-forwarded-for": uniqueIp() } });
  expect(invalidDate.status()).toBe(400);
  expect((await invalidDate.json()).code).toBe("invalid_date");
  const incomplete = await request.post("/api/application", { data: { ...payload, firstName: "" }, headers: { "x-forwarded-for": uniqueIp() } });
  expect(incomplete.status()).toBe(400);
  expect((await db()`select count(*)::int n from clients where email=${payload.email}`)[0].n).toBe(0);
  const responses = await Promise.all([1,2].map(() => request.post("/api/application", { data: payload, headers: { "x-forwarded-for": uniqueIp() } })));
  expect(responses.map((r) => r.status()).sort()).toEqual([200,201]);
  const bodies = await Promise.all(responses.map((r) => r.json()));
  expect(bodies[0].systemId).toBe(bodies[1].systemId);
  const rows = await db()`select *,shift_start_time::text starts,shift_end_time::text ends from clients where ref=${bodies[0].systemId}`;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ full_name: `${payload.firstName} ${payload.lastName}`, phone: payload.phone, email: payload.email, date_of_birth: payload.dob, preferred_language: "es", english_proficiency: "GOOD", street: payload.address1, city: payload.city, state: payload.state, zip: payload.zip, preferred_location: "Romulus", location_option_1: "Detroit", location_option_2: "Livonia", shift_days: ["THU","FRI","SAT","SUN","MON"], starts: "18:00:00", ends: "04:30:00" });
  expect((await db()`select count(*)::int n from career_gate_applications where submission_uid=${payload.uid}`)[0].n).toBe(1);
  const created = await db()`select action from activity_log where client_id=${rows[0].id} and action in ('client_created','application_submitted') order by created_at`;
  expect(created.map((r) => r.action)).toEqual(["client_created", "application_submitted"]);
  await signIn(page.context(), baseURL!, "admin");
  await page.goto(`/staff/client/${rows[0].id}?tab=profile`);
  for (const value of ["GOOD", "Romulus", "Detroit", "Livonia", "THU, FRI, SAT, SUN, MON", "18:00:00 – 04:30:00"]) await expect(page.locator("#client-info")).toContainText(value);
});

test("AC-06 / E: every dashboard KPI opens its source and readiness lists match the canonical requirements", async ({ page, baseURL }) => {
  await signIn(page.context(), baseURL!, "admin");
  await page.goto("/staff");
  const links = await page.locator(".staff-kpi").evaluateAll((cards) => cards.map((card) => card.closest("a")?.getAttribute("href")));
  expect(links.length).toBeGreaterThan(10);
  for (const link of links) expect(link).toMatch(/^\/staff\//);
  for (const readiness of ["ready", "nearly_ready", "blocked", "missing"]) {
    await page.goto(`/staff/clients?readiness=${readiness}`);
    const [count] = await db()`select count(*)::int n from clients c join client_readiness r on r.client_id=c.id
      where c.deleted_at is null and c.current_status not in ('completed','cancelled') and r.total_requirements>0
      and ((${readiness}='ready' and r.readiness_percent=100)
        or (${readiness}='nearly_ready' and r.readiness_percent between 75 and 99)
        or (${readiness}='blocked' and coalesce(r.readiness_percent,0)<75)
        or (${readiness}='missing' and r.total_requirements>r.completed_requirements))`;
    await expect(page.getByTestId("client-total")).toContainText(`${count.n} client`);
    await page.getByRole("search").getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`readiness=${readiness}`));
    await expect(page.getByTestId("client-total")).toContainText(`${count.n} client`);
  }
  await page.goto("/staff/settings#system-health");
  await expect(page.getByRole("heading", { name: "Operational System Health", exact: true })).toBeVisible();
  await expect(page.locator("#system-health")).toContainText("Dead jobs");
  await signIn(page.context(), baseURL!, "manager");
  await page.goto("/staff/settings#system-health");
  await expect(page.locator("#system-health")).toHaveCount(0);
});

test("AC-06: client registry dates hydrate consistently when the employee's browser is in another time zone", async ({ request, browser, baseURL }) => {
  const { client } = await createClient(request, "timezone");
  const context = await browser.newContext({ baseURL, timezoneId: "Pacific/Honolulu" });
  try {
    await signIn(context, baseURL!, "admin");
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`/staff/clients?q=${encodeURIComponent(client.ref)}`);
    const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: client.ref, exact: true }) });
    await expect(row).toBeVisible();
    const [stored] = await db()`select updated_at from clients where id=${client.id}`;
    const officeTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Detroit" }).format(new Date(stored.updated_at));
    await expect(row.locator("td").nth(5)).toHaveText(officeTime);
    await row.getByRole("button", { name: "View", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Client quick view" })).toContainText(officeTime);
    expect(errors.filter((message) => /hydration|#418|didn't match|does not match/i.test(message))).toEqual([]);
  } finally {
    await context.close();
  }
});
