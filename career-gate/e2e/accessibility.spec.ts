import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { db, signIn } from "./helpers";

/**
 * WCAG 2.1 A/AA scan (axe-core) of every staff route and of the Client 360
 * states a person reaches by clicking: each tab and the command palette.
 * Serious and critical findings fail the run.
 */

const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const ROUTES = [
  "/staff", "/staff/today", "/staff/week", "/staff/clients", "/staff/pipeline", "/staff/accounting",
  "/staff/appointments", "/staff/tasks", "/staff/follow-ups", "/staff/reports", "/staff/audit-alerts",
  "/staff/archive", "/staff/staff", "/staff/staff?tab=assignments", "/staff/staff?tab=activity",
  "/staff/settings", "/staff/new-client", "/staff/import", "/staff/gate-job-account",
];

async function blocking(page: Page) {
  await page.addScriptTag({ content: AXE });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: { id: string; impact: string | null; nodes: { target: string[] }[] }[] }> } }).axe;
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations;
  });
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}) × ${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1920, height: 1080 }]) {
  test.describe(`staff accessibility at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("every staff route has no serious or critical WCAG findings", async ({ page, context, baseURL }) => {
      test.setTimeout(180_000);
      await signIn(context, baseURL!, "admin");
      const found: string[] = [];
      for (const route of ROUTES) {
        await page.goto(route, { waitUntil: "networkidle" });
        for (const f of await blocking(page)) found.push(`${route}: ${f}`);
      }
      expect(found).toEqual([]);
    });

    test("Client 360 tabs and the command palette have no serious or critical WCAG findings", async ({ page, context, baseURL }) => {
      test.setTimeout(120_000);
      await signIn(context, baseURL!, "admin");
      const [client] = await db()`select id from clients where deleted_at is null order by created_at limit 1`;
      expect(client, "the e2e seed has a client").toBeTruthy();
      await page.goto(`/staff/client/${client.id}`, { waitUntil: "networkidle" });
      const found: string[] = [];
      for (const tab of ["Documents", "Appointments", "Notes", "Activity", "Profile"]) {
        await page.locator(".cg-profile-tab", { hasText: new RegExp(tab, "i") }).first().click();
        await page.waitForLoadState("networkidle");
        for (const f of await blocking(page)) found.push(`tab ${tab}: ${f}`);
      }
      const palette = page.getByRole("button", { name: "Open command palette" });
      if (await palette.isVisible()) {
        await palette.click();
        await page.getByTestId("command-palette").locator("input").fill("st");
        await page.waitForTimeout(400);
        for (const f of await blocking(page)) found.push(`command palette: ${f}`);
      }
      expect(found).toEqual([]);
    });
  });
}
