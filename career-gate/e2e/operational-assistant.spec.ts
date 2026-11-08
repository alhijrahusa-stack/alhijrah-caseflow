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

  test("manager chats with the assistant: streamed reply, live record card, scrollable history, without leaving the page", async ({ page, baseURL }) => {
    await signIn(page.context(), baseURL!, "manager");
    // The real check output for this database, delivered as the model would deliver it.
    const real = await page.request.get("/api/staff/operational-assistant?q=bottleneck");
    const answer = (await real.json()).answer;
    const sent: unknown[] = [];
    await page.route("**/api/assistant", async (route) => {
      sent.push(route.request().postDataJSON());
      const turn = sent.length;
      const events = [
        { type: "start", messageId: `m${turn}` }, { type: "start-step" },
        { type: "tool-input-available", toolCallId: `c${turn}`, toolName: "flow_forecast", input: {} },
        { type: "tool-output-available", toolCallId: `c${turn}`, output: { status: "ok", answer } },
        { type: "finish-step" }, { type: "start-step" },
        { type: "text-start", id: `t${turn}` },
        { type: "text-delta", id: `t${turn}`, delta: turn === 1 ? "Capacity per stage is below. " : "Same figures, checked again. " },
        { type: "text-delta", id: `t${turn}`, delta: "Review the slowest stage first." },
        { type: "text-end", id: `t${turn}` }, { type: "finish-step" }, { type: "finish" },
      ];
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1", "cache-control": "no-cache" },
        body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n",
      });
    });
    await page.goto("/staff");
    const opener = page.getByRole("button", { name: "Open operational assistant", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Operations assistant", exact: true });
    await expect(dialog).toBeVisible();
    const composer = dialog.getByRole("textbox", { name: "Ask in English or Arabic" });
    await expect(composer).toBeFocused();
    await expect(dialog.locator(".operational-assistant-suggestions")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Send ↗" })).toBeDisabled();

    await composer.fill("Where is the workflow bottleneck?");
    await composer.press("Enter");
    await expect(dialog.getByTestId("assistant-user-message")).toHaveText("Where is the workflow bottleneck?");
    const reply = dialog.getByTestId("assistant-reply").first();
    await expect(reply).toContainText("Capacity per stage is below. Review the slowest stage first.");
    await expect(reply.getByRole("heading", { name: "Workflow capacity projection" })).toBeVisible();
    await expect(reply.locator(".assistant-forecast-row")).toHaveCount(answer.forecast.length);
    await expect(composer).toHaveValue("");
    await expect(page).toHaveURL(/\/staff$/);

    // A follow-up carries the conversation; Shift+Enter is a new line, not a send.
    await composer.fill("Check again");
    await composer.press("Shift+Enter");
    await expect(composer).toHaveValue("Check again\n");
    await composer.press("Enter");
    await expect(dialog.getByTestId("assistant-reply")).toHaveCount(2);
    const second = sent[1] as { messages: { role: string; parts: { type: string }[] }[] };
    expect(second.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    // Only text goes back to the server; tool output stays in the browser.
    expect(second.messages.flatMap((m) => m.parts.map((p) => p.type))).toEqual(["text", "text", "text"]);
    const history = dialog.getByRole("log", { name: "Conversation" });
    // History scrolls inside the dialog and follows the newest reply.
    await expect.poll(() => history.evaluate((el) => ({ scrolls: el.scrollHeight > el.clientHeight, atBottom: Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 4 })))
      .toEqual({ scrolls: true, atBottom: true });

    // Deferring the assistant must preserve the first click and keep the same
    // chat session, including an unsent draft, after closing or navigating.
    await composer.fill("Keep this unsent follow-up");
    await dialog.getByRole("button", { name: "Close assistant", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.locator('.royal-nav a[href="/staff/clients"]').click();
    await expect(page).toHaveURL(/\/staff\/clients$/);
    await opener.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("assistant-reply")).toHaveCount(2);
    await expect(composer).toHaveValue("Keep this unsent follow-up");

    await dialog.getByRole("button", { name: "New chat" }).click();
    await expect(dialog.getByTestId("assistant-reply")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();

    await page.getByTestId("staff-language-toggle").click();
    await page.getByRole("button", { name: "فتح مساعد العمليات", exact: true }).click();
    const arabic = page.getByRole("dialog", { name: "مساعد العمليات", exact: true });
    await expect(arabic).toHaveAttribute("dir", "rtl");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await arabic.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await expect(arabic.getByRole("textbox")).toBeInViewport();
  });

  test("without a model key the chat says the assistant is not configured", async ({ page, baseURL }) => {
    await signIn(page.context(), baseURL!, "manager");
    await page.goto("/staff");
    await page.getByRole("button", { name: "Open operational assistant", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Operations assistant", exact: true });
    await dialog.getByRole("textbox").fill("Show current team load");
    await dialog.getByRole("button", { name: "Send ↗" }).click();
    await expect(dialog.getByRole("alert")).toContainText("NOT_CONFIGURED");
  });

  test("ordinary staff cannot access management analytics", async ({ page, baseURL }) => {
    await signIn(page.context(), baseURL!, "staff");
    const response = await page.request.get("/api/staff/operational-assistant?q=payments");
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const chat = await page.request.post("/api/assistant", { data: { messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "payments" }] }] } });
    expect(chat.status()).toBe(403);
    await page.goto("/staff");
    await expect(page.getByRole("button", { name: "Open operational assistant", exact: true })).toHaveCount(0);
  });
});
