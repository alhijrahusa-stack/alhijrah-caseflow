import { expect, test } from "@playwright/test";
import { db, signIn, STAFF } from "./helpers";

test.describe("Smart Career Collect Client", () => {
  test("stages evidence, preserves a manual correction, approves once, and creates the canonical Client", async ({ page, baseURL }) => {
    const token = Date.now().toString().slice(-7);
    const name = `TEST Smart Collect ${token}`;
    const phone = `313${token}`.slice(0, 10).padEnd(10, "7");
    const email = `smart.collect.${token}@test.invalid`;
    const [admin] = await db()`select id,display_name from staff where auth_user_id=${STAFF.admin}`;
    expect(admin?.id).toBeTruthy();

    await signIn(page.context(), baseURL!, "admin");
    await page.goto("/staff/import");
    await expect(page.getByRole("heading", { name: "SMART CAREER COLLECT CLIENT" })).toBeVisible();
    await expect(page.getByRole("button", { name: /NEW IMPORT BY SHEET/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /SMART CLIENT IMPORT BY LINK/ }).first()).toBeVisible();

    const csv = [
      "full_name,phone,email,preferred_language,english_proficiency,address,preferred_location,location_option_2,shift_days,shift_start_time,shift_end_time",
      `${name},${phone},${email},English,Good,"28772 GOODSON ST, DETROIT, MI 48212-3768",Romulus,Detroit,Thursday–Monday,6pm,4:30am`,
    ].join("\n");
    await page.locator('input[type="file"]').first().setInputFiles({ name: "smart-import.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "PREVIEW" }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("VALID", { exact: true }).first()).toBeVisible();

    const stageResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/staff/universal-intake",
    );
    await page.getByRole("button", { name: /STAGE SELECTED/ }).click();
    const stageResponse = await stageResponsePromise;
    expect(stageResponse.status(), await stageResponse.text()).toBe(201);
    await expect(page.getByText("1 import case staged.", { exact: true })).toBeVisible();

    const [staged] = await db()`
      select id,status,mapped_draft,field_evidence
      from client_import_cases
      where mapped_draft #>> '{profile,full_name}'=${name}
      order by created_at desc
      limit 1`;
    expect(staged?.status).toBe("PENDING");
    expect(staged?.mapped_draft?.profile?.full_name).toBe(name);
    expect(staged?.mapped_draft?.profile?.email).toBe(email);
    expect(staged?.mapped_draft?.profile?.preferred_language).toBe("en");
    expect(staged?.mapped_draft?.profile?.english_proficiency).toBe("GOOD");
    expect(staged?.mapped_draft?.profile?.street).toBe("28772 GOODSON ST");
    expect(staged?.mapped_draft?.profile?.city).toBe("DETROIT");
    expect(staged?.mapped_draft?.profile?.state).toBe("MI");
    expect(staged?.mapped_draft?.profile?.zip).toBe("48212-3768");
    expect(staged?.mapped_draft?.review_fields?.preferred_location).toBe("Romulus");
    expect(staged?.mapped_draft?.review_fields?.location_option_1).toBeNull();
    expect(staged?.mapped_draft?.review_fields?.location_option_2).toBe("Detroit");
    expect(staged?.mapped_draft?.review_fields?.shift_days).toEqual(["THU", "FRI", "SAT", "SUN", "MON"]);
    expect(staged?.mapped_draft?.review_fields?.shift_start_time).toBe("18:00");
    expect(staged?.mapped_draft?.review_fields?.shift_end_time).toBe("04:30");
    expect(Array.isArray(staged?.field_evidence)).toBe(true);
    expect(staged.field_evidence.some((item: { field_key?: string; authority?: string }) => item.field_key === "preferred_language" && item.authority === "SOURCE")).toBe(true);
    expect(staged.field_evidence.some((item: { field_key?: string; authority?: string }) => item.field_key === "english_proficiency" && item.authority === "SOURCE")).toBe(true);

    const queueResponse = await page.request.get(`${baseURL}/api/staff/smart-client-import`);
    expect(queueResponse.status(), await queueResponse.text()).toBe(200);
    const queuePayload = await queueResponse.json();
    expect(queuePayload.rows.some((row: { id: string }) => row.id === staged.id)).toBe(true);

    const importQueue = page.getByRole("heading", { name: "IMPORT QUEUE" }).locator("xpath=ancestor::section[1]");
    const queueRow = importQueue.getByRole("row").filter({ hasText: name }).first();
    await expect(queueRow).toBeVisible();
    await queueRow.getByRole("button", { name: "OPEN / EDIT" }).click();
    await expect(page.getByText("SMART CLIENT REVIEW", { exact: true })).toBeVisible();
    await expect(page.getByText("CLIENT DATA · VALIDATION MATRIX", { exact: true })).toBeVisible();
    const matrix = page.getByRole("table", { name: /validation matrix/i });
    for (const group of ["IDENTITY", "ADDRESS", "LANGUAGE & ENGLISH", "JOB PREFERENCES"]) {
      await expect(matrix.getByText(group, { exact: true })).toBeVisible();
    }
    for (const field of ["Full Name","Phone","Email","Date of Birth","Preferred Language","English Proficiency","Street","City","State","ZIP","Preferred Location","Location Option 1","Location Option 2","Shift Days","Shift Start","Shift End"]) {
      await expect(matrix.getByRole("rowheader", { name: new RegExp(`^${field}`) })).toBeVisible();
    }

    await page.getByLabel("REVIEWED BY").selectOption(String(admin.id));
    await expect(page.getByLabel("REVIEWED BY")).toHaveValue(String(admin.id));
    await page.getByRole("button", { name: "START REVIEW", exact: true }).click();
    await expect(page.getByText("Review started.", { exact: true })).toBeVisible();

    const languageRow = page.locator('tr[data-field="preferred_language"]');
    await expect(languageRow.locator('[data-label="Current value"]')).toHaveText("en");
    await expect(languageRow.locator('[data-label="Authority"]')).toHaveText("SOURCE");
    await languageRow.getByRole("button", { name: /^Edit Preferred Language/ }).click();
    const languageSelect = page.getByLabel("Preferred Language", { exact: true });
    await expect(languageSelect).toHaveValue("en");
    await languageSelect.selectOption("es");
    await expect(languageRow.locator('[data-label="Current value"]')).toHaveText("es");

    const verifyResponsePromise = page.waitForResponse((response) => {
      if (response.request().method() !== "POST" || new URL(response.url()).pathname !== "/api/staff/smart-client-import") return false;
      try {
        const body = response.request().postDataJSON() as { action?: string; id?: string } | null;
        return body?.action === "verify" && body?.id === staged.id;
      } catch {
        return false;
      }
    });
    await page.getByRole("button", { name: "CHECK & VERIFY" }).click();
    const verifyResponse = await verifyResponsePromise;
    expect(verifyResponse.status(), await verifyResponse.text()).toBe(200);
    await expect(page.getByText("Review saved and verification completed.", { exact: true })).toBeVisible();
    const [verifiedImport] = await db()`select status,mapped_draft,field_evidence from client_import_cases where id=${staged.id}`;
    expect(verifiedImport?.status).toBe("MISSING_DOCUMENT");
    expect(verifiedImport?.mapped_draft?.profile?.preferred_language).toBe("es");
    const languageEvidence = verifiedImport.field_evidence.filter((item: { field_key?: string }) => item.field_key === "preferred_language");
    expect(languageEvidence[0]?.authority).toBe("SOURCE");
    expect(languageEvidence.at(-1)?.authority).toBe("MANUAL");
    expect(languageEvidence.at(-1)?.source_type).toBe("manual_review");

    await page.getByText("CURRENT DOCUMENT STATUS REVIEWED", { exact: true }).click();
    await page.getByText("INFORMATION MATCH CONFIRMED", { exact: true }).click();
    await expect(page.getByRole("button", { name: "APPROVE FILE" })).toBeVisible();
    await page.getByRole("button", { name: "APPROVE FILE" }).click();
    await expect(page).toHaveURL(/\/staff\/client\/[0-9a-f-]+$/);

    await page.reload();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    const [client] = await db()`select id,full_name,email,preferred_language,english_proficiency,street,city,state,zip,
      preferred_location,location_option_1,location_option_2,shift_days,
      shift_start_time::text as shift_start_time,shift_end_time::text as shift_end_time
      from clients where full_name=${name} and deleted_at is null`;
    expect(client?.email).toBe(email);
    expect(client?.preferred_language).toBe("es");
    expect(client?.english_proficiency).toBe("GOOD");
    expect(client?.street).toBe("28772 GOODSON ST");
    expect(client?.city).toBe("DETROIT");
    expect(client?.state).toBe("MI");
    expect(client?.zip).toBe("48212-3768");
    expect(client?.preferred_location).toBe("Romulus");
    expect(client?.location_option_1).toBeNull();
    expect(client?.location_option_2).toBe("Detroit");
    expect(client?.shift_days).toEqual(["THU", "FRI", "SAT", "SUN", "MON"]);
    expect(client?.shift_start_time).toBe("18:00:00");
    expect(client?.shift_end_time).toBe("04:30:00");
    const [{ n: clientCount }] = await db()`select count(*)::int as n from clients where email=${email} and deleted_at is null`;
    expect(Number(clientCount)).toBe(1);
    const [approved] = await db()`select status,created_client_id from client_import_cases where created_client_id=${client.id}`;
    expect(approved?.status).toBe("APPROVED_FILE");
    const [followup] = await db()`select count(*)::int as n from tasks where client_id=${client.id} and title='Collect missing client documents'`;
    expect(Number(followup.n)).toBe(1);
  });

  test("archives an import softly from the active queue", async ({ page, baseURL }) => {
    const token = Date.now().toString().slice(-7);
    const name = `TEST Archive Import ${token}`;
    const phone = `734${token}`.slice(0, 10).padEnd(10, "8");
    await signIn(page.context(), baseURL!, "admin");
    await page.goto("/staff/import");

    const csv = `full_name,phone\n${name},${phone}\n`;
    await page.locator('input[type="file"]').first().setInputFiles({ name: "archive-import.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "PREVIEW" }).click();
    await page.getByRole("button", { name: /STAGE SELECTED/ }).click();
    await expect(page.getByText("1 import case staged.", { exact: true })).toBeVisible();

    const [staged] = await db()`select id from client_import_cases where mapped_draft #>> '{profile,full_name}'=${name} order by created_at desc limit 1`;
    expect(staged?.id).toBeTruthy();
    const importQueue = page.getByRole("heading", { name: "IMPORT QUEUE" }).locator("xpath=ancestor::section[1]");
    const queueRow = importQueue.getByRole("row").filter({ hasText: name }).first();
    await expect(queueRow).toBeVisible();
    page.once("dialog", async (dialog) => dialog.accept());
    await queueRow.getByRole("button", { name: "ARCHIVE" }).click();
    await expect(page.getByText("Import archived. Canonical client data was not deleted.", { exact: true })).toBeVisible();
    await expect(queueRow).toHaveCount(0);

    const [archived] = await db()`select archived_at,archived_by from client_import_cases where id=${staged.id}`;
    expect(archived?.archived_at).toBeTruthy();
    expect(archived?.archived_by).toBeTruthy();
    const [{ n }] = await db()`select count(*)::int as n from client_import_cases where id=${staged.id}`;
    expect(Number(n)).toBe(1);
  });

  test("mobile route is protected and exposes opt-in audio only after authentication", async ({ page, baseURL }) => {
    await page.context().clearCookies();
    await page.goto("/staff/smart-client-import/new");
    await expect(page).toHaveURL(/\/staff\/login\?next=%2Fstaff%2Fsmart-client-import%2Fnew/);

    await signIn(page.context(), baseURL!, "admin");
    await page.goto("/staff/smart-client-import/new");
    const audio = page.getByRole("button", { name: /Turn audio on/ });
    await expect(audio).toBeVisible();
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    await audio.click();
    await expect(page.getByRole("button", { name: /Turn audio off/ })).toHaveAttribute("aria-pressed", "true");
  });
});