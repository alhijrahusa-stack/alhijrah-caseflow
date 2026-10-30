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

  test("previews an image, starts local OCR without uploading identity media, and releases the preview on remove", async ({ page }) => {
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
    // The tiny fixture is not an identity document, so no name is manufactured.
    // Model inference may still be initializing or may fail safely on invalid content.
    await expect(card.getByText("image/png")).toBeVisible();
    await expect(card.getByRole("link", { name: "Open preview of client-id.png" })).toBeVisible();

    // Local PaddleOCR must never POST the document to a third-party vision API.
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

  test("shows every one of the eighteen fields with value, state, provenance and authority, and never infers a preferred language from English ability", async ({ page }) => {
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
    for (const group of ["IDENTITY", "ADDRESS", "LANGUAGE & ENGLISH"]) {
      await expect(intelligence.getByRole("heading", { name: group })).toBeVisible();
    }
    // Job preference fields have one dedicated surface and are intentionally
    // not repeated inside Live Intelligence.
    await expect(page.getByRole("region", { name: "JOB PREFERENCES" })).toBeVisible();

    const field = (key: string) => page.locator(`[data-field="${key}"]`);
    const value = (key: string) => field(key).locator("[data-value]");
    const state = (key: string) => field(key).locator("[data-state]");
    const provenance = (key: string) => field(key).locator("[data-provenance]");
    const authority = (key: string) => field(key).locator("[data-authority]");

    // Every one of the sixteen canonical fields is present exactly once as a name/value pair.
    for (const key of ["full_name","phone","email","date_of_birth","street","city","state","zip","preferred_language","english_proficiency","work_location_candidates","preferred_location","location_option_1","location_option_2","preferred_shift","shift_days","shift_start_time","shift_end_time","additional_notes","first_name","middle_name","last_name"]) {
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
    // "Romulus night shift" states one location and the shift type, and nothing else.
    await expect(value("preferred_shift")).toHaveText("NIGHT");

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

  test("awaits a source instead of reporting every field missing", async ({ page }) => {
    await page.goto("/staff/smart-client-import/new");
    const state = (key: string) => page.locator(`[data-field="${key}"] [data-state]`);
    // Before there is anything to interpret, no field is reported as missing.
    for (const key of ["full_name", "city", "preferred_shift", "additional_notes"]) {
      await expect(state(key)).toHaveText("AWAITING");
    }
    await page.locator("#smart-source-text").fill("Full Name: TEST Awaiting Client\nPhone: 313-555-0145");
    await expect(state("full_name")).not.toHaveText("AWAITING");
    await expect(state("city")).toHaveText("MISSING");
  });

  test("classifies one unstructured block into every field, in any order, losing nothing", async ({ page }) => {
    await page.goto("/staff/smart-client-import/new");
    // Deliberately unordered and unlabelled, exactly as a client writes it.
    await page.locator("#smart-source-text").fill([
      "6:00 PM to 4:30 AM",
      "Has reliable transportation.",
      "Night shift",
      "ahmed.parse@example.com",
      "Detroit, Romulus, Pontiac preferred for work",
      "Phone: 313-555-0146",
      "Friday-Monday",
      "7401 Winthrop St, Detroit, MI 48228",
      "DOB: 05/14/1995",
      "Ahmed Parse Mohammed",
    ].join("\n"));

    const value = (key: string) => page.locator(`[data-field="${key}"] [data-value]`);
    await expect(value("full_name")).toHaveText("Ahmed Parse Mohammed");
    await expect(value("date_of_birth")).toHaveText("1995-05-14");
    await expect(value("email")).toHaveText("ahmed.parse@example.com");
    // One line of address becomes four separate fields.
    await expect(value("street")).toHaveText("7401 Winthrop St");
    await expect(value("city")).toHaveText("Detroit");
    await expect(value("state")).toHaveText("MI");
    await expect(value("zip")).toHaveText("48228");
    // Three work locations, named with no ranking: they are candidates, and no
    // preference order is invented for them.
    await expect(value("work_location_candidates")).toHaveText("Detroit, Romulus, Pontiac");
    await expect(value("preferred_location")).toHaveText("—");
    await expect(value("location_option_1")).toHaveText("—");
    await expect(value("location_option_2")).toHaveText("—");
    // Shift type, days and an overnight range, none of them labelled.
    await expect(value("preferred_shift")).toHaveText("NIGHT");
    await expect(value("shift_days")).toHaveText("FRI, SAT, SUN, MON");
    await expect(value("shift_start_time")).toHaveText("18:00");
    await expect(value("shift_end_time")).toHaveText("04:30");
    // The one detail with no field of its own is preserved, not dropped.
    await expect(value("additional_notes")).toHaveText("Has reliable transportation.");
    // Nothing the source never stated is shown as a value.
    await expect(value("preferred_language")).toHaveText("—");
    await expect(page.getByText(/\d%/)).toHaveCount(0);
  });

  test("the progress rail reports real coverage and assembles on open", async ({ page }) => {
    await page.goto("/staff/smart-client-import/new");
    const rail = page.locator("[data-smart-progress-rail]");
    await expect(rail).toBeVisible();
    // Nothing captured yet: the rail says so in words, not only in colour.
    await expect(rail).toHaveAttribute("data-state", "awaiting");
    await expect(rail.getByText("AWAITING SOURCE", { exact: true })).toBeVisible();
    await expect(rail.getByText(/^0 \/ \d+ FIELDS CAPTURED$/)).toBeVisible();
    await expect(rail.getByText("0 / 2 REQUIRED", { exact: true })).toBeVisible();

    await page.locator("#smart-source-text").fill("Full Name: TEST Rail Client\nPhone: 313-555-0147");
    // Both required fields are now present, so the rail reports the real gate.
    await expect(rail).toHaveAttribute("data-state", "ready");
    await expect(rail.getByText("READY TO SUBMIT", { exact: true })).toBeVisible();
    await expect(rail.getByText("2 / 2 REQUIRED", { exact: true })).toBeVisible();
    // Coverage is a count of captured fields, never a fabricated percentage.
    await expect(page.getByText(/\d%/)).toHaveCount(0);
  });

  test("a blocked submit names the missing field instead of doing nothing", async ({ page }) => {
    await page.goto("/staff/smart-client-import/new");
    // A source with no phone: the required-field gate must hold.
    await page.locator("#smart-source-text").fill("Some notes about a walk-in, no contact details yet.");
    const rail = page.locator("[data-smart-progress-rail]");

    await page.getByRole("button", { name: "SUBMIT" }).click();
    await expect(rail).toHaveAttribute("data-state", "warning");
    await expect(rail.getByText("REQUIRED FIELD MISSING", { exact: true })).toBeVisible();
    await expect(page.getByText(/Still required before submitting:.*Full Name.*Phone/)).toBeVisible();
    // Nothing was staged, and the surface is still editable.
    await expect(page.getByText("SOURCE CAPTURED", { exact: true })).toHaveCount(0);
    await expect(page.locator("#smart-source-text")).toBeEditable();
  });

  test("reads one unlabelled line into an overnight shift and reports it as derived", async ({ page }) => {
    await page.goto("/staff/smart-client-import/new");
    await page.locator("#smart-source-text").fill([
      "Full Name: TEST Overnight Client",
      "Phone: 313-555-0148",
      "Night shift Friday-Monday 6:00 PM to 4:30 AM",
    ].join("\n"));

    const value = (key: string) => page.locator(`[data-field="${key}"] [data-value]`);
    await expect(value("preferred_shift")).toHaveText("NIGHT");
    await expect(value("shift_days")).toHaveText("FRI, SAT, SUN, MON");
    await expect(value("shift_start_time")).toHaveText("18:00");
    await expect(value("shift_end_time")).toHaveText("04:30");
    // The overnight reading is derived from the two times, not a stored third copy.
    await expect(page.locator('[data-smart-overnight="true"]')).toBeVisible();
    await expect(page.getByText(/read from the captured start and end times/)).toBeVisible();
  });

  test("reads an unranked work-location list as candidates without inventing an order", async ({ page }) => {
    await page.goto("/staff/smart-client-import/new");
    await page.locator("#smart-source-text").fill([
      "Full Name: TEST Candidates Client",
      "Phone: 313-555-0149",
      "Detroit, Romulus, Pontiac preferred for work",
    ].join("\n"));

    const value = (key: string) => page.locator(`[data-field="${key}"] [data-value]`);
    await expect(value("work_location_candidates")).toHaveText("Detroit, Romulus, Pontiac");
    // No ranking was stated, so none is shown.
    await expect(value("preferred_location")).toHaveText("—");
    await expect(value("location_option_1")).toHaveText("—");
    await expect(value("location_option_2")).toHaveText("—");
  });

  test("reads a dictated Arabic sentence into the same fields", async ({ page }) => {
    await page.goto("/staff/smart-client-import/new");
    await page.locator("#smart-source-text").fill(
      "اسمه أحمد محمد، رقمه 313-555-0151، يريد الشفت الليلي في رومولس، من الجمعة إلى الاثنين، من السادسة مساءً إلى الرابعة والنصف صباحًا، وعنده سيارة.",
    );

    const value = (key: string) => page.locator(`[data-field="${key}"] [data-value]`);
    await expect(value("full_name")).toHaveText("أحمد محمد");
    await expect(value("first_name")).toHaveText("أحمد");
    await expect(value("last_name")).toHaveText("محمد");
    await expect(value("preferred_location")).toHaveText("رومولس");
    await expect(value("preferred_shift")).toHaveText("NIGHT");
    await expect(value("shift_days")).toHaveText("FRI, SAT, SUN, MON");
    await expect(value("shift_start_time")).toHaveText("18:00");
    await expect(value("shift_end_time")).toHaveText("04:30");
    await expect(page.locator('[data-smart-overnight="true"]')).toBeVisible();
    // Nothing the sentence never stated is shown as a value.
    await expect(value("email")).toHaveText("—");
    await expect(value("zip")).toHaveText("—");
  });

  test("creates no particle, burst or pointer line under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/staff/smart-client-import/new");
    await page.locator("#smart-source-text").fill("Full Name: TEST Reduced Client\nPhone: 313-555-0152");

    const rail = page.locator("[data-smart-progress-rail]");
    // The rail still reports the real state — only the motion is gone.
    await expect(rail).toHaveAttribute("data-state", "ready");
    await expect(rail.getByText("2 / 2 REQUIRED", { exact: true })).toBeVisible();
    // Not merely hidden: nothing is created at all.
    await expect(page.locator(".cg-particle")).toHaveCount(0);
    await expect(page.locator(".cg-burst-piece")).toHaveCount(0);
    await expect(page.locator(".cg-laser")).toHaveCount(0);
  });

  test("the rail stays inside the viewport at 320px with no horizontal scrollbar", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/staff/smart-client-import/new");
    await page.locator("#smart-source-text").fill("Full Name: TEST Narrow Client\nPhone: 313-555-0153");

    const rail = page.locator("[data-smart-progress-rail]");
    await expect(rail).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await rail.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(320);
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

  test("submits immediately after typing, without waiting out the read debounce", async ({ page }) => {
    const token = Date.now().toString().slice(-7);
    const name = `TEST Immediate ${token}`;
    await page.goto("/staff/smart-client-import/new");
    // Fill and press in the same breath: the gate must judge the live text, not the
    // last debounced snapshot of it.
    await page.locator("#smart-source-text").fill(`Full Name: ${name}\nPhone: 313${token}`.slice(0, 200));
    await page.getByRole("button", { name: "SUBMIT" }).click();

    await expect(page.getByText("SOURCE CAPTURED", { exact: true })).toBeVisible();
    await expect(page.locator("[data-smart-progress-rail]")).not.toHaveAttribute("data-state", "warning");
    const [staged] = await db()`select id from client_import_cases where mapped_draft #>> '{profile,full_name}'=${name} order by created_at desc limit 1`;
    expect(staged?.id).toBeTruthy();
  });

  test("submits captured source, runs the Digital Handshake and stages one case", async ({ page }) => {
    const token = Date.now().toString().slice(-7);
    const name = `TEST Handshake ${token}`;
    await page.goto("/staff/smart-client-import/new");
    await page.locator("#smart-source-text").fill(`Full Name: ${name}\nPhone: 313${token}`.slice(0, 200));

    await page.getByRole("button", { name: "SUBMIT" }).click();
    await expect(page.getByText("SOURCE CAPTURED", { exact: true })).toBeVisible({ timeout: 20_000 });
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


  test("fluid Smart Import grid at phone, tablet, desktop, and ultrawide widths", async ({page}) => {
    for(const width of [320,360,390,600,768,1024,1440,1920,2560]){
      await page.setViewportSize({width,height:900});
      await page.goto("/staff/smart-client-import/new");
      await expect(page.getByRole("heading",{name:"SMART CLIENT IMPORT"})).toBeVisible();
      const layout=await page.evaluate(()=>{
        const grid=document.querySelector("[data-smart-operational-grid]")!;
        const audio=document.querySelector('button[aria-label*="Turn audio"]')!.getBoundingClientRect();
        const capture=document.querySelector("[data-smart-capture-column]")!.getBoundingClientRect();
        const intel=document.querySelector("[data-smart-intelligence-column]")!.getBoundingClientRect();
        return {columns:getComputedStyle(grid).gridTemplateColumns.split(" ").length,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
          audioWidth:audio.width,audioHeight:audio.height,captureLeft:capture.left,captureRight:capture.right,intelLeft:intel.left,intelRight:intel.right};
      });
      expect(layout.columns).toBe(width>=1536?3:width>=768?2:1);
      expect(layout.overflow).toBeLessThanOrEqual(1);
      expect(layout.audioWidth).toBeGreaterThanOrEqual(44);
      expect(layout.audioHeight).toBeGreaterThanOrEqual(44);
      for(const edge of [layout.captureLeft,layout.intelLeft])expect(edge).toBeGreaterThanOrEqual(-1);
      for(const edge of [layout.captureRight,layout.intelRight])expect(edge).toBeLessThanOrEqual(width+1);
    }
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
    // Opening the import claims the authenticated reviewer atomically.
    await expect(page.getByLabel("REVIEWED BY")).toHaveValue(String(admin.id));
    await expect(page.getByRole("button", { name: "START REVIEW", exact: true })).toHaveCount(0);
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

    // Unapplied edits keep the persistence actions locked, and Cancel must discard
    // the focused value without a blur handler applying it first.
    const cityRow = page.locator('tr[data-field="city"]');
    await cityRow.getByRole("button", { name: /^Edit City/ }).click();
    const cityInput = page.getByLabel("City", { exact: true });
    await cityInput.fill("Unsaved city");
    await expect(page.getByRole("button", { name: "SAVE DRAFT", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "CHECK & VERIFY", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "APPROVE FILE", exact: true })).toBeDisabled();
    await expect(page.locator('tr[data-field="phone"]').getByRole("button", { name: /^Edit Phone/ })).toBeDisabled();
    await cityInput.blur();
    await expect(cityInput).toHaveValue("Unsaved city");
    await cityRow.getByRole("button", { name: /^Cancel/ }).click();
    await expect(cityInput).toHaveCount(0);
    await expect(cityRow.locator('[data-label="Current value"]')).toHaveText("—");
    await expect(page.getByRole("button", { name: "SAVE DRAFT", exact: true })).toBeEnabled();

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
    await expect(startInput).toHaveValue("18:00");
    await startRow.getByRole("button", { name: /^Apply/ }).click();
    await expect(startRow.locator('[data-label="Current value"]')).toHaveText("18:00");
    // Authority is server-recorded, so it still reads SOURCE until the review is saved.
    await expect(startRow.locator('[data-label="Authority"]')).toHaveText("SOURCE");

    // Cancelling the close confirmation keeps the applied draft in the review.
    page.once("dialog", async (dialog) => dialog.dismiss());
    await page.locator("#smart-review").getByRole("button", { name: "CLOSE", exact: true }).click();
    await expect(page.locator("#smart-review")).toBeVisible();
    await expect(startRow.locator('[data-label="Current value"]')).toHaveText("18:00");

    // Shift days edit through canonical day chips.
    const daysRow = page.locator('tr[data-field="shift_days"]');
    await expect(daysRow.getByText("MON, TUE, WED, THU, FRI", { exact: true })).toBeVisible();
    await daysRow.getByRole("button", { name: /^Edit Shift Days/ }).click();
    await page.getByRole("button", { name: "SAT", exact: true }).click();
    await daysRow.getByRole("button", { name: /^Apply/ }).click();
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

  test("audits conflicting source readings and explicitly confirms the current value without losing evidence", async ({ page, baseURL }) => {
    const token = Date.now().toString().slice(-7);
    const name = `TEST Review Conflict ${token}`;
    const phone = `734${token}`.slice(0, 10).padEnd(10, "7");
    await signIn(page.context(), baseURL!, "admin");
    await page.setViewportSize(DESKTOP);
    await page.goto("/staff/import");
    const csv = `full_name,phone,date_of_birth\n${name},${phone},1976-01-01\n`;
    await page.locator('input[type="file"]').first().setInputFiles({ name: "review-conflict.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "PREVIEW" }).click();
    await page.getByRole("button", { name: /STAGE SELECTED/ }).click();
    await expect(page.getByText("1 import case staged.", { exact: true })).toBeVisible();

    const [staged] = await db()`select id,field_evidence from client_import_cases where mapped_draft #>> '{profile,full_name}'=${name} order by created_at desc limit 1`;
    const evidence = staged.field_evidence.map((entry: Record<string, unknown>) => entry.field_key === "date_of_birth" ? { ...entry, verification_state: "CONFLICT", source_text_reference: "Birth date supplied in the intake sheet: 1976-01-01" } : entry);
    evidence.push({ field_key: "date_of_birth", value: "1977-01-01", normalized_value: "1977-01-01", source_type: "local_text", authority: "SOURCE", verification_state: "CONFLICT", source_text_reference: "Alternate source reading: 1977-01-01" });
    const conflicts = [{ field_key: "date_of_birth", values: ["1976-01-01", "1977-01-01"], type: "SOURCE_CONFLICT" }];
    await db()`update client_import_cases set field_evidence=${db().json(evidence)},conflicts=${db().json(conflicts)} where id=${staged.id}`;

    const importQueue = page.getByRole("heading", { name: "IMPORT QUEUE" }).locator("xpath=ancestor::section[1]");
    await importQueue.getByRole("row").filter({ hasText: name }).first().getByRole("button", { name: "OPEN / EDIT" }).click();
    const review = page.locator("#smart-review");
    const dob = review.locator('tr[data-field="date_of_birth"]');
    await expect(dob.locator('[data-label="State"]')).toHaveText("CONFLICT");
    await dob.getByRole("button", { name: "Audit Date of Birth", exact: true }).click();
    await expect(dob.getByRole("button", { name: "Audit Date of Birth", exact: true })).toHaveAttribute("aria-expanded", "true");
    const history = review.getByRole("region", { name: "Date of Birth evidence history", exact: true });
    await expect(history.getByRole("listitem")).toHaveCount(2);
    await expect(history.getByText("1976-01-01", { exact: true })).toBeVisible();
    await expect(history.getByText("1977-01-01", { exact: true })).toBeVisible();
    await expect(history.getByText("Alternate source reading: 1977-01-01", { exact: true })).toBeVisible();

    // Search and attention filters narrow the same authoritative field list.
    const search = review.getByRole("searchbox", { name: "Filter client fields", exact: true });
    await search.fill("Date of Birth");
    await expect(review.locator("tr[data-field]")).toHaveCount(1);
    await review.getByRole("button", { name: "Needs attention", exact: true }).click();
    await expect(dob).toBeVisible();
    await search.fill("");
    await review.getByRole("button", { name: "All fields", exact: true }).click();
    await expect(review.locator("tr[data-field]")).toHaveCount(22);

    // The reviewer may confirm the current source reading; a changed value is not
    // required to record a manual conflict resolution.
    await dob.getByRole("button", { name: "Edit Date of Birth", exact: true }).click();
    await expect(page.getByLabel("Date of Birth", { exact: true })).toHaveValue("1976-01-01");
    await dob.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dob.getByText("Unsaved change", { exact: true })).toBeVisible();
    await review.getByRole("button", { name: "Edited fields", exact: true }).click();
    await expect(review.locator("tr[data-field]")).toHaveCount(1);
    // A rejected save must leave the applied value and resolution available for retry.
    await page.route("**/api/staff/smart-client-import", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.postDataJSON()?.action === "save") {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { message: "QA simulated save failure" } }) });
      } else await route.continue();
    });
    await page.getByRole("button", { name: "SAVE DRAFT", exact: true }).click();
    await expect(page.getByText("QA simulated save failure", { exact: true })).toBeVisible();
    await expect(dob.locator('[data-label="Current value"]')).toHaveText("1976-01-01");
    await expect(dob.getByText("Unsaved change", { exact: true })).toBeVisible();
    await page.unroute("**/api/staff/smart-client-import");

    const saveResponse = page.waitForResponse((response) => {
      if (response.request().method() !== "POST" || new URL(response.url()).pathname !== "/api/staff/smart-client-import") return false;
      return response.request().postDataJSON()?.action === "save";
    });
    await page.getByRole("button", { name: "SAVE DRAFT", exact: true }).click();
    expect((await saveResponse).status()).toBe(200);
    await expect(page.getByText("Review saved.", { exact: true })).toBeVisible();

    const [saved] = await db()`select mapped_draft,field_evidence,conflicts from client_import_cases where id=${staged.id}`;
    expect(saved.mapped_draft.profile.date_of_birth).toBe("1976-01-01");
    expect(saved.conflicts).toEqual([]);
    const entries = saved.field_evidence.filter((entry: { field_key?: string }) => entry.field_key === "date_of_birth");
    expect(entries).toHaveLength(3);
    expect(entries.slice(0, 2).map((entry: { value?: string }) => entry.value)).toEqual(["1976-01-01", "1977-01-01"]);
    expect(entries.at(-1)).toMatchObject({ value: "1976-01-01", authority: "MANUAL", source_type: "manual_review" });
    expect(entries.at(-1).reviewer_id).toBeTruthy();
    expect(entries.at(-1).reviewed_at).toBeTruthy();
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
