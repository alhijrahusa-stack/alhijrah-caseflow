import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { ActionSchema, runAction } from "@/lib/actions";
import { withStaff, type StaffSession } from "@/lib/auth";
import { lockAccount, reconcileAccount } from "@/lib/accounting-ledger";
import { operationalClientList } from "@/lib/operational-clients";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2 });
let manager: StaffSession;
let admin: StaffSession;
let staff: StaffSession;

async function makeStaff(role: "admin" | "manager" | "staff"): Promise<StaffSession> {
  const user = randomUUID();
  const email = `appointments-${role}@test.invalid`;
  await db`insert into auth.users(id,email) values (${user},${email})`;
  const [row] = await db`insert into staff(display_name,email,role,auth_user_id)
    values(${`TEST Appointments ${role}`},${email},${role},${user})
    returning id,display_name,email,role`;
  return { authUserId: user, staff: row as StaffSession["staff"] };
}

const act = (session: StaffSession, payload: Record<string, unknown>) =>
  withStaff(session, (tx) => runAction({
    tx, actor: { staffId: session.staff.id, traceId: "appointment-integration" },
    role: session.staff.role, semantic: [],
  }, ActionSchema.parse(payload)));

async function makeAppointment(n: number) {
  const phone = `313555${String(9000 + n)}`;
  const client = await db.begin((tx) => insertClient(tx, {
    source: "staff_manual",
    profile: ProfileSchema.parse({ full_name: `TEST Interview ${n}`, phone, employment_history: [] }),
    primary: [], backup: [], status: "new_intake", nextStep: null,
    assignedStaff: staff.staff.id, createdBy: admin.staff.id, communicationConsent: false,
  }, { staffId: admin.staff.id, traceId: "appointment-integration" }));
  await act(admin, {
    action: "override_status", client_id: client.id, status: "appointment_scheduled",
    reason: "Integration test prerequisite", next_step: "Interview pending.",
  });
  const scheduledAt = new Date(Date.now() + 7 * 86400000 + n * 3600000).toISOString();
  const result = await act(manager, {
    action: "schedule_appointment", client_id: client.id, appointment_type: "Employment Interview", lifecycle_interview: true,
    scheduled_at: scheduledAt, duration_minutes: 30,
    resource_key: `staff:${manager.staff.id}`, location: "Office", notes: null,
  });
  return { clientId: client.id as string, appointmentId: result.appointment_id as string };
}

beforeAll(async () => {
  admin = await makeStaff("admin");
  manager = await makeStaff("manager");
  staff = await makeStaff("staff");
});

afterAll(async () => { await db.end(); });

describe("Appointment decision lifecycle and direct PostgreSQL upsert", () => {
  it.each([
    ["pass", "attended", "pre_hire_completed", "payment_required"],
    ["fail", "attended", "appointment_required", "need_new_appointment"],
    ["missed", "missed", "appointment_required", "amazon_account_waiting_job"],
    ["cancelled_interested", "cancelled", "appointment_required", "amazon_account_waiting_job"],
    ["cancelled_not_interested", "cancelled", "cancelled", "archive_not_interested"],
  ] as const)("persists %s atomically", async (decision, appointmentStatus, status, stage) => {
    const n = ["pass", "fail", "missed", "cancelled_interested", "cancelled_not_interested"].indexOf(decision) + 1;
    const { clientId, appointmentId } = await makeAppointment(n);
    const payload = { action: "appointment_decision", appointment_id: appointmentId, decision, note: "Outcome confirmed by field staff" };
    if (decision === "pass" || decision === "fail") {
      await expect(act(manager, payload)).rejects.toMatchObject({ code: "attendance_required" });
      const attendance = await act(manager, { action: "record_appointment_attendance", appointment_id: appointmentId });
      expect(attendance).toMatchObject({ changed: true, client_id: clientId });
      expect(await act(manager, { action: "record_appointment_attendance", appointment_id: appointmentId }))
        .toMatchObject({ changed: false });
      const [pending] = await db`select current_status from clients where id=${clientId}`;
      expect(pending.current_status).toBe("appointment_scheduled");
      expect(await db`select * from appointment_outcomes where appointment_id=${appointmentId}`).toHaveLength(0);
    }
    const result = await act(manager, payload);
    expect(result).toMatchObject({ changed: true, decision, client_id: clientId });
    const [appointment] = await db`select status from appointments where id=${appointmentId}`;
    const [client] = await db`select current_status,pipeline_stage from clients where id=${clientId}`;
    const outcomes = await db`select decision,recorded_by,client_id from appointment_outcomes where appointment_id=${appointmentId}`;
    expect(appointment.status).toBe(appointmentStatus);
    expect(client).toMatchObject({ current_status: status, pipeline_stage: stage });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ decision, recorded_by: manager.staff.id, client_id: clientId });
    const logs = await db`select action,new_value from activity_log where client_id=${clientId} and entity_id=${appointmentId} and action='appointment_completed'`;
    expect(logs).toHaveLength(1);
    expect(logs[0].new_value.decision).toBe(decision);
    expect(await act(manager, payload)).toMatchObject({ changed: false, decision });
    await expect(act(manager, { ...payload, decision: decision === "pass" ? "fail" : "pass" })).rejects.toMatchObject({ code: "decision_locked" });
    const [count] = await db`select count(*)::int as total from appointment_outcomes where appointment_id=${appointmentId}`;
    expect(count.total).toBe(1);
  });

  it("automatically moves a passed interview from payment to paperwork after real ledger settlement", async () => {
    const { clientId, appointmentId } = await makeAppointment(16);
    await act(manager, { action:"record_appointment_attendance", appointment_id:appointmentId });
    await act(manager, { action:"appointment_decision", appointment_id:appointmentId, decision:"pass", note:null });
    const [before] = await db`select current_status,pipeline_stage from clients where id=${clientId}`;
    expect(before).toMatchObject({ current_status:"pre_hire_completed", pipeline_stage:"payment_required" });

    const [accountExists] = await db`select id from client_accounts where client_id=${clientId}`;
    if (!accountExists) await db`update clients set pipeline_stage='interview_passed' where id=${clientId}`;
    await db`update clients set pipeline_stage='payment_required' where id=${clientId}`;

    let originalPayment = "";
    await withStaff(manager,async tx => {
      const account = await lockAccount(tx, clientId);
      const [transaction] = await tx`insert into payment_transactions
        (account_id,client_id,transaction_type,direction,amount,status,payment_method,occurred_at,source,recorded_by,idempotency_key)
        values (${account.id},${clientId},'payment','credit',150,'confirmed','cash',now(),'staff',${manager.staff.id},${randomUUID()}) returning id`;
      originalPayment=String(transaction.id);
      await reconcileAccount(tx,{ account,staffId:manager.staff.id,traceId:"appointment-integration",
        eligibilityDate:"2026-10-25",triggerTransactionId:String(transaction.id),paymentMethod:"cash" });
    });

    const [paid] = await db`select current_status,pipeline_stage from clients where id=${clientId}`;
    const [ledger] = await db`select payment_status from client_accounts where client_id=${clientId}`;
    expect(ledger.payment_status).toBe("paid");
    expect(paid).toMatchObject({ current_status:"screening_pending",pipeline_stage:"post_interview_completion" });

    const [original] = await db`select ref from clients where id=${clientId}`;
    const paperwork = await operationalClientList(admin,"active",1,25,{stage:"paperwork_pending",q:String(original.ref)});
    expect(paperwork.rows.map(row=>row.id)).toContain(clientId);
    const unpaid = await operationalClientList(admin,"active",1,25,{stage:"payment_required",q:String(original.ref)});
    expect(unpaid.rows.map(row=>row.id)).not.toContain(clientId);

    await withStaff(manager,async tx=>{
      const account=await lockAccount(tx,clientId);
      const [refund]=await tx`insert into payment_transactions
        (account_id,client_id,transaction_type,direction,amount,status,payment_method,occurred_at,related_transaction_id,source,recorded_by,idempotency_key)
        values (${account.id},${clientId},'refund','debit',150,'confirmed','cash',now(),${originalPayment},'staff',${manager.staff.id},${randomUUID()}) returning id`;
      await reconcileAccount(tx,{account,staffId:manager.staff.id,traceId:"appointment-integration",
        eligibilityDate:"2026-10-25",triggerTransactionId:String(refund.id),refundRecorded:true});
    });
    const [returned] = await db`select current_status,pipeline_stage from clients where id=${clientId}`;
    expect(returned).toMatchObject({current_status:"screening_pending",pipeline_stage:"payment_required"});
    const paymentAgain = await operationalClientList(admin,"active",1,25,{stage:"payment_required",q:String(original.ref)});
    expect(paymentAgain.rows.map(row=>row.id)).toContain(clientId);
    const paperworkAfterRefund=await operationalClientList(admin,"active",1,25,{stage:"paperwork_pending",q:String(original.ref)});
    expect(paperworkAfterRefund.rows.map(row=>row.id)).toContain(clientId);
    const audits = await db`select action from activity_log where client_id=${clientId}
      and action in ('status_changed','pipeline_stage_changed') order by created_at desc`;
    expect(audits.some(r=>r.action==="pipeline_stage_changed")).toBe(true);
  });

  it("allows clients to share the same resource and exact second, but prevents overlapping bookings for one client", async () => {
    const one = await makeAppointment(33);
    const two = await makeAppointment(34);
    const [a] = await db`select scheduled_at,ends_at,resource_key from appointments where id=${one.appointmentId}`;
    const second = await act(manager,{
      action:"update_appointment",appointment_id:two.appointmentId,
      scheduled_at:new Date(a.scheduled_at).toISOString(),duration_minutes:30
    });
    expect(second).toMatchObject({changed:true});
    const overlapping = await db`
      select count(*)::int n from appointments where scheduled_at=${a.scheduled_at}
      and resource_key=${a.resource_key} and id in (${one.appointmentId},${two.appointmentId})`;
    expect(overlapping[0].n).toBe(2);

    const [original] = await db`select client_id from appointments where id=${one.appointmentId}`;
    await expect(act(manager,{
      action:"schedule_appointment",client_id:original.client_id,appointment_type:"Office intake",
      scheduled_at:new Date(a.scheduled_at).toISOString(),duration_minutes:30,
      resource_key:String(a.resource_key),location:"Office",notes:null
    })).rejects.toMatchObject({code:"23P01"});
  });

  it("rejects a final decision when the client has not reached the appointment state", async () => {
    const phone = "3135559010";
    const client = await db.begin((tx) => insertClient(tx, {
      source: "staff_manual",
      profile: ProfileSchema.parse({ full_name: "TEST Unsatisfied Workflow", phone, employment_history: [] }),
      primary: [], backup: [], status: "new_intake", nextStep: null,
      assignedStaff: staff.staff.id, createdBy: admin.staff.id, communicationConsent: false,
    }, { staffId: admin.staff.id, traceId: "appointment-integration" }));
    const scheduledAt = new Date(Date.now() + 25 * 86400000).toISOString();
    const booking = await act(manager, {
      action: "schedule_appointment", client_id: client.id, appointment_type: "Interview",
      scheduled_at: scheduledAt, duration_minutes: 30, resource_key: `staff:${manager.staff.id}`,
      location: null, notes: null,
    });
    await expect(act(manager, {
      action: "appointment_decision", appointment_id: booking.appointment_id, decision: "pass", note: null,
    })).rejects.toMatchObject({ code: "invalid_appointment_kind" });
    const bookedId = String(booking.appointment_id);
    const [state] = await db`select status from appointments where id=${bookedId}`;
    expect(state.status).toBe("scheduled");
    const rows = await db`select * from appointment_outcomes where appointment_id=${bookedId}`;
    expect(rows).toHaveLength(0);
  });

  it("moves Job Ready to Appointment Scheduled only on a marked employment interview", async () => {
    const client = await db.begin((tx) => insertClient(tx, {
      source: "staff_manual",
      profile: ProfileSchema.parse({ full_name: "TEST Interview Auto Stage", phone: "3135559020", employment_history: [] }),
      primary: [], backup: [], status: "new_intake", nextStep: null,
      assignedStaff: staff.staff.id, createdBy: admin.staff.id, communicationConsent: false,
    }, { staffId: admin.staff.id, traceId: "appointment-integration" }));
    await act(admin, {
      action: "override_status", client_id: client.id, status: "appointment_required",
      reason: "Integration precondition", next_step: "Book employment interview",
    });
    const booked = await act(manager, {
      action: "schedule_appointment", client_id: client.id, appointment_type: "Employment Interview",
      lifecycle_interview: true,
      scheduled_at: new Date(Date.now() + 28 * 86400000).toISOString(),
      duration_minutes: 30, resource_key: `staff:${manager.staff.id}`,
      location: null, notes: null,
    });
    const appointmentId = String(booked.appointment_id);
    const [canonical] = await db`select current_status,pipeline_stage from clients where id=${client.id}`;
    const [appointment] = await db`select appointment_kind from appointments where id=${appointmentId}`;
    expect(canonical).toMatchObject({ current_status: "appointment_scheduled", pipeline_stage: "interview_scheduled" });
    expect(appointment.appointment_kind).toBe("employment_interview");
    await expect(act(manager, {
      action: "update_appointment", appointment_id: appointmentId, status: "attended",
    })).rejects.toMatchObject({ code: "use_interview_decision" });
  });

  it("rejects cross-client outcome attachment even for a privileged database writer", async () => {
    const first = await makeAppointment(14);
    const second = await makeAppointment(15);
    // Separate foreign keys to appointments and clients alone do not establish
    // that the selected appointment and client refer to the SAME person.
    await expect(db`insert into appointment_outcomes (appointment_id,client_id,decision,recorded_by)
      values (${first.appointmentId},${second.clientId},'missed',${manager.staff.id})`)
      .rejects.toMatchObject({ code: "23503" });
    expect(await db`select 1 from appointment_outcomes where appointment_id=${first.appointmentId}`)
      .toHaveLength(0);
    const [constraint] = await db`select pg_get_constraintdef(oid) definition
      from pg_constraint where conrelid='appointment_outcomes'::regclass
      and conname='appointment_outcomes_appointment_client_fkey'`;
    expect(constraint.definition).toContain("FOREIGN KEY (appointment_id, client_id)");
  });

  it("rejects tampering with an already persisted interview outcome", async () => {
    const { appointmentId } = await makeAppointment(12);
    await act(manager, { action: "record_appointment_attendance", appointment_id: appointmentId });
    await act(manager, { action: "appointment_decision", appointment_id: appointmentId, decision: "pass", note: null });
    await expect(db`update appointment_outcomes set note='overwritten' where appointment_id=${appointmentId}`)
      .rejects.toMatchObject({ code: "P0001" });
    await expect(db`delete from appointment_outcomes where appointment_id=${appointmentId}`)
      .rejects.toMatchObject({ code: "P0001" });
  });

  it("keeps attended interviews in Past with an unresolved outcome and an immutable attendance audit", async () => {
    const { clientId, appointmentId } = await makeAppointment(13);
    await act(manager, { action: "record_appointment_attendance", appointment_id: appointmentId });
    const [row] = await db`select status from appointments where id=${appointmentId}`;
    const [client] = await db`select current_status from clients where id=${clientId}`;
    const history = await db`select action from activity_log where client_id=${clientId}
      and entity_id=${appointmentId} and action='appointment_updated'
      and new_value @> '{"attendance_recorded":true}'::jsonb`;
    expect(row.status).toBe("attended");
    expect(client.current_status).toBe("appointment_scheduled");
    expect(history).toHaveLength(1);
    expect(await db`select decision from appointment_outcomes where appointment_id=${appointmentId}`).toHaveLength(0);
    await expect(act(manager, {
      action: "appointment_decision", appointment_id: appointmentId, decision: "missed", note: null,
    })).rejects.toMatchObject({ code: "already_attended" });
    await expect(act(manager, {
      action: "update_appointment", appointment_id: appointmentId, status: "rescheduled",
    })).rejects.toMatchObject({ code: "appointment_closed" });
  });

  it("denies anonymous access and staff writes through RLS", async () => {
    await expect(db.begin(async (tx) => {
      await tx.unsafe("set local role anon");
      return tx`select appointment_id from appointment_outcomes limit 1`;
    })).rejects.toMatchObject({ code: "42501" });
    const { clientId, appointmentId } = await makeAppointment(11);
    await expect(withStaff(staff, (tx) => tx`
      insert into appointment_outcomes(appointment_id,client_id,decision,recorded_by)
      values(${appointmentId},${clientId},'pass',${staff.staff.id})`
    )).rejects.toMatchObject({ code: "42501" });
  });
});

describe("staff appointment prerequisite override", () => {
  it("requires permission and ownership, preserves the guard, and commits the appointment and audit together", async () => {
    const { permissionAllows, clientScope } = await import("@/lib/authz");
    const otherUser = randomUUID();
    const otherEmail = `override-${otherUser}@test.invalid`;
    await db`insert into auth.users(id,email) values (${otherUser},${otherEmail})`;
    const [otherRow] = await db`insert into staff(display_name,email,role,auth_user_id)
      values('TEST Override Other',${otherEmail},'staff',${otherUser}) returning id,display_name,email,role`;
    const otherStaff: StaffSession = { authUserId: otherUser, staff: otherRow as StaffSession["staff"] };
    const client = await db.begin((tx) => insertClient(tx, {
      source: "staff_manual",
      profile: ProfileSchema.parse({ full_name: "TEST Override", phone: "3135559921", employment_history: [] }),
      primary: [], backup: [], status: "new_intake", nextStep: null,
      assignedStaff: staff.staff.id, createdBy: admin.staff.id, communicationConsent: false,
    }, { staffId: admin.staff.id, traceId: "override-integration" }));
    const payload = { action: "schedule_appointment", client_id: client.id, appointment_type: "Employment interview", lifecycle_interview: true,
      scheduled_at: new Date(Date.now() + 35 * 86400000).toISOString(), duration_minutes: 30, resource_key: "office", location: "Office", notes: null };
    await db`update staff set permission_mode='custom', custom_permissions=array[]::text[] where id=${staff.staff.id}`;
    expect(await permissionAllows(staff, "schedule_appointment")).toBe(false);
    await db`update staff set custom_permissions=array['schedule_appointment'] where id=${staff.staff.id}`;
    expect(await permissionAllows(staff, "schedule_appointment")).toBe(true);
    expect(await clientScope(otherStaff, client.id as string)).toMatchObject({ ok: false, status: 403 });
    await expect(act(otherStaff, { ...payload, lifecycle_override_reason: "Interview booked externally" })).rejects.toMatchObject({ code: "not_found" });
    await expect(act(staff, payload)).rejects.toMatchObject({ code: "lifecycle_conflict" });
    expect(await db`select id from appointments where client_id=${client.id}`).toHaveLength(0);
    await expect(withStaff(staff, async tx => {
      await runAction({ tx, actor: { staffId: staff.staff.id, traceId: "rollback-test" }, role: "staff", semantic: [] },
        ActionSchema.parse({ ...payload, lifecycle_override_reason: "Interview booked externally" }));
      throw new Error("force rollback");
    })).rejects.toThrow("force rollback");
    expect(await db`select id from appointments where client_id=${client.id}`).toHaveLength(0);
    expect(await db`select id from activity_log where client_id=${client.id} and action='status_overridden'`).toHaveLength(0);
    const result = await act(staff, { ...payload, lifecycle_override_reason: "Interview booked externally" });
    const [row] = await db`select current_status,pipeline_stage from clients where id=${client.id}`;
    expect(row).toMatchObject({ current_status: "appointment_scheduled", pipeline_stage: "interview_scheduled" });
    const [log] = await db`select staff_id,new_value from activity_log where client_id=${client.id} and action='status_overridden'`;
    expect(log.staff_id).toBe(staff.staff.id);
    expect(log.new_value).toMatchObject({ reason: "Interview booked externally", appointment_id: result.appointment_id });
    await db`update staff set permission_mode='full', custom_permissions=array[]::text[] where id=${staff.staff.id}`;
  });
});
