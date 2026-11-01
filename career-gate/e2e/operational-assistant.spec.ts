import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("operational assistant", () => {
  test("capacity watch shows at most three supported projections and keeps low samples out of warnings", async ({ page, baseURL }) => {
    await signIn(page.context(), baseURL!, "manager");
    const forecast = [
      { stage: "intake", label: "New Intake", labelAr: "الاستقبال", queued: 50, exits_28d: 10, exits_7d: 2, estimated_clearance_days: 140, beyond_week_capacity: 48, sample: "sufficient", href: "/staff/clients" },
      { stage: "account", label: "Account Setup", labelAr: "تجهيز الحساب", queued: 20, exits_28d: 10, exits_7d: 2, estimated_clearance_days: 56, beyond_week_capacity: 18, sample: "sufficient", href: "/staff/clients?stage=account_setup" },
      { stage: "job", label: "Job Ready", labelAr: "جاهز للوظيفة", queued: 10, exits_28d: 14, exits_7d: 4, estimated_clearance_days: 20, beyond_week_capacity: 7, sample: "sufficient", href: "/staff/clients?stage=job_ready" },
      { stage: "appointments", label: "Appointments", labelAr: "المواعيد", queued: 8, exits_28d: 14, exits_7d: 4, estimated_clearance_days: 16, beyond_week_capacity: 5, sample: "sufficient", href: "/staff/appointments" },
      { stage: "paperwork", label: "Payment & Paperwork", labelAr: "الدفع والوثائق", queued: 90, exits_28d: 2, exits_7d: 2, estimated_clearance_days: null, beyond_week_capacity: null, sample: "insufficient", href: "/staff/clients?stage=paperwork_pending" },
    ];
    await page.route("**/api/staff/operational-assistant?q=capacity%20forecast", (route) => route.fulfill({ json: { ok: true, answer: { forecast } } }));
    await page.goto("/staff");
    const watch = page.getByTestId("operational-capacity");
    await expect(watch.locator(".capacity-warnings article")).toHaveCount(3);
    await expect(watch.locator(".capacity-warnings")).toContainText("Account Setup");
    await expect(watch.locator(".capacity-warnings")).not.toContainText("Payment & Paperwork");
    await watch.getByText("Projection method & next step", { exact: true }).click();
    await expect(watch).toContainText("not missed deadlines");
    await expect(watch).toContainText("1 active stages have insufficient data");
  });

  test("manager can inspect real operational answers without leaving the current page", async ({ page, baseURL }) => {
    await signIn(page.context(), baseURL!, "manager");
    await page.goto("/staff");
    const opener = page.getByRole("button", { name: "Open operational assistant", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Operations assistant", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox")).toBeFocused();
    await dialog.getByRole("button", { name: "Who passed this month and has not paid?", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Successful interviews awaiting payment" })).toBeVisible();
    await expect(dialog).toContainText("Latest recorded interview outcome per client + actual account balance");
    await expect(page).toHaveURL(/\/staff$/);
    await dialog.getByRole("button", { name: "Where is the workflow bottleneck?", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Workflow capacity projection" })).toBeVisible();
    await expect(dialog.locator(".assistant-forecast-row")).toHaveCount(5);
    await expect(dialog).toContainText("not missed deadlines or an AI prediction");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
    await page.getByTestId("staff-language-toggle").click();
    await page.getByRole("button", { name: "فتح مساعد العمليات", exact: true }).click();
    const arabic = page.getByRole("dialog", { name: "مساعد العمليات", exact: true });
    await expect(arabic).toHaveAttribute("dir", "rtl");
    await expect(arabic.getByRole("heading", { name: "تقدير طاقة مسار العمل" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await arabic.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  });

  test("ordinary staff cannot access management analytics", async ({ page, baseURL }) => {
    await signIn(page.context(), baseURL!, "staff");
    const response = await page.request.get("/api/staff/operational-assistant?q=payments");
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "forbidden" } });
    await page.goto("/staff");
    await expect(page.getByRole("button", { name: "Open operational assistant", exact: true })).toHaveCount(0);
  });
});
