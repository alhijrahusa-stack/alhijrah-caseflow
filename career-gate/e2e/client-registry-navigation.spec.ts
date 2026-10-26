import { expect, test } from "@playwright/test";
import { dateTime } from "../lib/format";
import { db, intakeBody, RUN, signIn, submitIntake } from "./helpers";

for (const layout of [
  { name: "phone grid", width: 390, table: false },
  { name: "desktop grid", width: 1366, table: false },
  { name: "desktop table", width: 1366, table: true },
]) {
  test(`${layout.name}: client name opens the full file without a drawer or hydration error`, async ({ browser, baseURL, request }) => {
    const name = `TEST Registry Navigation ${layout.name} ${RUN}`;
    const intake = await submitIntake(request, intakeBody(name));
    expect(intake.res.status(), JSON.stringify(intake.json)).toBe(201);
    const [client] = await db()`select id from clients where ref=${intake.json.ref}`;
    const createdAt = "2026-10-26T02:30:00.000Z";
    await db()`update clients set created_at=${createdAt} where id=${client.id}`;

    const context = await browser.newContext({ baseURL, viewport: { width: layout.width, height: 900 }, timezoneId: "Pacific/Honolulu" });
    await signIn(context, baseURL!, "admin");
    const page = await context.newPage();
    const errors: string[] = [];
    const prefetches: string[] = [];
    const drawerRequests: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", incoming => {
      const url = new URL(incoming.url());
      if (url.pathname.startsWith("/staff/client/") && incoming.headers()["next-router-prefetch"]) prefetches.push(url.pathname);
      if (url.pathname === "/api/staff/client-resource") drawerRequests.push(url.pathname);
    });

    const registry = `/staff/clients?q=${encodeURIComponent(intake.json.ref)}`;
    await page.goto(registry);
    await page.getByRole("button", { name: layout.table ? "Table" : "Grid", exact: true }).click();
    const clientLink = page.getByRole("link", { name: layout.table ? `Open client ${name}` : name, exact: true });
    await expect(clientLink).toBeVisible();
    await expect(clientLink).toHaveAttribute("href", `/staff/client/${client.id}`);
    if (layout.table) await expect(page.locator("table")).toContainText(dateTime(createdAt));
    else await expect(page.locator("article time")).toHaveText(dateTime(createdAt));
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
    await expect(page).toHaveURL(new RegExp("/staff/clients\\?"));
    await page.getByRole("button", { name: "Close Client 360", exact: true }).click();
    await expect(page.getByRole("dialog", { name: /Client 360:/ })).toHaveCount(0);
    expect(errors.filter(message => /hydration|#418/i.test(message))).toEqual([]);
    await context.close();
  });
}
