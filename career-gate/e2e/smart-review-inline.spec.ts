import { expect, test } from "@playwright/test";
import { chooseImportSpreadsheet, db, signIn } from "./helpers";

/**
 * Smart Client Review without per-field dialogs: a conflicting field offers its recorded
 * source readings as one-tap suggestions, edits open in place, and the source viewer is
 * docked beside the data on wide screens and a drawer on narrower ones.
 */

async function conflictCase(page: import("@playwright/test").Page, baseURL: string, label: string) {
  const token = `${Date.now()}`.slice(-7);
  const name = `TEST Inline ${label} ${token}`;
  const phone = `735${token}`.slice(0, 10).padEnd(10, "5");
  await signIn(page.context(), baseURL, "admin");
  await page.goto("/staff/import");
  await chooseImportSpreadsheet(page, { name: `inline-${label}.csv`, mimeType: "text/csv", buffer: Buffer.from(`full_name,phone,date_of_birth\n${name},${phone},1976-01-01\n`) });
  await page.getByRole("button", { name: "PREVIEW" }).click();
  await page.getByRole("button", { name: /STAGE SELECTED/ }).click();
  await expect(page.getByText("1 import case staged.", { exact: true })).toBeVisible();
  const [staged] = await db()`select id,field_evidence from client_import_cases where mapped_draft #>> '{profile,full_name}'=${name} order by created_at desc limit 1`;
  const evidence = staged.field_evidence.map((entry: Record<string, unknown>) => entry.field_key === "date_of_birth" ? { ...entry, verification_state: "CONFLICT" } : entry);
  evidence.push({ field_key: "date_of_birth", value: "1977-01-01", normalized_value: "1977-01-01", source_type: "local_text", authority: "SOURCE", verification_state: "CONFLICT" });
  await db()`update client_import_cases set field_evidence=${db().json(evidence)},conflicts=${db().json([{ field_key: "date_of_birth", values: ["1976-01-01", "1977-01-01"], type: "SOURCE_CONFLICT" }])} where id=${staged.id}`;
  const queue = page.getByRole("heading", { name: "IMPORT QUEUE" }).locator("xpath=ancestor::section[1]");
  await queue.getByRole("row").filter({ hasText: name }).first().getByRole("button", { name: "OPEN / EDIT" }).click();
  return page.locator("#smart-review");
}

test("a conflicting field is resolved with one tap on its recorded source reading, without a dialog", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const review = await conflictCase(page, baseURL!, "Tap");
  await expect(page.locator(".cg-source-dock #smart-document-viewer")).toBeVisible();
  const dob = review.locator('tr[data-field="date_of_birth"]');
  await expect(dob.locator('[data-label="State"]')).toHaveText("CONFLICT");
  const suggestion = dob.getByRole("group", { name: "Date of Birth suggestions" }).getByRole("button", { name: /1977-01-01/ });
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(dob.locator('[data-label="Current value"] > span').first()).toHaveText("1977-01-01");
  await expect(dob.getByText("Unsaved change", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // A typed edit opens in place under its row.
  const city = review.locator('tr[data-field="city"]');
  await city.getByRole("button", { name: "Edit City", exact: true }).click();
  await expect(page.getByRole("region", { name: "City · Review" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("City", { exact: true }).fill("Dearborn");
  await page.locator(".cg-inline-review").getByRole("button", { name: "Apply", exact: true }).click();
  await expect(city.locator('[data-label="Current value"] > span').first()).toHaveText("Dearborn");
});

test("below the docking width the source documents open in a drawer", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await conflictCase(page, baseURL!, "Drawer");
  await expect(page.locator(".cg-source-dock")).toHaveCount(0);
  await page.getByRole("button", { name: /Open documents/ }).click();
  await expect(page.locator("#smart-document-viewer")).toBeVisible();
  await page.getByRole("button", { name: "Close Source documents", exact: true }).click();
  await expect(page.locator("#smart-document-viewer")).toHaveCount(0);
});
