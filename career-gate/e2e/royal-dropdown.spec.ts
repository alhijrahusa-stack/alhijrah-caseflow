import { expect, test } from "@playwright/test";
import { db, selectChoice, signIn, STAFF } from "./helpers";

for (const width of [390, 1366]) {
  test(`staff dropdowns stay dark and support keyboard selection at ${width}px`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page.context(), baseURL!, "admin");
    await page.goto("/staff/new-client");
    const status = page.getByRole("combobox", { name: "Initial status", exact: true });
    await expect(status).toHaveAttribute("data-value", "new_intake");
    await status.focus();
    await status.press("ArrowDown");
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    const popup = page.locator(".royal-select-popup");
    const background = await popup.evaluate(element => getComputedStyle(element).backgroundColor);
    expect(background).toMatch(/rgba?\(16, 31, 66/);
    const bounds = await popup.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await status.press("End");
    await status.press("Enter");
    await expect(status).toHaveAttribute("data-value", "ready_to_apply");
    await expect(list).toHaveCount(0);
    await expect(status).toBeFocused();
    await expect(page.getByLabel("Next step", { exact: true })).not.toHaveValue("");
    await selectChoice(status, "new_intake");
    await expect(status).toHaveAttribute("data-value", "new_intake");
    await status.click();
    await status.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(status).toBeFocused();
    // Every staff native picker is replaced; no browser/mobile white select UI.
    await expect(page.locator("select")).toHaveCount(0);
  });
}

test("label-based selection remains unambiguous and preserves a server form's value", async ({ page, baseURL }) => {
  await signIn(page.context(), baseURL!, "admin");
  await page.goto("/staff/tasks");
  const assignee = page.getByLabel("Assigned to");
  const [employee] = await db()`select id from staff where auth_user_id=${STAFF.staff}`;
  const selectedId = String(employee.id);
  await selectChoice(assignee, selectedId);
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/staff/tasks\\?view=open&assignee=${selectedId}$`));
  await expect(page.getByRole("combobox", { name: "Assigned to", exact: true })).toHaveAttribute("data-value", selectedId);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Assigned to", exact: true })).toHaveAttribute("data-value", selectedId);
});

test("dark popup follows Arabic direction while option values remain unchanged", async ({ page, baseURL }) => {
  await signIn(page.context(), baseURL!, "admin");
  await page.goto("/staff/new-client");
  await page.getByTestId("staff-language-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const status = page.getByRole("combobox", { name: "الحالة الأولية", exact: true });
  await status.click();
  await expect(page.locator(".royal-select-popup")).toHaveAttribute("dir", "rtl");
  await status.press("Escape");
  await expect(status).toHaveAttribute("data-value", "new_intake");
});
