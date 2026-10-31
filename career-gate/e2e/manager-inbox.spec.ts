import { expect, test } from "@playwright/test";
import { db, intakeBody, RUN, selectChoice, signIn, STAFF, staffAction } from "./helpers";

test("staff hands off a real client; manager reviews and routes the same file without page navigation", async ({ browser, request, baseURL }) => {
  const [owner] = await db()`select id from staff where auth_user_id=${STAFF.staff}`;
  const name = `TEST Manager Handoff ${RUN}`;
  const created = await staffAction(request, "admin", { action: "create_client", profile: intakeBody(name).profile, primary: [], backup: [], status: "new_intake", next_step: null, assigned_staff: owner.id, communication_consent: false });
  expect(created.status).toBe(200);
  const clientId = String(created.json.id);
  const staffContext = await browser.newContext({ baseURL });
  const managerContext = await browser.newContext({ baseURL });
  try {
    await signIn(staffContext, baseURL!, "staff");
    await signIn(managerContext, baseURL!, "manager");
    const staffPage = await staffContext.newPage();
    await staffPage.goto(`/staff/client/${clientId}`);
    await staffPage.getByRole("button", { name: "Send to manager", exact: true }).click();
    const dialog = staffPage.getByRole("dialog", { name: "Send for manager review" });
    await dialog.getByLabel("Review note (optional)").fill("Please prepare the account after review");
    await dialog.getByRole("button", { name: "Send review", exact: true }).click();
    await expect(staffPage.getByRole("status").filter({ hasText: "Sent to the manager" })).toBeVisible();

    const managerPage = await managerContext.newPage();
    await managerPage.goto("/staff/manager-inbox");
    await expect(managerPage.getByRole("heading", { name: "Manager's Task Center" })).toBeVisible();
    const inbox = managerPage.getByRole("complementary", { name: "Incoming reviews" });
    await inbox.getByRole("button").filter({ hasText: name }).click();
    await expect(managerPage.getByRole("blockquote").filter({ hasText: "Please prepare the account" })).toBeVisible();
    await managerPage.getByLabel("Manager note (optional)").fill("Reviewed; move to account preparation");
    const destination = managerPage.getByRole("combobox", { name: "Next workflow section" });
    await selectChoice(destination, { value: "account_setup" });
    const navigations: string[] = [];
    managerPage.on("framenavigated", frame => { if (frame === managerPage.mainFrame()) navigations.push(frame.url()); });
    await managerPage.getByRole("button", { name: "Approve & route", exact: true }).click();
    await expect(inbox.getByRole("button").filter({ hasText: name })).toHaveCount(0);
    await expect(managerPage.getByRole("status").filter({ hasText: "Approved and routed to" })).toBeVisible();
    expect(navigations).toEqual([]);
    expect(managerPage.url()).toContain("/staff/manager-inbox");
    const [row] = await db()`select current_status,pipeline_stage from clients where id=${clientId}`;
    expect(row).toMatchObject({ current_status: "ready_to_apply", pipeline_stage: "no_amazon_account" });
    const [resolution] = await db()`select status,resolution_note from manager_inbox where client_id=${clientId}`;
    expect(resolution).toMatchObject({ status: "resolved", resolution_note: "Reviewed; move to account preparation" });
  } finally { await staffContext.close(); await managerContext.close(); }
});

test("ordinary staff cannot open or resolve the manager inbox", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  try {
    await signIn(context, baseURL!, "staff");
    const page = await context.newPage();
    await page.goto("/staff/manager-inbox");
    await expect(page.getByTestId("forbidden")).toBeVisible();
    const response = await context.request.get("/api/staff/manager-inbox");
    expect(response.status()).toBe(403);
  } finally { await context.close(); }
});
