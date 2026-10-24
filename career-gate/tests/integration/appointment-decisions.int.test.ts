import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { ActionSchema, runAction } from "@/lib/actions";
import { withStaff, type StaffSession } from "@/lib/auth";
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
