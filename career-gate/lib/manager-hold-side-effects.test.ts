import { describe, expect, it } from "vitest";
import { ActionSchema, runAction } from "@/lib/actions";
import { roleAllows } from "@/lib/authz";
import type { Tx } from "@/lib/auth";
import { syncPostPaymentLifecycle } from "@/lib/post-payment-lifecycle";

const CLIENT_ID = "10000000-0000-4000-8000-000000000001";
const APPOINTMENT_ID = "10000000-0000-4000-8000-000000000002";
const STAFF_ID = "10000000-0000-4000-8000-000000000003";
const REVIEW_ID = "10000000-0000-4000-8000-000000000004";

function transaction(client: Record<string, unknown>) {
  const calls: { text: string; values: unknown[] }[] = [];
  const tag = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const text = parts.join("?").replace(/\s+/g, " ").trim();
    calls.push({ text, values });
    if (text.startsWith("select * from clients") || text.startsWith("select id,current_status")) return [client];
    if (text.startsWith("select a.id")) return [{ ...client, id: APPOINTMENT_ID, client_id: CLIENT_ID, status: "attended", appointment_kind: "employment_interview" }];
    if (text.startsWith("insert into appointments")) return [{ id: APPOINTMENT_ID }];
    if (text.startsWith("select 1 from appointment_outcomes")) return [{ exists: 1 }];
    if (text.startsWith("select payment_status")) return [{ payment_status: "paid" }];
    return [];
  };
  return { tx: Object.assign(tag, { json: (value: unknown) => value }) as unknown as Tx, calls };
}

function heldClient(overrides: Record<string, unknown> = {}) {
  return { id: CLIENT_ID, current_status: "new_intake", pipeline_stage: "portal_intake", next_step: "Review intake", assigned_staff: STAFF_ID, manager_review_id: REVIEW_ID, ...overrides };
}

const context = (tx: Tx) => ({ tx, actor: { staffId: STAFF_ID, traceId: "manager-hold-test" }, role: "manager" as const, semantic: [] });

describe("manager hold side effects", () => {
  it.each([
    { action: "update_status", status: "needs_review", next_step: null },
    { action: "assign_staff", staff_id: STAFF_ID },
  ])("rejects explicit $action while the file is held, including apparent no-op assignment", async (input) => {
    const { tx, calls } = transaction(heldClient());
    await expect(runAction(context(tx), ActionSchema.parse({ ...input, client_id: CLIENT_ID })))
      .rejects.toMatchObject({ code: "manager_review_pending", status: 409 });
    expect(calls.some(({ text }) => text.startsWith("update clients"))).toBe(false);
  });

  it("saves an employment appointment during a hold without moving the client", async () => {
    const { tx, calls } = transaction(heldClient());
    const result = await runAction(context(tx), ActionSchema.parse({
      action: "schedule_appointment", client_id: CLIENT_ID, appointment_type: "Employment Interview", lifecycle_interview: true,
      scheduled_at: "2026-12-01T14:00:00.000Z", duration_minutes: 30, resource_key: "office", location: "Office", notes: null,
    }));
    expect(result).toMatchObject({ appointment_id: APPOINTMENT_ID, lifecycle_deferred: true });
    expect(calls.some(({ text }) => text.startsWith("insert into appointments"))).toBe(true);
    expect(calls.some(({ text }) => /update clients.*current_status/.test(text))).toBe(false);
  });

  it("records an interview outcome as evidence while preserving the held workflow and its audit truth", async () => {
    const { tx, calls } = transaction(heldClient());
    const result = await runAction(context(tx), ActionSchema.parse({ action: "appointment_decision", appointment_id: APPOINTMENT_ID, decision: "pass", note: "Recorded interview result" }));
    expect(result).toMatchObject({ decision: "pass", lifecycle_deferred: true });
    expect(calls.some(({ text }) => text.startsWith("insert into appointment_outcomes"))).toBe(true);
    expect(calls.some(({ text }) => /update clients.*current_status/.test(text))).toBe(false);
    expect(calls.some(({ text, values }) => text.startsWith("insert into activity_log") && values.includes("status_changed"))).toBe(false);
    expect(calls.some(({ text, values }) => text.startsWith("insert into activity_log") && values.includes("appointment_completed"))).toBe(true);
  });

  it("preserves the established outcome transition outside a hold", async () => {
    const { tx, calls } = transaction(heldClient({ current_status: "appointment_scheduled", pipeline_stage: "interview_scheduled", manager_review_id: null }));
    const result = await runAction(context(tx), ActionSchema.parse({ action: "appointment_decision", appointment_id: APPOINTMENT_ID, decision: "pass", note: "Recorded interview result" }));
    expect(result.lifecycle_deferred).toBe(false);
    expect(calls.some(({ text, values }) => /update clients.*current_status/.test(text) && values.includes("pre_hire_completed") && values.includes("payment_required"))).toBe(true);
    expect(calls.some(({ text, values }) => text.startsWith("insert into activity_log") && values.includes("status_changed"))).toBe(true);
  });

  it("reconciles payment readiness during a hold without automatic workflow writes", async () => {
    const { tx, calls } = transaction(heldClient({ current_status: "pre_hire_completed", pipeline_stage: "payment_required" }));
    await expect(syncPostPaymentLifecycle(tx, CLIENT_ID, STAFF_ID, "manager-hold-test")).resolves.toEqual({ changed: false, paymentReady: true });
    expect(calls.some(({ text }) => text.startsWith("update clients") || text.startsWith("insert into activity_log"))).toBe(false);
  });

  it("continues automatic paid-to-paperwork progression outside a hold", async () => {
    const { tx, calls } = transaction(heldClient({ current_status: "pre_hire_completed", pipeline_stage: "payment_required", manager_review_id: null }));
    await expect(syncPostPaymentLifecycle(tx, CLIENT_ID, STAFF_ID, "manager-hold-test")).resolves.toEqual({ changed: true, paymentReady: true });
    expect(calls.some(({ text, values }) => text.startsWith("update clients") && values.includes("screening_pending") && values.includes("post_interview_completion"))).toBe(true);
  });

  it("restricts recoverable deletion to managers and admins", () => {
    expect(roleAllows("manager", "soft_delete_client")).toBe(true);
    expect(roleAllows("admin", "soft_delete_client")).toBe(true);
    expect(roleAllows("staff", "soft_delete_client")).toBe(false);
  });
});
