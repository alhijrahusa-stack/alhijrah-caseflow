import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

function seconds(value: string) {
  const first = value.split(",")[0]?.trim() ?? "";
  if (first.endsWith("ms")) return Number.parseFloat(first) / 1000;
  if (first.endsWith("s")) return Number.parseFloat(first);
  return Number.POSITIVE_INFINITY;
}

test.describe("restored premium staff experience", () => {
  test("restores navigation identity, fast route motion and staff assistant shell", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    await signIn(context, baseURL!, "admin");
    const page = await context.newPage();
    await page.goto("/staff");

    await expect(page.getByRole("button", { name: "AI" })).toBeVisible();
    await expect(page.locator('.staff-nav-link[data-tone="gold"]', { hasText: "Pipeline" })).toBeVisible();
    await expect(page.locator('.staff-nav-link[data-tone="cyan"]', { hasText: "Staff" })).toBeVisible();
    await expect(page.locator('.staff-nav-link[data-tone="green"]', { hasText: "New Client" })).toBeVisible();

    const stage = page.locator(".cg-route-stage").first();
    await expect(stage).toBeVisible();
    const duration = await stage.evaluate((el) => getComputedStyle(el).animationDuration);
    expect(seconds(duration)).toBeLessThanOrEqual(0.2);

    await page.getByRole("button", { name: "AI" }).click();
    await expect(page.getByRole("heading", { name: "Staff Assistant" })).toBeVisible();
    await expect(page.getByText("Grounded guidance. No record changes.")).toBeVisible();
    await context.close();
  });

  test("new client keeps autosave and adds live readiness plus safe document intake", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
    await signIn(context, baseURL!, "admin");
    const page = await context.newPage();
    await page.goto("/staff/new-client");

    await expect(page.getByText("Adaptive Intake Intelligence")).toBeVisible();
    await expect(page.getByText("Readiness & next best action")).toBeVisible();
    await expect(page.getByText("Drop documents or click to browse")).toBeVisible();
    await expect(page.getByText("Large images are compressed locally before upload. PDFs are never recompressed.")).toBeVisible();

    await page.locator("#full_name").fill("Test Client");
    await page.locator("#phone").fill("3135550182");
    await expect(page.getByText(/Temporary browser draft saved|Temporary browser draft restored/)).toBeVisible({ timeout: 3000 });

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({ name: "test-id.png", mimeType: "image/png", buffer: Buffer.from("small-safe-test-file") });
    await expect(page.getByText("test-id.png")).toBeVisible();
    await expect(page.getByText("Ready for secure upload")).toBeVisible();
    await expect(page.getByRole("button", { name: "Spatial preview" })).toBeVisible();

    await context.close();
  });
});
