import { expect, test } from "@playwright/test";
import { PNG, db, signIn, STAFF } from "./helpers";

const DESKTOP = { width: 1500, height: 1000 };
const TABLET = { width: 900, height: 1100 };
const MOBILE = { width: 390, height: 844 };

test.describe("Smart Client Import experience", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signIn(page.context(), baseURL!, "admin");
    await page.setViewportSize(DESKTOP);
  });

  test("previews a selected image locally, keeps it out of the network until submit, and releases the object URL on remove", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => { if (request.method() === "POST") requests.push(new URL(request.url()).pathname); });

    await page.goto("/staff/smart-client-import/new");
    await expect(page.getByRole("heading", { name: "SMART CLIENT IMPORT" })).toBeVisible();

    await page.locator("#smart-files").setInputFiles({ name: "client-id.png", mimeType: "image/png", buffer: PNG });

    const card = page.getByRole("list", { name: "Captured files" }).getByRole("listitem").filter({ hasText: "client-id.png" });
    await expect(card).toBeVisible();
    const preview = card.getByRole("img", { name: "Preview of client-id.png" });
    await expect(preview).toBeVisible();
    const previewSrc = await preview.getAttribute("src");
    expect(previewSrc).toMatch(/^blob:/);

    // Every real state is on the card, not hidden behind one spinner.
    await expect(card.getByText("VALIDATED", { exact: true })).toBeVisible();
    await expect(card.getByText("READY TO UPLOAD", { exact: true })).toBeVisible();
    await expect(card.getByText("WAITING", { exact: true })).toBeVisible();
    await expect(card.getByText("image/png")).toBeVisible();
    await expect(card.getByRole("link", { name: "Open preview of client-id.png" })).toBeVisible();

    // The preview exists before anything has been posted.
    expect(requests).toEqual([]);

    // Removing the file revokes its object URL; the browser can no longer resolve it.
    await card.getByRole("button", { name: "Remove client-id.png" }).click();
    await expect(card).toHaveCount(0);
    const stillResolvable = await page.evaluate(async (url) => {
      try { const res = await fetch(url); return res.ok; } catch { return false; }
    }, previewSrc!);
    expect(stillResolvable).toBe(false);
  });

  test("rejects an unsupported file locally with the exact reason and never uploads it", async ({ page }) => {
    await page.goto("/staff/smart-client-import/new");
    await page.locator("#smart-files").setInputFiles({ name: "payroll.txt", mimeType: "text/plain", buffer: Buffer.from("not a document") });

    const issues = page.getByRole("region", { name: "ISSUES & RESOLUTION" });
    await expect(issues.getByText(/Unsupported type text\/plain/).first()).toBeVisible();
    await expect(page.getByRole("list", { name: "Captured files" }).getByRole("listitem")).toHaveCount(0);
    // The authoritative file policy stays stated on the capture surface.
    await expect(page.getByText(/max 10 files/).first()).toBeVisible();
    await expect(page.getByText(/25\.00 MB total/).first()).toBeVisible();
  });

  test("shows every one of the sixteen fields with value, state, provenance and authority, and never infers a preferred language from English ability", async ({ page }) => {
    await page.goto("/staff/smart-client-import/new");
    await page.locator("#smart-source-text").fill([
      "Full Name: TEST Intelligence Client",
      "Phone: 313-555-0142",
      "DOB: 03/14/1990",
      "Englis is goog",
      "6461 MEAD ST",
      "DEARBORN, MI 48126-2041",
      "Romulus night shift",
      "Shift Days: Thu-Mon",
      "Shift Start: 6pm",
      "Shift End: 4:30am",
    ].join("\n"));

    const intelligence = page.getByRole("region", { name: "LIVE INTELLIGENCE" });
    await expect(intelligence).toBeVisible();
    for (const group of ["IDENTITY", "ADDRESS", "LANGUAGE & ENGLISH", "JOB PREFERENCES"]) {
      await expect(intelligence.getByRole("heading", { name: group })).toBeVisible();
    }

    const field = (key: string) => intelligence.locator(`[data-field="${key}"]`);
    const value = (key: string) => field(key).locator("[data-value]");
    const state = (key: string) => field(key).locator("[data-state]");
    const provenance = (key: string) => field(key).locator("[data-provenance]");
    const authority = (key: string) => field(key).locator("[data-authority]");

    // Every one of the sixteen fields is present as a name/value pair.
    for (const key of ["full_name","phone","email","date_of_birth","street","city","state","zip","preferred_language","english_proficiency","preferred_location","location_option_1","location_option_2","shift_days","shift_start_time","shift_end_time"]) {
      await expect(field(key)).toHaveCount(1);
    }

    // English ability sets proficiency and leaves preferred language alone.
    await expect(value("english_proficiency")).toHaveText("GOOD");
    await expect(value("preferred_language")).toHaveText("—");
    await expect(state("preferred_language")).toHaveText("MISSING");

    // Residential city and work preference stay separate.
    await expect(value("city")).toHaveText("DEARBORN");
    await expect(value("preferred_location")).toHaveText("Romulus");
    await expect(value("location_option_1")).toHaveText("—");

    // Canonical readings, each labelled with where the value came from.
    await expect(value("date_of_birth")).toHaveText("1990-03-14");
    await expect(value("shift_days")).toHaveText("THU, FRI, SAT, SUN, MON");
    await expect(value("shift_start_time")).toHaveText("18:00");
    await expect(value("shift_end_time")).toHaveText("04:30");
    await expect(provenance("shift_start_time")).toHaveText("normalized");
    await expect(provenance("full_name")).toHaveText("local_text");
    await expect(authority("full_name")).toHaveText("SOURCE");
    await expect(authority("english_proficiency")).toHaveText("SOURCE");

    // Readiness is an exact count, never a percentage.
    await expect(intelligence.getByText("2 / 2 REQUIRED FIELDS")).toBeVisible();
    await expect(page.getByText(/\d%/)).toHaveCount(0);
  });

  test("reports a real source problem against its own field with a concrete action", async ({ page }) => {
    await page.goto("/staff/smart-client-import/new");
    await page.locator("#smart-source-text").fill("Full Name: TEST Issue Client\nPhone: 313-555-0143\nShift Start: 99pm");

    const issues = page.getByRole("region", { name: "ISSUES & RESOLUTION" });
    await expect(issues.getByText("SHIFT START", { exact: true })).toBeVisible();
    await expect(issues.getByText(/Source value "99pm" is not a valid shift start/)).toBeVisible();
    await expect(issues.getByText(/Something went wrong/i)).toHaveCount(0);
  });

  test("telemetry reports the real status and the pipeline reports real stages", async ({ page }) => {
    await page.goto("/staff/smart-client-import/new");
    const status = page.getByRole("status").first();
    await expect(status).toHaveText("CAPTURING");

    await page.locator("#smart-source-text").fill("Full Name: TEST Status Client\nPhone: 313-555-0144");
    await expect(status).toHaveText("READY TO SUBMIT");

    const pipeline = page.getByRole("region", { name: "PROCESSING PIPELINE" });
    for (const stage of ["SOURCE CAPTURE", "LOCAL EXTRACTION", "DOCUMENT PROCESSING", "ENRICHMENT", "STAGING", "REVIEW READINESS"]) {
      await expect(pipeline.getByText(stage, { exact: true })).toBeVisible();
    }
    await expect(pipeline.getByText("COMPLETE").first()).toBeVisible();
    await expect(pipeline.getByText("WAITING").first()).toBeVisible();
  });

  test("submits captured source, runs the Digital Handshake and stages one case", async ({ page }) => {
    const token = Date.now().toString().slice(-7);
    const name = `TEST Handshake ${token}`;
    await page.goto("/staff/smart-client-import/new");
    await page.locator("#smart-source-text").fill(`Full Name: ${name}\nPhone: 313${token}`.slice(0, 200));

    await page.getByRole("button", { name: "SUBMIT" }).click();
    await expect(page.getByText("SOURCE CAPTURED", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "OPEN SMART CAREER COLLECT CLIENT" })).toBeVisible();

    const [staged] = await db()`select id,status from client_import_cases where mapped_draft #>> '{profile,full_name}'=${name} order by created_at desc limit 1`;
    expect(staged?.id).toBeTruthy();
    const [{ n }] = await db()`select count(*)::int as n from client_import_cases where mapped_draft #>> '{profile,full_name}'=${name}`;
    expect(Number(n)).toBe(1);
  });

  test("audio is off by default, opts in without blocking, and survives a reload", async ({ page }) => {
    await page.goto("/staff/smart-client-import/new");
    const off = page.getByRole("button", { name: /Turn audio on/ });
    await expect(off).toHaveAttribute("aria-pressed", "false");
    await off.click();
    await expect(page.getByRole("button", { name: /Turn audio off/ })).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await expect(page.getByRole("button", { name: /Turn audio off/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("is keyboard navigable with visible focus and 44px touch targets", async ({ page }) => {
    await page.goto("/staff/smart-client-import/new");
    await page.locator("#smart-files").setInputFiles({ name: "client-id.png", mimeType: "image/png", buffer: PNG });

    const targets = [
      page.getByRole("button", { name: /Turn audio on/ }),
      page.getByRole("button", { name: "Remove client-id.png" }),
      page.getByRole("link", { name: "Open preview of client-id.png" }),
    ];
    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }

    // Focus reaches the controls and is visibly styled rather than suppressed.
    await page.getByRole("button", { name: /Turn audio on/ }).focus();
    const outline = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement;
      return getComputedStyle(active).outlineStyle;
    });
    expect(outline).not.toBe("none");

    // The source textarea carries a real accessible name.
    await expect(page.getByRole("textbox", { name: "Client source data" })).toBeVisible();
  });

  test("ambient motion stops while the tab is hidden", async ({ page }) => {
    await page.goto("/staff/smart-client-import/new");
    const ambient = page.locator("[data-cg-ambient]");
    await expect(ambient).toHaveAttribute("data-cg-ambient", "running");

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(ambient).toHaveAttribute("data-cg-ambient", "paused");
  });

  test("stacks into a single operational column on a phone without a horizontal scrollbar", async ({ page }) => {
    for (const viewport of [DESKTOP, TABLET, MOBILE]) {
      await page.setViewportSize(viewport);
      await page.goto("/staff/smart-client-import/new");
      await expect(page.getByRole("heading", { name: "SMART CLIENT IMPORT" })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow at ${viewport.width}px`).toBeLessThanOrEqual(1);
    }

    await page.setViewportSize(MOBILE);
    await page.goto("/staff/smart-client-import/new");
    const order = await page.evaluate(() => {
      const titles = ["SOURCE CAPTURE", "CLIENT SOURCE DATA", "LIVE INTELLIGENCE", "JOB PREFERENCES", "PROCESSING PIPELINE", "ISSUES & RESOLUTION"];
      return titles.map((title) => {
        const heading = [...document.querySelectorAll("h2")].find((node) => node.textContent?.trim() === title);
        return heading ? Math.round(heading.getBoundingClientRect().top + window.scrollY) : -1;
      });
    });
    expect(order.every((value) => value >= 0)).toBe(true);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    expect(order[2]).toBeLessThan(order[4]);
    expect(order[4]).toBeLessThan(order[5]);
  });

  test("honours prefers-reduced-motion without hiding any operational state", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/staff/smart-client-import/new");
    await page.locator("#smart-source-text").fill("Full Name: TEST Reduced Motion\nPhone: 313-555-0145");

    const stopped = await page.evaluate(() =>
      [...document.querySelectorAll(".cg-ambient")].every((node) => getComputedStyle(node).animationName === "none"));
    expect(stopped).toBe(true);

    // State is still fully legible with motion disabled.
    await expect(page.getByRole("status").first()).toHaveText("READY TO SUBMIT");
    await expect(page.getByText("2 / 2 REQUIRED FIELDS")).toBeVisible();
  });
});

test.describe("Smart Review experience", () => {
  test("edits a field inline with manual authority, reverts on Escape, and blocks approval only for real reasons", async ({ page, baseURL }) => {
    const token = Date.now().toString().slice(-7);
    const name = `TEST Review UI ${token}`;
    const phone = `248${token}`.slice(0, 10).padEnd(10, "6");
    const [admin] = await db()`select id from staff where auth_user_id=${STAFF.admin}`;

    await signIn(page.context(), baseURL!, "admin");
    await page.setViewportSize(DESKTOP);
    await page.goto("/staff/import");

    const csv = `full_name,phone,english_proficiency,shift_days\n${name},${phone},Englis is goog,Weekdays\n`;
    await page.locator('input[type="file"]').first().setInputFiles({ name: "review-ui.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "PREVIEW" }).click();
    await page.getByRole("button", { name: /STAGE SELECTED/ }).click();
    await expect(page.getByText("1 import case staged.", { exact: true })).toBeVisible();

    const importQueue = page.getByRole("heading", { name: "IMPORT QUEUE" }).locator("xpath=ancestor::section[1]");
    await importQueue.getByRole("row").filter({ hasText: name }).first().getByRole("button", { name: "OPEN / EDIT" }).click();
    await expect(page.getByText("SMART CLIENT REVIEW", { exact: true })).toBeVisible();

    // The header reports real case context.
    await expect(page.getByText("CASE", { exact: true })).toBeVisible();
    await expect(page.getByText("DOCUMENTS", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();

    // Provenance is never the workflow word "staged".
    const matrix = page.getByRole("table", { name: /validation matrix/i });
    await expect(matrix.getByText("staged", { exact: true })).toHaveCount(0);
    await expect(matrix.getByText("csv").first()).toBeVisible();

    // Approval is blocked, and the matrix says exactly why.
    await expect(page.getByRole("button", { name: "START REVIEW" })).toBeVisible();
    await page.getByLabel("REVIEWED BY").selectOption(String(admin.id));
    await page.getByRole("button", { name: "START REVIEW", exact: true }).click();
    await expect(page.getByText("Review started.", { exact: true })).toBeVisible();
    // Approval is withheld only by the database-backed confirmation requirement, not by
    // the optional fields this file is missing.
    await expect(page.getByText("APPROVAL IS BLOCKED")).toBeVisible();
    await expect(page.getByText(/document-status and information-match confirmations/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "APPROVE FILE" })).toBeDisabled();

    // Recording the two confirmations is enough: missing optional fields only warn.
    await page.getByText("CURRENT DOCUMENT STATUS REVIEWED", { exact: true }).click();
    await page.getByText("INFORMATION MATCH CONFIRMED", { exact: true }).click();
    await expect(page.getByText("APPROVAL IS BLOCKED")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "APPROVE FILE" })).toBeEnabled();
    await expect(page.getByText(/fields? can be completed later/).first()).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "APPROVE WITH WARNINGS" }).first()).toBeVisible();

    // A row is read-only until it is opened, then edits inline.
    const proficiencyRow = page.locator('tr[data-field="english_proficiency"]');
    await expect(proficiencyRow.getByText("GOOD", { exact: true })).toBeVisible();
    await expect(page.getByLabel("English Proficiency", { exact: true })).toHaveCount(0);

    // Escape abandons an unsaved edit.
    const dobRow = page.locator('tr[data-field="date_of_birth"]');
    await dobRow.getByRole("button", { name: /^Edit Date of Birth/ }).click();
    await page.getByLabel("Date of Birth", { exact: true }).fill("1990-03-14");
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Date of Birth", { exact: true })).toHaveCount(0);
    await expect(dobRow.locator('[data-label="Current value"]')).toHaveText("—");

    // Shift times edit through a native time control, so an out-of-range time cannot be
    // entered in the first place.
    const startRow = page.locator('tr[data-field="shift_start_time"]');
    await startRow.getByRole("button", { name: /^Edit Shift Start/ }).click();
    const startInput = page.getByLabel("Shift Start", { exact: true });
    await expect(startInput).toHaveAttribute("type", "time");
    await startInput.fill("18:00");
    await startInput.blur();
    await expect(startRow.locator('[data-label="Current value"]')).toHaveText("18:00");
    // Authority is server-recorded, so it still reads SOURCE until the review is saved.
    await expect(startRow.locator('[data-label="Authority"]')).toHaveText("SOURCE");

    // Shift days edit through canonical day chips.
    const daysRow = page.locator('tr[data-field="shift_days"]');
    await expect(daysRow.getByText("MON, TUE, WED, THU, FRI", { exact: true })).toBeVisible();
    await daysRow.getByRole("button", { name: /^Edit Shift Days/ }).click();
    await page.getByRole("button", { name: "SAT", exact: true }).click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(daysRow.getByText("MON, TUE, WED, THU, FRI, SAT", { exact: true })).toBeVisible();

    // A committed manual edit persists through the existing review-save flow with MANUAL
    // authority, and the original source evidence is still there.
    await page.getByRole("button", { name: "SAVE DRAFT" }).click();
    await expect(page.getByText("Review saved.", { exact: true })).toBeVisible();

    const [staged] = await db()`select mapped_draft,field_evidence from client_import_cases where mapped_draft #>> '{profile,full_name}'=${name} order by created_at desc limit 1`;
    expect(staged.mapped_draft.review_fields.shift_days).toEqual(["MON", "TUE", "WED", "THU", "FRI", "SAT"]);
    const dayEvidence = staged.field_evidence.filter((item: { field_key?: string }) => item.field_key === "shift_days");
    expect(dayEvidence[0]?.authority).toBe("SOURCE");
    expect(dayEvidence.at(-1)?.authority).toBe("MANUAL");
    expect(dayEvidence.at(-1)?.source_type).toBe("manual_review");
    await expect(daysRow.locator('[data-label="Authority"]')).toHaveText("MANUAL");
    await expect(daysRow.locator('[data-label="Provenance"]')).toHaveText("manual");
    await expect(daysRow.locator('[data-label="State"]')).toHaveText("MANUAL");
    await expect(startRow.locator('[data-label="Authority"]')).toHaveText("MANUAL");

    // The source said nothing about the shift start, so its only evidence is the manual
    // entry; no SOURCE entry is fabricated for a field the source never carried.
    const startEvidence = staged.field_evidence.filter((item: { field_key?: string }) => item.field_key === "shift_start_time");
    expect(startEvidence).toHaveLength(1);
    expect(startEvidence[0]?.authority).toBe("MANUAL");
    expect(staged.mapped_draft.review_fields.shift_start_time).toBe("18:00");

    // The original source reading for shift days is still first in the history.
    expect(dayEvidence[0]?.value).toBe("Weekdays");
  });

  test("stacks the validation matrix into labelled blocks on a phone", async ({ page, baseURL }) => {
    const token = Date.now().toString().slice(-7);
    const name = `TEST Review Mobile ${token}`;
    const phone = `586${token}`.slice(0, 10).padEnd(10, "5");

    await signIn(page.context(), baseURL!, "admin");
    await page.setViewportSize(DESKTOP);
    await page.goto("/staff/import");
    await page.locator('input[type="file"]').first().setInputFiles({ name: "review-mobile.csv", mimeType: "text/csv", buffer: Buffer.from(`full_name,phone\n${name},${phone}\n`) });
    await page.getByRole("button", { name: "PREVIEW" }).click();
    await page.getByRole("button", { name: /STAGE SELECTED/ }).click();
    await expect(page.getByText("1 import case staged.", { exact: true })).toBeVisible();

    const importQueue = page.getByRole("heading", { name: "IMPORT QUEUE" }).locator("xpath=ancestor::section[1]");
    await importQueue.getByRole("row").filter({ hasText: name }).first().getByRole("button", { name: "OPEN / EDIT" }).click();
    await expect(page.getByText("SMART CLIENT REVIEW", { exact: true })).toBeVisible();

    await page.setViewportSize(MOBILE);
    // Native table semantics survive the stacked layout.
    const matrix = page.getByRole("table", { name: /validation matrix/i });
    await expect(matrix.getByRole("rowheader", { name: /^Full Name/ })).toBeVisible();
    const columnHeadersHidden = await page.evaluate(() => {
      const head = document.querySelector(".cg-matrix thead");
      return head ? getComputedStyle(head).display === "none" : false;
    });
    expect(columnHeadersHidden).toBe(true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
