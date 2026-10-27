import { expect, test } from "@playwright/test";
import { dateOnly, dateTime } from "../lib/format";
import { db, intakeBody, RUN, signIn, staffAction, submitIntake } from "./helpers";

for (const layout of [
  { name: "phone grid", width: 390, table: false, completed: false },
  { name: "desktop grid", width: 1366, table: false, completed: false },
  { name: "desktop table", width: 1366, table: true, completed: false },
  { name: "completed phone", width: 390, table: false, completed: true },
  { name: "completed desktop", width: 1366, table: false, completed: true },
]) {
  test(`${layout.name}: client name opens the full file without a drawer or hydration error`, async ({ browser, baseURL, request }) => {
    const name = `TEST Registry Navigation ${layout.name} ${RUN}`;
    const intake = await submitIntake(request, intakeBody(name));
    expect(intake.res.status(), JSON.stringify(intake.json)).toBe(201);
    const [client] = await db()`select id from clients where ref=${intake.json.ref}`;
    const createdAt = "2026-10-26T02:30:00.000Z";
    await db()`update clients set created_at=${createdAt} where id=${client.id}`;
    if (layout.completed) {
      const completed = await staffAction(request, "admin", { action: "override_status", client_id: client.id, status: "completed", reason: "e2e completed registry navigation" });
      expect(completed.status, JSON.stringify(completed.json)).toBe(200);
    }

    const context = await browser.newContext({ baseURL, viewport: { width: layout.width, height: 900 }, timezoneId: "Pacific/Honolulu" });
    await signIn(context, baseURL!, "admin");
    const page = await context.newPage();
    const errors: string[] = [];
    const prefetches: string[] = [];
    const drawerRequests: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error" && /hydrat|#418/i.test(message.text())) errors.push(message.text());
    });
    page.on("request", incoming => {
      const url = new URL(incoming.url());
      if (url.pathname.startsWith("/staff/client/") && incoming.headers()["next-router-prefetch"]) prefetches.push(url.pathname);
      if (url.pathname === "/api/staff/client-resource") drawerRequests.push(url.pathname);
    });

    const registry = `/staff/clients?q=${encodeURIComponent(intake.json.ref)}${layout.completed ? "&view=completed" : ""}`;
    await page.goto(registry);
    if (!layout.completed) await page.getByRole("button", { name: layout.table ? "Table" : "Grid", exact: true }).click();
    const clientLink = page.getByRole("link", { name: layout.table ? `Open client ${name}` : name, exact: true });
    await expect(clientLink).toBeVisible();
    await expect(clientLink).toHaveAttribute("href", `/staff/client/${client.id}`);
    if (layout.table) await expect(page.locator("table")).toContainText(dateTime(createdAt));
    else {
      await expect(page.locator("article time")).toHaveText(layout.completed ? dateOnly("2026-10-25") : dateTime(createdAt));
      await expect(page.locator("article time")).toHaveAttribute("datetime", createdAt);
    }
    expect(errors).toEqual([]);
    expect(prefetches).toEqual([]);
    expect(drawerRequests).toEqual([]);

    await clientLink.click();
    await expect(page).toHaveURL(new RegExp(`/staff/client/${client.id}$`));
    await expect(page.getByTestId("client-ref")).toHaveText(intake.json.ref);
    await expect(page.getByRole("dialog", { name: /Client 360:/ })).toHaveCount(0);
    expect(drawerRequests).toEqual([]);

    await page.goto(registry);
    await page.getByRole("link", { name: "Open Client ↗", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/staff/client/${client.id}$`));
    await expect(page.getByTestId("client-ref")).toHaveText(intake.json.ref);
    expect(drawerRequests).toEqual([]);

    await page.goto(registry);
    await page.getByRole("button", { name: "Quick view · Client 360", exact: true }).click();
    await expect(page.getByRole("dialog", { name: `Client 360: ${name}`, exact: true })).toBeVisible();
    const panel = page.getByTestId("client360-panel");
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((node) => node.parentElement?.parentElement === document.body)).toBe(true);
    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(layout.width + 1);
    await expect(panel.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    await panel.getByRole("tab", { name: "Documents" }).click();
    await expect(panel.getByRole("heading", { name: /Documents & G2 OCR evidence/ })).toBeVisible();
    await panel.getByRole("tab", { name: "Activity" }).click();
    await expect(panel.getByRole("heading", { name: /Audit trail/ })).toBeVisible();
    await expect(panel.getByTestId("client360-scroll-area")).toBeVisible();
    await expect(page).toHaveURL(new RegExp("/staff/clients\\?"));
    await page.getByRole("button", { name: "Close Client 360", exact: true }).click();
    await expect(page.getByRole("dialog", { name: /Client 360:/ })).toHaveCount(0);
    expect(errors.filter(message => /hydration|#418/i.test(message))).toEqual([]);
    await context.close();
  });
}
