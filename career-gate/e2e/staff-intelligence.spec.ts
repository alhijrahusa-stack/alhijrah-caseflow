import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { accessToken, db, intakeBody, RUN, signIn, submitIntake, uniqueIp } from "./helpers";

/**
 * Server-paged Accounting, Reports intelligence, isolated rendering failures
 * and the public duplicate response, as staff and applicants meet them.
 */

test.describe.serial("Staff intelligence surfaces", () => {
  let page: Page;
  let clientId = "";
  const name = `TEST Intel Board ${RUN}`;

  test.beforeAll(async ({ request, browser, baseURL }) => {
    const intake = await submitIntake(request, intakeBody(name));
    expect(intake.res.status(), JSON.stringify(intake.json)).toBe(201);
    const [client] = await db()`select id from clients where ref=${intake.json.ref}`;
    clientId = client.id as string;
    const stage = await request.post("/api/staff/operations", {
      data: { operation: "move_stage", client_id: clientId, stage: "interview_passed" },
      headers: { cookie: `cg_at=${await accessToken("admin")}`, "x-forwarded-for": uniqueIp() },
    });
    expect(stage.status()).toBe(200);
    const ctx = await browser.newContext({ baseURL });
    await signIn(ctx, baseURL!, "admin");
    page = await ctx.newPage();
  });

  test("accounting search runs on the server and lands in the URL", async () => {
    await page.goto("/staff/accounting");
    await expect(page.getByTestId("accounting-count")).toBeVisible();
    await page.getByTestId("accounting-search").fill(`Intel Board ${RUN}`);
    await expect(page).toHaveURL(/[?&]q=Intel\+Board/);
    await expect(page.getByTestId("accounting-count")).toHaveText("1 account");
    await expect(page.getByTestId("account-row")).toHaveCount(1);
    await expect(page.getByTestId("account-row").first()).toContainText(name);
  });

  test("status and client filters compose and clear without a full reload", async () => {
    await page.goto(`/staff/accounting?client=${clientId}`);
    await expect(page.getByTestId("account-row")).toHaveCount(1);
    await page.getByTestId("accounting-status").selectOption("paid");
    await expect(page).toHaveURL(/status=paid/);
    await expect(page.getByTestId("account-row")).toHaveCount(0);
    await page.getByTestId("accounting-status").selectOption("all");
    await expect(page.getByTestId("account-row")).toHaveCount(1);
    await page.getByTestId("clear-client-focus").click();
    await expect(page).not.toHaveURL(/client=/);
    await expect(page.getByTestId("clear-client-focus")).toHaveCount(0);
  });

  test("the accounting page carries one page of accounts, not the whole ledger", async () => {
    const res = await page.request.get("/staff/accounting", { headers: { cookie: `cg_at=${await accessToken("admin")}` } });
    expect(res.status()).toBe(200);
    const [{ n }] = await db()`select count(*)::int n from client_accounts a join clients c on c.id=a.client_id where c.deleted_at is null`;
    const html = await res.text();
    const rendered = (html.match(/data-testid="account-row"/g) ?? []).length;
    expect(rendered).toBe(Math.min(25, n));
  });

  test("reports state findings, a funnel and twelve weeks of intake for the chosen period", async () => {
    await page.goto("/staff/reports");
    await expect(page.getByRole("heading", { name: /^Reports$/ })).toBeVisible();
    await expect(page.getByTestId("report-insights").locator("li").first()).toBeVisible();
    await expect(page.getByTestId("report-funnel").locator("li")).toHaveCount(15);
    await expect(page.getByTestId("report-weekly").locator("[role=img] > div")).toHaveCount(12);
    await expect(page.getByTestId("report-staff")).toBeVisible();
    await page.getByRole("link", { name: "Last 7 days" }).click();
    await expect(page).toHaveURL(/period=7/);
    await expect(page.getByRole("link", { name: "Last 7 days" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("report-new-current")).toBeVisible();
  });

  test("Today and Week open actionable, authenticated work windows", async () => {
    await page.goto("/staff/today");
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Open Tasks Due/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Upcoming Appointments/ })).toBeVisible();
    await page.getByRole("link", { name: "Week", exact: true }).click();
    await expect(page).toHaveURL(/\\/staff\\/week$/);
    await expect(page.getByRole("heading", { name: "This Week", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Open Follow-Ups Due/ })).toBeVisible();
    await page.goto("/staff?tab=week");
    await expect(page).toHaveURL(/\\/staff\\/week$/);
    await page.goto("/staff?tab=today");
    await expect(page).toHaveURL(/\\/staff\\/today$/);
  });

  test("tasks are paged with a total", async () => {
    await page.goto("/staff/tasks");
    await expect(page.getByRole("heading", { name: /^Tasks$/ })).toBeVisible();
    await expect(page.locator(".ops-hero p").last()).toContainText(/\d+ open task/);
  });
});

test("a repeated public application is refused without describing the existing file", async ({ request }) => {
  const body = intakeBody(`TEST Duplicate Applicant ${RUN}`);
  const first = await submitIntake(request, body, randomUUID(), uniqueIp());
  expect(first.res.status(), JSON.stringify(first.json)).toBe(201);
  const second = await submitIntake(request, body, randomUUID(), uniqueIp());
  expect(second.res.status()).toBe(409);
  expect(second.json.error.code).toBe("duplicate_application");
  const text = JSON.stringify(second.json);
  expect(text).not.toMatch(/phone/i);
  expect(text).not.toContain(first.json.ref);
  expect(text).not.toContain(body.profile.email);
});
