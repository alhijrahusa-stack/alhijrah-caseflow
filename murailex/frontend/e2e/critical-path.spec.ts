import { expect, test } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SAMPLE = path.resolve(__dirname, "../../backend/tests/fixtures/sample.wav");

test("unauthenticated users are sent to sign-in", async ({ page }) => {
  await page.goto("/transcriptions");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator("html")).toHaveAttribute("dir", /rtl|ltr/);
});

test("critical path: sign in → upload → process → review → lock → export", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /English|العربية/ }).click();
  await page.locator('input[name="email"]').fill("admin@example.com");
  await page.locator('input[name="password"]').fill("wrong password here");
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.locator('input[name="password"]').fill("e2e admin password 123");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await expect(page.getByTestId("file-input")).toBeAttached();

  // Arabic RTL toggle
  await page.goto("/settings");
  await page.getByRole("button", { name: "العربية" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("provider-row").first()).toBeAttached();
  await page.goto("/");

  // A recording locale is mandatory before evidence bytes can enter the pipeline.
  await page.locator("#language-locale").selectOption("ar-YE");

  // Upload real audio bytes through the resumable uploader
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await page.waitForURL(/\/transcriptions\/[0-9a-f-]+$/, { timeout: 60_000 });
  const sha = crypto.createHash("sha256").update(fs.readFileSync(SAMPLE)).digest("hex");
  await expect(page.locator(`button[title="${sha}"]`)).toBeVisible();

  // Durable background processing reaches review. Summary is the default results view;
  // switch to the full transcript before transcript-specific assertions.
  await expect(page.locator('[data-status="needs_review"]')).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "النص الكامل" }).click();
  await expect(page.getByTestId("segment").first()).toBeVisible();
  await expect(page.getByTestId("transcript")).toContainText("والله");
  await expect(page.getByTestId("transcript")).toContainText("okay");
  await expect(page.getByTestId("transcript")).toContainText("[صمت]");
  await expect(page.getByTestId("speaker-label").first()).toContainText("المتحدث");

  // Mobile/desktop: no horizontal overflow
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // Review: replay exact source audio, then resolve every region
  await page.getByTestId("dispute-chip").first().click();
  await page.waitForURL(/\/review\//);
  const cards = page.getByTestId("dispute-card");
  await expect(cards.first()).toBeVisible();
  await cards.first().getByTestId("play-exact").click();
  await expect.poll(async () => (await page.getByTestId("clock").textContent()) ?? "", { timeout: 10_000 }).not.toMatch(/^0:00\.000/);
  let remaining = await cards.count();
  expect(remaining).toBeGreaterThanOrEqual(2);
  await cards.first().getByTestId("accept-candidate").first().click();
  await expect(cards).toHaveCount(remaining - 1);
  remaining -= 1;
  while (remaining > 0) {
    await cards.first().getByTestId("mark-inaudible").click();
    await expect(cards).toHaveCount(remaining - 1);
    remaining -= 1;
  }
  await expect(page.getByTestId("open-count")).toContainText("0");

  // Lock
  await page.goBack();
  await page.reload();
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("lock").click();
  await expect(page.locator('[data-status="locked"]')).toBeVisible();
  await page.getByRole("button", { name: "النص الكامل" }).click();
  await expect(page.getByTestId("transcript")).toContainText("[غير مسموع]");

  // Exports
  for (const fmt of ["txt", "pdf", "docx", "json", "zip"]) {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId(`export-${fmt}`).click()]);
    const file = await dl.path();
    const buf = fs.readFileSync(file!);
    expect(buf.length).toBeGreaterThan(100);
    if (fmt === "txt") {
      const txt = buf.toString("utf8");
      expect(txt).toContain("MURAILEX FORENSIC VERBATIM TRANSCRIPT");
      expect(txt).toContain("The original audio recording is the controlling source.");
      expect(txt).toContain(sha);
      expect(txt).not.toContain("Certified Transcript");
    }
    if (fmt === "pdf") expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    if (fmt === "zip" || fmt === "docx") expect(buf.subarray(0, 2).toString()).toBe("PK");
  }
  await expect(page.getByTestId("export-result")).toContainText("SHA-256");
});
