import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withStaff, type StaffSession } from "@/lib/auth";
import { ActionSchema, runAction } from "@/lib/actions";
import { sql } from "@/lib/db";
import { managerInbox, resolveManagerReview, submitManagerReview } from "@/lib/manager-inbox";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";

const db = sql();
const sessions: Record<string, StaffSession> = {};
let phone = 7100;
async function createStaff(key: string, role: "admin" | "manager" | "staff") {
  const authId = randomUUID();
  const email = `inbox-${key}-${authId}@test.invalid`;
  await db`insert into auth.users(id,email) values(${authId},${email})`;
  const [staff] = await db`insert into staff(display_name,email,role,auth_user_id) values(${`TEST Inbox ${key}`},${email},${role},${authId}) returning id,display_name,email,role`;
  sessions[key] = { authUserId: authId, staff: staff as StaffSession["staff"] };
}
async function createClient() {
  return db.begin(tx => insertClient(tx, {
    source: "staff_manual", profile: ProfileSchema.parse({ full_name: `TEST Manager Review ${++phone}`, phone: `313555${phone}`, employment_history: [] }),
    primary: [], backup: [], status: "new_intake", nextStep: null, assignedStaff: sessions.sender.staff.id, createdBy: sessions.manager.staff.id, communicationConsent: false,
  }, { staffId: sessions.manager.staff.id, traceId: "manager-inbox-test" }));
}
const request = (clientId: string, key = randomUUID()) => submitManagerReview(sessions.sender, { kind: "client", client_id: clientId, note: "Please review this file", request_key: key }, "inbox-submit");
const version = async (id: string) => String((await db`select updated_at::text version from clients where id=${id}`)[0].version);

beforeAll(async () => { await createStaff("admin", "admin"); await createStaff("manager", "manager"); await createStaff("manager2", "manager"); await createStaff("sender", "staff"); await createStaff("other", "staff"); });
afterAll(async () => { await db.end(); });

describe("manager inbox scope and audited routing", () => {
  it("submits only an accessible client, deduplicates open reviews and hides others' submissions", async () => {
    const client = await createClient();
    const key = randomUUID();
    const [first, repeated] = await Promise.all([request(client.id, key), request(client.id, key)]);
    expect(first.id).toBe(repeated.id);
    expect([first.created, repeated.created].sort()).toEqual([false, true]);
    const another = await request(client.id);
    expect(another).toEqual({ id: first.id, created: false });
    await expect(submitManagerReview(sessions.other, { kind: "client", client_id: client.id, request_key: randomUUID(), note: "" }, "forbidden")).rejects.toMatchObject({ code: "not_found" });
    expect(await withStaff(sessions.other, tx => tx`select id from manager_inbox where id=${first.id}`)).toHaveLength(0);
    expect(await withStaff(sessions.sender, tx => tx`select id from manager_inbox where id=${first.id}`)).toHaveLength(1);
    const inbox = await managerInbox(sessions.manager);
    expect(inbox.items.find(item => item.id === first.id)).toMatchObject({ client_id: client.id, sender_name: "TEST Inbox sender", submitted_note: "Please review this file" });
    await expect(managerInbox(sessions.sender)).rejects.toMatchObject({ code: "forbidden" });
    await expect(db.begin(async tx => { await tx.unsafe("set local role anon"); return tx`select id from manager_inbox`; })).rejects.toMatchObject({ code: "42501" });
  });

  it("blocks unauthorized resolve and missing evidence without closing the review", async () => {
    const client = await createClient(); const item = await request(client.id);
    const input = { id: item.id, destination: "job_ready" as const, note: "", expected_client_version: await version(client.id) };
    await expect(resolveManagerReview(sessions.sender, input, "no-access")).rejects.toMatchObject({ code: "forbidden" });
    await expect(resolveManagerReview(sessions.manager, input, "missing-facts")).rejects.toMatchObject({ code: "requirements_missing" });
    await expect(resolveManagerReview(sessions.manager, { ...input, destination: "completed" }, "unpaid-completion")).rejects.toMatchObject({ code: "completion_required" });
    expect((await db`select status from manager_inbox where id=${item.id}`)[0].status).toBe("open");
    expect((await db`select current_status from clients where id=${client.id}`)[0].current_status).toBe("new_intake");
    expect((await db`select count(*)::int n from appointment_outcomes where client_id=${client.id}`)[0].n).toBe(0);
    expect(await withStaff(sessions.sender, tx => tx`update manager_inbox set status='resolved',destination='completed',resolved_by=${sessions.sender.staff.id},resolved_at=now() where id=${item.id} returning id`)).toHaveLength(0);
  });

  it("rejects stale review evidence before routing", async () => {
    const client = await createClient(); const item = await request(client.id); const previous = await version(client.id);
    await db`update clients set next_step='Changed by another employee' where id=${client.id}`;
    await expect(resolveManagerReview(sessions.manager, { id: item.id, destination: "account_setup", note: "", expected_client_version: previous }, "stale")).rejects.toMatchObject({ code: "client_changed", status: 409 });
    expect((await db`select status from manager_inbox where id=${item.id}`)[0].status).toBe("open");
  });

  it("does not use an old interview pass after a newer failed interview", async () => {
    const client = await createClient();
    await withStaff(sessions.admin, tx => runAction({ tx, actor: { staffId: sessions.admin.staff.id, traceId: "inbox-outcome-fixture" }, role: "admin", semantic: [] },
      ActionSchema.parse({ action: "override_status", client_id: client.id, status: "appointment_scheduled", reason: "Integration fixture for recorded interview history" })));
    for (const [decision, recorded] of [["pass", "2026-10-01T12:00:00Z"], ["fail", "2026-10-02T12:00:00Z"]]) {
      const [appointment] = await db`insert into appointments(client_id,appointment_type,appointment_kind,scheduled_at,ends_at,resource_key,created_by_staff,status)
        values(${client.id},'Employment interview','employment_interview',${recorded},${new Date(new Date(recorded).getTime() + 1800000).toISOString()},'office',${sessions.manager.staff.id},'attended') returning id`;
      await db`insert into appointment_outcomes(appointment_id,client_id,decision,recorded_by,recorded_at)
        values(${appointment.id},${client.id},${decision},${sessions.manager.staff.id},${recorded})`;
    }
    const item = await request(client.id);
    await expect(resolveManagerReview(sessions.manager, { id: item.id, destination: "payment_required", note: "", expected_client_version: await version(client.id) }, "latest-fail"))
      .rejects.toMatchObject({ code: "interview_or_payment_required" });
    expect((await db`select status from manager_inbox where id=${item.id}`)[0].status).toBe("open");
    expect((await db`select current_status from clients where id=${client.id}`)[0].current_status).toBe("appointment_scheduled");
  });

  it("routes the canonical client once and records the manager, note and transition", async () => {
    const client = await createClient(); const item = await request(client.id);
    const input = { id: item.id, destination: "account_setup" as const, note: "Identity reviewed; prepare the account", expected_client_version: await version(client.id) };
    const results = await Promise.all([resolveManagerReview(sessions.manager, input, "route-one"), resolveManagerReview(sessions.manager2, input, "route-two")]);
    expect(results.map(result => result.already_resolved).sort()).toEqual([false, true]);
    const [clientRow] = await db`select current_status,pipeline_stage from clients where id=${client.id}`;
    expect(clientRow).toMatchObject({ current_status: "ready_to_apply", pipeline_stage: "no_amazon_account" });
    const [record] = await db`select status,destination,resolved_by,resolved_at,resolution_note from manager_inbox where id=${item.id}`;
    expect(record).toMatchObject({ status: "resolved", destination: "account_setup", resolution_note: input.note });
    expect([sessions.manager.staff.id, sessions.manager2.staff.id]).toContain(record.resolved_by);
    expect(record.resolved_at).not.toBeNull();
    const notes = await db`select note,staff_id from notes where client_id=${client.id}`;
    expect(notes).toHaveLength(1); expect(notes[0]).toMatchObject({ note: input.note, staff_id: record.resolved_by });
    const audit = await db`select new_value from activity_log where client_id=${client.id} and action='status_changed' and new_value->>'operation'='manager_review_routed'`;
    expect(audit).toHaveLength(1); expect(audit[0].new_value).toMatchObject({ status: "ready_to_apply", request_id: item.id, reason: input.note });
    await expect(withStaff(sessions.manager, tx => tx`update manager_inbox set resolution_note='rewrite' where id=${item.id}`)).rejects.toMatchObject({ code: "42501" });
    await expect(withStaff(sessions.manager, tx => tx`update manager_inbox set submitted_note='rewrite' where id=${item.id}`)).rejects.toMatchObject({ code: "42501" });
  });

  it("keeps manager reports private and routes an actual follow-up task without changing clients", async () => {
    const report = await submitManagerReview(sessions.manager, { kind: "report", period: 7, request_key: randomUUID(), note: "Review the seven-day workload" }, "report-submit");
    expect(await withStaff(sessions.other, tx => tx`select id from manager_inbox where id=${report.id}`)).toHaveLength(0);
    await expect(submitManagerReview(sessions.sender, { kind: "report", period: 7, request_key: randomUUID(), note: "" }, "report-denied")).rejects.toMatchObject({ code: "forbidden" });
    const result = await resolveManagerReview(sessions.manager2, { id: report.id, destination: "account_setup", note: "Review account preparation delays" }, "report-route");
    expect(result.task_id).toBeTruthy(); expect(result.client_id).toBeNull();
    const [task] = await db`select title,description,assigned_to,created_by,client_id from tasks where id=${result.task_id}`;
    expect(task).toMatchObject({ assigned_to: sessions.manager.staff.id, created_by: sessions.manager2.staff.id, client_id: null });
    expect(task.title).toContain("Account Setup"); expect(task.description).toContain(`Manager review: ${report.id}`);
    expect(task.description).not.toContain("Review account preparation delays");
    // Office tasks are visible to ordinary staff by the established RLS policy.
    // They must carry only a generic reference, never the private review note.
    const [ordinaryStaffTask] = await withStaff(sessions.other, tx => tx`select description from tasks where id=${result.task_id}`);
    expect(ordinaryStaffTask.description).toContain(`Manager review: ${report.id}`);
    expect(ordinaryStaffTask.description).not.toContain("Review account preparation delays");
    expect(ordinaryStaffTask.description).not.toContain("Review the seven-day workload");
    const [snapshot] = await db`select snapshot,resolution_note from manager_inbox where id=${report.id}`;
    expect(snapshot.snapshot).toMatchObject({ period: 7, kpis: expect.objectContaining({ active: expect.any(Number) }) });
    expect(snapshot.resolution_note).toBe("Review account preparation delays");
  });

  it("enforces current granular permission in the API service and direct Data API RLS", async () => {
    const client = await createClient();
    await db`update staff set permission_mode='custom',custom_permissions='{}' where id=${sessions.sender.staff.id}`;
    try {
      await expect(request(client.id)).rejects.toMatchObject({ code: "forbidden" });
      await expect(withStaff(sessions.sender, tx => tx`insert into manager_inbox(request_key,kind,client_id,title,source_path,submitted_by) values(${randomUUID()},'client',${client.id},'Unauthorized',${`/staff/client/${client.id}`},${sessions.sender.staff.id})`)).rejects.toMatchObject({ code: "42501" });
    } finally { await db`update staff set permission_mode='full' where id=${sessions.sender.staff.id}`; }
  });

  it("hides a sender's historical financial report immediately after a management role downgrade", async () => {
    const report = await submitManagerReview(sessions.manager, { kind: "report", period: 30, request_key: randomUUID(), note: "Financial report privilege regression" }, "report-privilege");
    expect(await withStaff(sessions.manager, tx => tx`select id from manager_inbox where id=${report.id}`)).toHaveLength(1);
    await db`update staff set role='staff' where id=${sessions.manager.staff.id}`;
    try {
      // Keep the same authenticated subject (and even a stale application
      // session role) to prove RLS reads the current authoritative staff role.
      expect(await withStaff(sessions.manager, tx => tx`select id,snapshot from manager_inbox where id=${report.id}`)).toHaveLength(0);
      expect(await withStaff(sessions.manager2, tx => tx`select id from manager_inbox where id=${report.id}`)).toHaveLength(1);
    } finally { await db`update staff set role='manager' where id=${sessions.manager.staff.id}`; }
  });
});
