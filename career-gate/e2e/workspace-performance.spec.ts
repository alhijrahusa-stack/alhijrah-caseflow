import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("manager hydration reuses its server snapshot and foreground events share one live read", async ({ page, baseURL }) => {
  await signIn(page.context(), baseURL!, "manager");
  const reads: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() === "GET") reads.push(new URL(request.url()).pathname); });
  const presenceReady = page.waitForResponse(response => new URL(response.url()).pathname === "/api/staff/presence" && response.request().method() === "POST");
  await page.goto("/staff/manager-inbox");
  await expect(page.getByRole("heading", { name: "Manager's Task Center", exact: true })).toBeVisible();
  await presenceReady;
  const alerts = page.getByTestId("manager-floating-header").getByRole("button", { name: /Appointment alerts,/ });
  await expect(alerts).toBeVisible();
  await alerts.click();
  await expect(page.getByRole("heading", { name: "Appointment alerts", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close appointment alerts", exact: true }).click();
  // Wait beyond the old summary debounce, after the mounted shell has issued
  // its presence request, to observe any redundant hydration reads.
  await page.waitForTimeout(350);
  expect(reads.filter(path => path === "/api/staff/manager-inbox")).toHaveLength(0);
  expect(reads.filter(path => path === "/api/staff/dashboard-summary")).toHaveLength(0);
  expect(errors).toEqual([]);

  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/staff/manager-inbox");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new CustomEvent("career-gate:executive-refresh", { detail: { resources: ["finance"] } }));
  });
  await refreshed;
  await page.waitForTimeout(400);
  expect(reads.filter(path => path === "/api/staff/manager-inbox")).toHaveLength(1);
  expect(reads.filter(path => path === "/api/staff/dashboard-summary")).toHaveLength(0);

  const filtered = page.waitForResponse(response => new URL(response.url()).pathname === "/api/staff/manager-inbox" && new URL(response.url()).searchParams.get("urgent") === "1");
  await page.getByTestId("manager-segment-urgent").click();
  await filtered;
  await expect(page.getByTestId("manager-segment-urgent")).toHaveAttribute("aria-pressed", "true");
  expect(reads.filter(path => path === "/api/staff/manager-inbox")).toHaveLength(2);

  // The shared layout survives navigation. Resume the sidebar's live summary
  // when it becomes visible again, instead of leaving its paused counts stale.
  const resumed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/staff/dashboard-summary");
  await page.getByTestId("manager-section-rail").getByRole("link", { name: "Clients", exact: true }).click();
  await resumed;
  await expect(page.getByRole("heading", { name: "Clients Registry", exact: true })).toBeVisible();
  expect(reads.filter(path => path === "/api/staff/dashboard-summary")).toHaveLength(1);
  expect(errors).toEqual([]);
});
