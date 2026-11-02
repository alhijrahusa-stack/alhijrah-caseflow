import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as operate } from "@/app/api/staff/operations/route";
import { type StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";
import { staffGuard } from "@/lib/staff-api";

// Only the HTTP session adapter is a fixture; the route runs its real SQL, the
// status-transition trigger and RLS against the migrated database.
vi.mock("@/lib/staff-api", () => ({ staffGuard: vi.fn() }));
const db = sql();
const trace = "authorized-stage-skip";
let manager: StaffSession;
let staffOnly: StaffSession;
let phone = 7600;

async function member(role: "manager" | "staff") {
  const authUserId = randomUUID();
  const email = `skip-${role}-${authUserId}@test.invalid`;
  await db`insert into auth.users(id,email) values(${authUserId},${email})`;
  const [row] = await db`insert into staff(display_name,email,role,auth_user_id) values(${`TEST Skip ${role}`},${email},${role},${authUserId}) returning id,display_name,email,role`;
  return { authUserId, staff: row as StaffSession["staff"] };
}

async function newClient(assigned: string) {
  return db.begin(tx => insertClient(tx, {
    source: "staff_manual", profile: ProfileSchema.parse({ full_name: `TEST Skip ${++phone}`, phone: `313555${phone}`, employment_history: [] }),
    primary: [], backup: [], status: "new_intake", nextStep: null, assignedStaff: assigned, createdBy: assigned, communicationConsent: false,
  }, { staffId: assigned, traceId: trace }));
}

function call(as: StaffSession, body: Record<string, unknown>) {
  vi.mocked(staffGuard).mockResolvedValue({ session: as, response: null });
  return operate(new Request("http://localhost/api/staff/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

beforeAll(async () => {
  manager = await member("manager");
  staffOnly = await member("staff");
});
afterAll(async () => { await db.end(); });

describe("authorized stage skip", () => {
  it("keeps the canonical path gated and moves a new file to Job Ready only through a recorded skip", async () => {
    const client = await newClient(manager.staff.id);
    const gated = await call(manager, { operation: "bulk_assign", client_ids: [client.id], target_stage: "job_ready", reason: "Move forward" });
    expect(gated.status).toBe(409);
    expect((await db`select current_status from clients where id=${client.id}`)[0].current_status).toBe("new_intake");

    const shortReason = await call(manager, { operation: "bulk_assign", client_ids: [client.id], target_stage: "job_ready", reason: "too short", override: true });
    expect(shortReason.status).toBe(400);

    const res = await call(manager, { operation: "bulk_assign", client_ids: [client.id], target_stage: "job_ready", reason: "Documents verified in person at the office", override: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, changed: 1, overridden: true });
    const [row] = await db`select current_status,pipeline_stage from clients where id=${client.id}`;
    expect(row).toEqual({ current_status: "shift_selected", pipeline_stage: "amazon_account_waiting_job" });
    const [log] = await db`select staff_id,old_value,new_value from activity_log where client_id=${client.id} and action='status_overridden'`;
    expect(log.staff_id).toBe(manager.staff.id);
    expect(log.old_value).toMatchObject({ status: "new_intake" });
    expect(log.new_value).toMatchObject({ status: "shift_selected", target_stage: "job_ready", reason: "Documents verified in person at the office", skipped_prerequisites: true });
    // The override flag is transaction-scoped: a later plain illegal transition is still rejected.
    await expect(db`update clients set current_status='i9_available' where id=${client.id}`).rejects.toThrow(/invalid_status_transition/);
  });

  it("refuses staff without management, more than one file, Appointments without a booking, and closing a file", async () => {
    const a = await newClient(manager.staff.id);
    const b = await newClient(manager.staff.id);
    const reason = "Manager decision recorded for audit";
    expect((await call(staffOnly, { operation: "bulk_assign", client_ids: [a.id], target_stage: "job_ready", reason, override: true })).status).toBe(403);
    expect((await call(manager, { operation: "bulk_assign", client_ids: [a.id, b.id], target_stage: "job_ready", reason, override: true })).status).toBe(400);
    const appointments = await call(manager, { operation: "bulk_assign", client_ids: [a.id], target_stage: "appointments", reason, override: true });
    expect(appointments.status).toBe(409);
    expect((await appointments.json()).error.code).toBe("override_requires_booking");
    const completed = await call(manager, { operation: "bulk_assign", client_ids: [a.id], target_stage: "completed", reason, override: true });
    expect(completed.status).toBe(409);
    expect((await completed.json()).error.code).toBe("completion_not_overridable");
    const rows = await db`select current_status from clients where id = any(${[a.id, b.id]})`;
    expect(rows.every(r => r.current_status === "new_intake")).toBe(true);
    expect(await db`select id from activity_log where client_id = any(${[a.id, b.id]}) and action='status_overridden'`).toHaveLength(0);
  });
});
