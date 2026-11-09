import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as priority } from "@/app/api/staff/client-priority/route";
import { POST as dispatch } from "@/app/api/staff/client-dispatch/route";
import { POST as operate } from "@/app/api/staff/operations/route";
import { withStaff, type StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { moveWorkflowClient } from "@/lib/manual-workflow";
import { submitManagerReview } from "@/lib/manager-inbox";
import { operationalClientList } from "@/lib/operational-clients";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";
import { staffGuard } from "@/lib/staff-api";
import type { WorkflowDestination } from "@/lib/workflow-registry";

vi.mock("@/lib/staff-api", () => ({ staffGuard: vi.fn() }));
const db = sql();
const traceId = "priority-flag-integration";
let owner: StaffSession;
let outsider: StaffSession;
let manager: StaffSession;
let phone = 9800;

async function member(role: "staff" | "manager", label: string): Promise<StaffSession> {
  const authUserId = randomUUID();
  const email = `priority-${label}-${authUserId}@test.invalid`;
  await db`insert into auth.users(id,email) values(${authUserId},${email})`;
  const [staff] = await db`insert into staff(display_name,email,role,auth_user_id,permission_mode)
    values(${`TEST Priority ${label}`},${email},${role},${authUserId},'full') returning id,display_name,email,role`;
  return { authUserId, staff: staff as StaffSession["staff"] };
}
async function client() {
  const serial = ++phone;
  return db.begin(tx => insertClient(tx, {
    source: "staff_manual", profile: ProfileSchema.parse({ full_name: `TEST Priority Applicant ${serial}`, phone: `313555${serial}`, employment_history: [] }),
    primary: [], backup: [], status: "new_intake", nextStep: null,
    assignedStaff: owner.staff.id, createdBy: manager.staff.id, communicationConsent: false,
  }, { staffId: manager.staff.id, traceId }));
}
async function version(clientId: string) { return String((await db`select updated_at::text value from clients where id=${clientId}`)[0].value); }
async function state(clientId: string) {
  return (await db`select current_status,pipeline_stage,next_step,assigned_staff,is_urgent,manager_review_id,operational_location from clients where id=${clientId}`)[0];
}
async function invoke(actor: StaffSession, handler: (request: Request) => Promise<Response>, body: Record<string, unknown>) {
  vi.mocked(staffGuard).mockResolvedValue({ session: actor, response: null });
  const response = await handler(new Request("http://localhost/api/staff/client-priority", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() };
}
async function command(clientId: string, isUrgent = true) {
  return { client_id: clientId, is_urgent: isUrgent, operation_id: randomUUID(), expected_updated_at: await version(clientId) };
}
async function move(clientId: string, destination: WorkflowDestination) {
  return withStaff(owner, async tx => {
    const [locked] = await tx`select id,current_status,pipeline_stage,next_step,is_urgent from clients where id=${clientId} for update`;
    return moveWorkflowClient(tx, owner, locked as Parameters<typeof moveWorkflowClient>[2], destination, undefined, traceId);
  });
}

beforeAll(async () => { owner = await member("staff", "Owner"); outsider = await member("staff", "Outsider"); manager = await member("manager", "Manager"); });
afterAll(async () => { await db.end(); });

describe("independent priority on the original client", () => {
  it("marks a file in place, records the actor, and keeps it in its real queue and the priority subset", async () => {
    const file = await client();
    const before = await state(file.id);
    const result = await invoke(owner, priority, await command(file.id));
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.client).toMatchObject({ id: file.id, is_urgent: true, operational_location: "new_intake" });
    expect(await state(file.id)).toMatchObject({ ...before, is_urgent: true });
    expect((await operationalClientList(owner, "active", 1, 20, { stage: "new_intake", q: file.ref })).rows).toHaveLength(1);
    expect((await operationalClientList(owner, "active", 1, 20, { stage: "urgent", q: file.ref })).rows).toHaveLength(1);
    const [audit] = await db`select staff_id,new_value from activity_log where client_id=${file.id} and new_value->>'operation'='client_priority_changed' order by created_at desc limit 1`;
    expect(audit).toMatchObject({ staff_id: owner.staff.id, new_value: { is_urgent: true, operational_location: "new_intake" } });
  });

  it("retains priority through ordinary, exceptional and final routing without fabricating another client", async () => {
    const file = await client();
    expect((await invoke(owner, priority, await command(file.id))).status).toBe(200);
    await move(file.id, "account_setup");
    expect(await state(file.id)).toMatchObject({ operational_location: "account_setup", is_urgent: true });
    await move(file.id, "worksite_change");
    expect(await state(file.id)).toMatchObject({ operational_location: "worksite_change", is_urgent: true });
    await move(file.id, "completed");
    expect(await state(file.id)).toMatchObject({ operational_location: "completed", is_urgent: true });
    expect((await operationalClientList(owner, "active", 1, 20, { stage: "urgent", q: file.ref })).rows).toHaveLength(0);
    expect((await invoke(owner, priority, await command(file.id, false))).status).toBe(200);
    expect((await state(file.id)).is_urgent).toBe(false);
    expect((await db`select count(*)::int n from clients where id=${file.id}`)[0].n).toBe(1);
  });

  it("preserves dispatch receipts while the old button changes priority rather than destination", async () => {
    const file = await client();
    const input = { operation: "urgent", client_id: file.id, urgent: true, operation_id: randomUUID(), expected_updated_at: await version(file.id) };
    const first = await invoke(owner, dispatch, input);
    const replay = await invoke(owner, dispatch, input);
    expect(first.status).toBe(200); expect(replay.status).toBe(200);
    expect(replay.body.client).toEqual(first.body.client);
    expect(first.body.client.operational_location).toBe("new_intake");
    expect((await db`select count(*)::int n from staff_operations where staff_id=${owner.staff.id} and operation_id=${input.operation_id}`)[0].n).toBe(1);
  });

  it("rejects stale versions and never reinterprets Urgent as a new routing command", async () => {
    const file = await client();
    const input = await command(file.id);
    expect((await invoke(owner, priority, input)).status).toBe(200);
    const stale = await invoke(owner, priority, { ...input, operation_id: randomUUID(), is_urgent: false });
    expect(stale.status).toBe(409); expect(stale.body.error.code).toBe("client_changed");
    expect((await invoke(owner, operate, { operation: "bulk_assign", client_ids: [file.id], target_stage: "urgent" })).status).toBe(400);
    expect((await state(file.id)).is_urgent).toBe(true);
  });

  it("accepts at most one concurrent write for the same saved version", async () => {
    const file = await client();
    const input = await command(file.id);
    const results = await Promise.all([invoke(owner, priority, input), invoke(owner, priority, { ...input, operation_id: randomUUID() })]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect((await db`select count(*)::int n from activity_log where client_id=${file.id} and new_value->>'operation'='client_priority_changed'`)[0].n).toBe(1);
  });

  it("denies another employee and honors freshly revoked granular permission", async () => {
    const file = await client();
    expect([403, 404]).toContain((await invoke(outsider, priority, await command(file.id))).status);
    await db`update staff set permission_mode='custom',custom_permissions='{}'::text[] where id=${owner.staff.id}`;
    try {
      expect((await invoke(owner, priority, await command(file.id))).status).toBe(403);
      expect((await invoke(owner, dispatch, { operation: "urgent", client_id: file.id, urgent: true, operation_id: randomUUID() })).status).toBe(403);
    } finally { await db`update staff set permission_mode='full' where id=${owner.staff.id}`; }
    expect((await state(file.id)).is_urgent).toBe(false);
  });

  it("keeps a manager-held file held and rejects priority changes by either role", async () => {
    const file = await client();
    await submitManagerReview(owner, { kind: "client", client_id: file.id, note: "TEST priority held", request_key: randomUUID() }, traceId);
    for (const actor of [owner, manager]) {
      const result = await invoke(actor, priority, await command(file.id));
      expect(result.status).toBe(409); expect(result.body.error.code).toBe("manager_review_pending");
    }
    expect(await state(file.id)).toMatchObject({ operational_location: "manager", is_urgent: false });
  });

  it("requires an explicit version on the new endpoint and rejects future urgency on closed records", async () => {
    const file = await client();
    expect((await invoke(owner, priority, { client_id: file.id, is_urgent: true, operation_id: randomUUID() })).status).toBe(400);
    await move(file.id, "completed");
    const result = await invoke(owner, priority, await command(file.id));
    expect(result.status).toBe(409); expect(result.body.error.code).toBe("closed_case");
  });
});
