import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as dispatch, GET as inspectDispatch } from "@/app/api/staff/client-dispatch/route";
import { PATCH as resolveReview } from "@/app/api/staff/manager-inbox/route";
import { POST as operate } from "@/app/api/staff/operations/route";
import { withStaff, type StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { managerInbox, submitManagerReview } from "@/lib/manager-inbox";
import { operationalClientList } from "@/lib/operational-clients";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";
import { staffGuard } from "@/lib/staff-api";
import type { ClientStageFilter } from "@/lib/client-lifecycle-filters";

// Only authentication is adapted. All routes below execute their real SQL,
// transaction boundaries, constraints and row-level access policies.
vi.mock("@/lib/staff-api", () => ({ staffGuard: vi.fn() }));
const db = sql();
const trace = "command-center-integration";
let owner: StaffSession;
let colleague: StaffSession;
let manager: StaffSession;
let otherManager: StaffSession;
let nextPhone = 9400;

async function member(role: "manager" | "staff", label: string): Promise<StaffSession> {
  const authUserId = randomUUID();
  const email = `center-${label}-${authUserId}@test.invalid`;
  await db`insert into auth.users(id,email) values(${authUserId},${email})`;
  const [staff] = await db`insert into staff(display_name,email,role,auth_user_id)
    values(${`TEST Center ${label}`},${email},${role},${authUserId}) returning id,display_name,email,role`;
  return { authUserId, staff: staff as StaffSession["staff"] };
}

async function client(assigned = owner.staff.id) {
  const serial = ++nextPhone;
  return db.begin(tx => insertClient(tx, {
    source: "staff_manual", profile: ProfileSchema.parse({ full_name: `TEST Center Applicant ${serial}`, phone: `313555${serial}`, employment_history: [] }),
    primary: [], backup: [], status: "new_intake", nextStep: null,
    assignedStaff: assigned, createdBy: manager.staff.id, communicationConsent: false,
  }, { staffId: manager.staff.id, traceId: trace }));
}
async function legacyPair() {
  const first = await client();
  const second = await client();
  // Shared contact with a different name is permitted. A name-only update
  // reproduces historical duplicates without weakening the identity trigger.
  const [identity] = await db`select full_name,phone from clients where id=${first.id}`;
  await db`update clients set phone=${identity.phone} where id=${second.id}`;
  await db`update clients set full_name=${identity.full_name} where id=${second.id}`;
  return [first, second] as const;
}
const version = async (id: string) => String((await db`select updated_at::text version from clients where id=${id}`)[0].version);
const state = async (id: string) => (await db`select current_status,pipeline_stage,operational_location,is_urgent,manager_review_id,assigned_staff,deleted_at,delete_reason from clients where id=${id}`)[0];

function invoke(as: StaffSession, handler: (req: Request) => Promise<Response>, path: string, body?: Record<string, unknown>, method = "POST") {
  vi.mocked(staffGuard).mockResolvedValue({ session: as, response: null });
  return handler(new Request(`http://localhost${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));
}
async function successful(response: Response) {
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body.ok).toBe(true);
  return body;
}
async function visible(as: StaffSession, stage: ClientStageFilter, ref: string) {
  const result = await operationalClientList(as, stage === "completed" ? "completed" : "active", 1, 10, { stage, q: ref });
  return result.rows.map(row => row.ref);
}
async function review(clientId: string) {
  return submitManagerReview(owner, { kind: "client", client_id: clientId, note: "", request_key: randomUUID() }, trace);
}
async function decision(reviewId: string, clientId: string, extra: Record<string, unknown> = {}, actor = manager) {
  const [review] = await db`select related_client_id from manager_inbox where id=${reviewId}`;
  return invoke(actor, resolveReview, "/api/staff/manager-inbox", {
    id: reviewId, destination: "keep_current", note: "", expected_client_version: await version(clientId),
    ...(review.related_client_id ? { expected_related_client_version: await version(String(review.related_client_id)) } : {}),
    operation_id: randomUUID(), ...extra,
  }, "PATCH");
}
const stableResult = (body: Record<string, unknown>) => Object.fromEntries(Object.entries(body).filter(([key]) => key !== "trace_id"));

beforeAll(async () => {
  owner = await member("staff", "Owner");
  colleague = await member("staff", "Colleague");
  manager = await member("manager", "Manager");
  otherManager = await member("manager", "Other manager");
});
afterAll(async () => { await db.end(); });

describe("independent priority and one operational location across manager review", () => {
  it("flags an owned file in place and removes priority without changing its workflow or duplicating records", async () => {
    const item = await client();
    expect(await visible(owner, "new_intake", item.ref)).toContain(item.ref);
    await successful(await invoke(owner, dispatch, "/api/staff/client-dispatch", {
      operation: "urgent", client_id: item.id, urgent: true, operation_id: randomUUID(), expected_updated_at: await version(item.id),
    }));
    expect(await state(item.id)).toMatchObject({ current_status: "new_intake", is_urgent: true, operational_location: "new_intake", assigned_staff: owner.staff.id });
    expect(await visible(owner, "urgent", item.ref)).toEqual([item.ref]);
    expect(await visible(owner, "new_intake", item.ref)).toEqual([item.ref]);
    const general = await operationalClientList(owner, "active", 1, 10, { q: item.ref });
    expect(general.rows.map(row => row.ref)).toEqual([item.ref]);

    await successful(await invoke(owner, dispatch, "/api/staff/client-dispatch", {
      operation: "urgent", client_id: item.id, urgent: false, operation_id: randomUUID(), expected_updated_at: await version(item.id),
    }));
    expect(await state(item.id)).toMatchObject({ current_status: "new_intake", is_urgent: false, operational_location: "new_intake" });
    expect(await visible(owner, "urgent", item.ref)).toEqual([]);
    expect(await visible(owner, "new_intake", item.ref)).toEqual([item.ref]);
    expect((await db`select count(*)::int n from clients where id=${item.id}`)[0].n).toBe(1);
  });

  it("holds a submitted file exclusively at the manager and rejects routing around the review", async () => {
    const item = await client();
    const pending = await review(item.id);
    expect(await state(item.id)).toMatchObject({ operational_location: "manager", manager_review_id: pending.id });
    expect(await visible(owner, "new_intake", item.ref)).toEqual([]);
    expect(await visible(owner, "urgent", item.ref)).toEqual([]);
    const bypass = await invoke(manager, operate, "/api/staff/operations", { operation: "bulk_assign", client_ids: [item.id], target_stage: "completed" });
    expect(bypass.status, await bypass.clone().text()).toBe(409);
    expect(await state(item.id)).toMatchObject({ current_status: "new_intake", operational_location: "manager" });

    await successful(await decision(pending.id, item.id));
    expect(await state(item.id)).toMatchObject({ current_status: "new_intake", operational_location: "new_intake", manager_review_id: null });
    expect(await visible(owner, "new_intake", item.ref)).toEqual([item.ref]);
  });

  it("keeps priority through a manager hold and normal routing while the aggregate remains read-only during review", async () => {
    const item = await client();
    await successful(await invoke(owner, dispatch, "/api/staff/client-dispatch", { operation: "urgent", client_id: item.id, urgent: true, operation_id: randomUUID() }));
    const pending = await review(item.id);
    expect(await state(item.id)).toMatchObject({ is_urgent: true, operational_location: "manager", manager_review_id: pending.id });
    expect(await visible(owner, "new_intake", item.ref)).toEqual([]);
    const aggregate = await operationalClientList(owner, "active", 1, 10, { stage: "urgent", q: item.ref });
    expect(aggregate.rows).toHaveLength(1);
    expect(aggregate.rows[0]).toMatchObject({ ref: item.ref, manager_review_id: pending.id, operational_location: "manager", is_urgent: true });
    for (const actor of [owner, manager]) {
      const bypass = await invoke(actor, dispatch, "/api/staff/client-dispatch", {
        operation: "urgent", client_id: item.id, urgent: false, operation_id: randomUUID(), expected_updated_at: await version(item.id),
      });
      expect(bypass.status, await bypass.clone().text()).toBe(409);
      expect(await state(item.id)).toMatchObject({ is_urgent: true, operational_location: "manager", manager_review_id: pending.id });
    }
    await successful(await decision(pending.id, item.id));
    expect(await state(item.id)).toMatchObject({ is_urgent: true, operational_location: "new_intake", manager_review_id: null });
    await successful(await invoke(manager, operate, "/api/staff/operations", { operation: "bulk_assign", client_ids: [item.id], target_stage: "payment_required" }));
    expect(await state(item.id)).toMatchObject({ is_urgent: true, operational_location: "payment_required" });
    expect(await visible(owner, "payment_required", item.ref)).toEqual([item.ref]);
    expect(await visible(owner, "paperwork_pending", item.ref)).toEqual([]);
    expect(await visible(owner, "urgent", item.ref)).toEqual([item.ref]);
  });

  it("counts operational locations and overlapping priority without double-counting originals", async () => {
    const baseline = (await managerInbox(manager)).summary;
    const item = await client();
    expect((await managerInbox(manager)).summary).toEqual({ ...baseline, clients: baseline.clients + 1 });
    await successful(await invoke(owner, dispatch, "/api/staff/client-dispatch", { operation: "urgent", client_id: item.id, urgent: true, operation_id: randomUUID() }));
    expect((await managerInbox(manager)).summary).toEqual({ ...baseline, clients: baseline.clients + 1, urgent: baseline.urgent + 1 });
    const pending = await review(item.id);
    expect((await managerInbox(manager)).summary).toEqual({ ...baseline, urgent: baseline.urgent + 1, awaiting_review: baseline.awaiting_review + 1 });
    await successful(await decision(pending.id, item.id, { destination: "completed" }));
    expect((await managerInbox(manager)).summary).toEqual(baseline);
    expect(await state(item.id)).toMatchObject({ operational_location: "completed", is_urgent: true, manager_review_id: null });
    expect(await visible(owner, "urgent", item.ref)).toEqual([]);
    expect((await db`select count(*)::int n from clients where id=${item.id}`)[0].n).toBe(1);
  });

  it("rejects Urgent as a destination for active and terminal files without resolving the review", async () => {
    for (const status of ["new_intake", "completed", "cancelled"] as const) {
      const item = await client();
      if (status === "completed") {
        await successful(await invoke(manager, operate, "/api/staff/operations", { operation: "bulk_assign", client_ids: [item.id], target_stage: "completed" }));
      } else if (status === "cancelled") {
        await withStaff(manager, async tx => {
          await tx`select set_config('cg.status_override','Integration fixture for an already cancelled file',true)`;
          await tx`update clients set current_status='cancelled' where id=${item.id}`;
        });
      }
      const pending = await review(item.id);
      const refused = await decision(pending.id, item.id, { destination: "urgent" });
      expect(refused.status, await refused.clone().text()).toBe(400);
      expect(await state(item.id)).toMatchObject({ current_status: status, operational_location: "manager", manager_review_id: pending.id });
      expect((await db`select status from manager_inbox where id=${pending.id}`)[0].status).toBe("open");
      await successful(await decision(pending.id, item.id));
      expect(await state(item.id)).toMatchObject({ operational_location: status, manager_review_id: null });
    }
  });

  it("retains historical manager stamps after reassignment and reports a new pending review separately", async () => {
    const item = await client();
    const first = await review(item.id);
    await successful(await decision(first.id, item.id, { destination: "job_ready", assigned_staff_id: colleague.staff.id }));
    expect(await state(item.id)).toMatchObject({ assigned_staff: colleague.staff.id, operational_location: "job_ready" });
    const readStamp = async (as: StaffSession) => (await withStaff(as, tx => tx`select career_gate_private.client_review_stamp(${item.id}) stamp`))[0].stamp;
    expect(await readStamp(colleague)).toMatchObject({ reviewed_by_name: manager.staff.display_name, review_id: first.id, review_pending: false });
    const recorded = await readStamp(colleague);
    expect(Number.isNaN(new Date(recorded.reviewed_at).getTime())).toBe(false);
    await db`update staff set display_name='TEST Renamed Center Manager' where id=${manager.staff.id}`;
    try { expect(await readStamp(colleague)).toEqual(recorded); }
    finally { await db`update staff set display_name=${manager.staff.display_name} where id=${manager.staff.id}`; }
    const next = await submitManagerReview(colleague, { kind: "client", client_id: item.id, note: "A new question", request_key: randomUUID() }, trace);
    expect(await readStamp(colleague)).toMatchObject({ review_id: first.id, review_pending: true });
    await successful(await decision(next.id, item.id, { action: "return" }));
    expect((await db`select resolved_at from manager_inbox where id=${first.id}`)[0].resolved_at).not.toBeNull();
    await expect(withStaff(manager, tx => tx`update manager_inbox set resolution_note='rewrite history' where id=${first.id}`)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("dispatch authorization, concurrency and ambiguous-request recovery", () => {
  it("rejects direct manager resolution SQL that skips version checks and routing", async () => {
    const item = await client();
    const pending = await review(item.id);
    await expect(withStaff(manager, tx => tx`update manager_inbox
      set status='resolved',destination='completed',resolution_note='Attempted direct resolution',resolved_by=${manager.staff.id},resolved_at=now()
      where id=${pending.id}`)).rejects.toMatchObject({ code: "42501" });
    expect((await db`select status from manager_inbox where id=${pending.id}`)[0].status).toBe("open");
    expect(await state(item.id)).toMatchObject({ operational_location: "manager", manager_review_id: pending.id, current_status: "new_intake" });
  });

  it("rolls back a prepared resolution when its promised destination was never applied", async () => {
    const item = await client();
    const pending = await review(item.id);
    const expected = await version(item.id);
    await expect(withStaff(manager, async tx => {
      await tx`select career_gate_private.prepare_manager_resolution(${pending.id},${expected},${null})`;
      await tx`update manager_inbox
        set status='resolved',destination='completed',resolution_note='Routing was omitted',resolved_by=${manager.staff.id},resolved_at=now()
        where id=${pending.id}`;
    })).rejects.toMatchObject({ code: "23514" });
    expect((await db`select status from manager_inbox where id=${pending.id}`)[0].status).toBe("open");
    expect(await state(item.id)).toMatchObject({ operational_location: "manager", manager_review_id: pending.id, current_status: "new_intake" });
  });

  it("keeps urgency and operation results inside the authenticated actor's permitted scope", async () => {
    const item = await client();
    const operationId = randomUUID();
    const denied = await invoke(colleague, dispatch, "/api/staff/client-dispatch", { operation: "urgent", client_id: item.id, urgent: true, operation_id: operationId });
    expect([403, 404]).toContain(denied.status);
    expect(await state(item.id)).toMatchObject({ operational_location: "new_intake", is_urgent: false });
    await successful(await invoke(owner, dispatch, "/api/staff/client-dispatch", { operation: "urgent", client_id: item.id, urgent: true, operation_id: operationId }));
    const own = await successful(await invoke(owner, inspectDispatch, `/api/staff/client-dispatch?operation_id=${operationId}`, undefined, "GET"));
    expect(own.result).not.toBeNull();
    const hidden = await successful(await invoke(colleague, inspectDispatch, `/api/staff/client-dispatch?operation_id=${operationId}`, undefined, "GET"));
    expect(hidden.result).toBeNull();
  });

  it("replays a completed operation without repeating its side effects and rejects reuse with another payload", async () => {
    const item = await client();
    const body = { operation: "urgent", client_id: item.id, urgent: true, operation_id: randomUUID(), expected_updated_at: await version(item.id) };
    const first = await successful(await invoke(owner, dispatch, "/api/staff/client-dispatch", body));
    const afterFirst = await version(item.id);
    const activity = (await db`select count(*)::int n from activity_log where client_id=${item.id}`)[0].n;
    const replay = await successful(await invoke(owner, dispatch, "/api/staff/client-dispatch", body));
    expect(stableResult(replay)).toEqual(stableResult(first));
    expect(await version(item.id)).toBe(afterFirst);
    expect((await db`select count(*)::int n from activity_log where client_id=${item.id}`)[0].n).toBe(activity);
    const conflict = await invoke(owner, dispatch, "/api/staff/client-dispatch", { ...body, urgent: false });
    expect(conflict.status, await conflict.clone().text()).toBe(409);
    expect(await state(item.id)).toMatchObject({ operational_location: "new_intake", is_urgent: true });
  });

  it("does not accept a stale state-changing dispatch or a non-manager review decision", async () => {
    const item = await client();
    const previous = await version(item.id);
    await db`update clients set next_step='A newer operational instruction' where id=${item.id}`;
    const stale = await invoke(owner, dispatch, "/api/staff/client-dispatch", { operation: "urgent", client_id: item.id, urgent: true, operation_id: randomUUID(), expected_updated_at: previous });
    expect(stale.status, await stale.clone().text()).toBe(409);
    expect(await state(item.id)).toMatchObject({ operational_location: "new_intake" });
    const pending = await review(item.id);
    const denied = await decision(pending.id, item.id, { destination: "completed" }, owner);
    expect(denied.status).toBe(403);
    expect(await state(item.id)).toMatchObject({ operational_location: "manager" });
  });

  it("commits exactly one decision when two managers act on the same review", async () => {
    const item = await client();
    const pending = await review(item.id);
    const expected = await version(item.id);
    const payload = { id: pending.id, destination: "completed", note: "", expected_client_version: expected, operation_id: randomUUID() };
    const responses = await Promise.all([
      invoke(manager, resolveReview, "/api/staff/manager-inbox", payload, "PATCH"),
      invoke(otherManager, resolveReview, "/api/staff/manager-inbox", { ...payload, destination: "job_ready", operation_id: randomUUID() }, "PATCH"),
    ]);
    const bodies = await Promise.all(responses.map(async response => ({ status: response.status, body: await response.json() })));
    expect(bodies.filter(result => result.status === 200 && result.body.already_resolved === false)).toHaveLength(1);
    expect(bodies.every(result => result.status === 409 || (result.status === 200 && result.body.ok))).toBe(true);
    const [resolved] = await db`select destination,resolved_by,status from manager_inbox where id=${pending.id}`;
    expect(resolved.status).toBe("resolved");
    expect(await state(item.id)).toMatchObject({ operational_location: resolved.destination, manager_review_id: null });
    expect((await db`select count(*)::int n from activity_log where client_id=${item.id} and new_value->>'operation'='manager_review_resolved'`)[0].n).toBe(1);
  });
});

describe("duplicate review and recoverable removal", () => {
  it("allows manager recoverable archive but denies the same database operation to ordinary staff", async () => {
    const item = await client();
    await expect(withStaff(owner, tx => tx`select career_gate_private.archive_client(${item.id},'Unauthorized deletion',${trace})`)).rejects.toMatchObject({ code: "42501" });
    expect(await state(item.id)).toMatchObject({ deleted_at: null, operational_location: "new_intake" });
    const [archived] = await withStaff(manager, tx => tx`select career_gate_private.archive_client(${item.id},'Manager verified redundant intake',${trace}) result`);
    expect(archived.result).toMatchObject({ id: item.id, changed: true, archived: true });
    expect(await state(item.id)).toMatchObject({ operational_location: "deleted", delete_reason: "Manager verified redundant intake" });
    const audit = await db`select staff_id,new_value from activity_log where client_id=${item.id} and action='client_deleted'`;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ staff_id: manager.staff.id, new_value: { reason: "Manager verified redundant intake", recoverable: true } });
    expect((await db`select count(*)::int n from clients where id=${item.id}`)[0].n).toBe(1);
  });

  it("suggests a matching phone with abbreviated first-and-last names without deleting either record", async () => {
    const [full, abbreviated] = await legacyPair();
    await db`update clients set full_name='Samir Khalid Hassan' where id=${full.id}`;
    await db`update clients set full_name='Samir Hassan' where id=${abbreviated.id}`;
    const suggested = await successful(await invoke(owner, inspectDispatch, `/api/staff/client-dispatch?client_id=${full.id}`, undefined, "GET"));
    expect(suggested.duplicates.map((row: { id: string }) => row.id)).toContain(abbreviated.id);
    expect(await state(full.id)).toMatchObject({ deleted_at: null, manager_review_id: null, operational_location: "new_intake" });
    expect(await state(abbreviated.id)).toMatchObject({ deleted_at: null, manager_review_id: null, operational_location: "new_intake" });
  });

  it("rejects an unrelated existing review without partially holding the other record", async () => {
    const [fresh, held] = await legacyPair();
    const existing = await review(held.id);
    const before = (await db`select count(*)::int n from manager_inbox where client_id=${fresh.id} or related_client_id=${fresh.id}`)[0].n;
    const conflict = await invoke(owner, dispatch, "/api/staff/client-dispatch", {
      operation: "duplicate_review", client_id: fresh.id, related_client_id: held.id, note: "Compare both files", operation_id: randomUUID(),
    });
    expect(conflict.status, await conflict.clone().text()).toBe(409);
    expect(await state(fresh.id)).toMatchObject({ operational_location: "new_intake", manager_review_id: null });
    expect(await state(held.id)).toMatchObject({ operational_location: "manager", manager_review_id: existing.id });
    expect((await db`select count(*)::int n from manager_inbox where client_id=${fresh.id} or related_client_id=${fresh.id}`)[0].n).toBe(before);
  });

  it("releases both distinct records to their own previous locations when duplication is rejected", async () => {
    const [first, second] = await legacyPair();
    await successful(await invoke(owner, dispatch, "/api/staff/client-dispatch", { operation: "urgent", client_id: second.id, urgent: true, operation_id: randomUUID() }));
    const submitted = await successful(await invoke(owner, dispatch, "/api/staff/client-dispatch", {
      operation: "duplicate_review", client_id: first.id, related_client_id: second.id, note: "Review similar identities", operation_id: randomUUID(),
    }));
    const reviewId = String(submitted.review_id ?? submitted.id);
    await successful(await decision(reviewId, first.id, { action: "not_duplicate" }));
    expect(await state(first.id)).toMatchObject({ operational_location: "new_intake", manager_review_id: null, deleted_at: null });
    expect(await state(second.id)).toMatchObject({ operational_location: "new_intake", is_urgent: true, manager_review_id: null, deleted_at: null });
    expect(await visible(owner, "new_intake", first.ref)).toEqual([first.ref]);
    expect(await visible(owner, "new_intake", second.ref)).toEqual([second.ref]);
    expect(await visible(owner, "urgent", second.ref)).toEqual([second.ref]);
  });

  it("rejects deletion when the related record changed after the manager's comparison", async () => {
    const [first, second] = await legacyPair();
    const submitted = await successful(await invoke(owner, dispatch, "/api/staff/client-dispatch", {
      operation: "duplicate_review", client_id: first.id, related_client_id: second.id, note: "Compare identities", operation_id: randomUUID(),
    }));
    const reviewId = String(submitted.review_id ?? submitted.id);
    const comparedVersion = await version(second.id);
    const missing = await decision(reviewId, first.id, { action: "not_duplicate", expected_related_client_version: undefined });
    expect(missing.status, await missing.clone().text()).toBe(409);
    await withStaff(owner, tx => tx`update clients set full_name='TEST Newly Corrected Identity' where id=${second.id}`);
    const stale = await decision(reviewId, first.id, {
      action: "delete", delete_client_id: second.id, delete_reason: "Decision based on the prior comparison", expected_related_client_version: comparedVersion,
    });
    expect(stale.status, await stale.clone().text()).toBe(409);
    expect(await state(first.id)).toMatchObject({ operational_location: "manager", manager_review_id: reviewId, deleted_at: null });
    expect(await state(second.id)).toMatchObject({ operational_location: "manager", manager_review_id: reviewId, deleted_at: null });
    expect((await db`select status from manager_inbox where id=${reviewId}`)[0].status).toBe("open");
    await successful(await decision(reviewId, first.id, { action: "not_duplicate" }));
  });

  it("suggests matching legacy records, holds both for review and archives only the manager-selected record", async () => {
    const [keep, remove] = await legacyPair();
    const suggested = await successful(await invoke(owner, inspectDispatch, `/api/staff/client-dispatch?client_id=${keep.id}`, undefined, "GET"));
    expect(suggested.duplicates.map((row: { id: string }) => row.id)).toContain(remove.id);
    expect(await state(remove.id)).toMatchObject({ deleted_at: null });
    const submitted = await successful(await invoke(owner, dispatch, "/api/staff/client-dispatch", {
      operation: "duplicate_review", client_id: keep.id, related_client_id: remove.id, note: "Compare these legacy records", operation_id: randomUUID(),
    }));
    const reviewId = String(submitted.review_id ?? submitted.id);
    expect(reviewId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await state(keep.id)).toMatchObject({ operational_location: "manager", manager_review_id: reviewId });
    expect(await state(remove.id)).toMatchObject({ operational_location: "manager", manager_review_id: reviewId });
    const missingReason = await decision(reviewId, keep.id, { action: "delete", delete_client_id: remove.id, destination: "job_ready" });
    expect([400, 409]).toContain(missingReason.status);
    expect(await state(remove.id)).toMatchObject({ deleted_at: null, operational_location: "manager" });

    await successful(await decision(reviewId, keep.id, { action: "delete", delete_client_id: remove.id, delete_reason: "Duplicate confirmed after comparing both original files", destination: "job_ready" }));
    expect(await state(remove.id)).toMatchObject({ operational_location: "deleted", delete_reason: "Duplicate confirmed after comparing both original files" });
    expect((await state(remove.id)).deleted_at).not.toBeNull();
    expect(await state(keep.id)).toMatchObject({ operational_location: "job_ready", deleted_at: null, manager_review_id: null });
    expect((await db`select count(*)::int n from clients where id=any(${[keep.id, remove.id]})`)[0].n).toBe(2);
    expect(await visible(owner, "job_ready", remove.ref)).toEqual([]);
  });
});
