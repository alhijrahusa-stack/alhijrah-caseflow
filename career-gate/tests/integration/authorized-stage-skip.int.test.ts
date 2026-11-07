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

describe("direct manual workflow routing", () => {
  it("routes every stage without a required reason or supporting evidence and permits reopening", async () => {
    const client = await newClient(staffOnly.staff.id);
    const stages = [
      ["job_ready", "shift_selected"], ["appointments", "appointment_scheduled"],
      ["paperwork_pending", "screening_pending"], ["payment_required", "pre_hire_completed"],
      ["completed", "completed"], ["account_setup", "ready_to_apply"], ["new_intake", "new_intake"],
    ];
    for (const [target_stage, status] of stages) {
      const response = await call(staffOnly, { operation: "bulk_assign", client_ids: [client.id], target_stage });
      expect(response.status, await response.clone().text()).toBe(200);
      expect((await db`select current_status from clients where id=${client.id}`)[0].current_status).toBe(status);
    }
    expect(await db`select id from appointments where client_id=${client.id}`).toHaveLength(0);
    expect(await db`select appointment_id from appointment_outcomes where client_id=${client.id}`).toHaveLength(0);
    expect(await db`select id from payment_transactions where client_id=${client.id}`).toHaveLength(0);
    const logs = await db`select staff_id,new_value from activity_log where client_id=${client.id} and action='status_overridden'`;
    expect(logs).toHaveLength(stages.length);
    expect(logs.every(log => log.staff_id === staffOnly.staff.id && log.new_value.reason === "Direct workflow move")).toBe(true);
    await expect(db`update clients set current_status='i9_available' where id=${client.id}`).rejects.toThrow(/invalid_status_transition/);
  });

  it("keeps staff within their assigned files and prevents ownership changes", async () => {
    const owned = await newClient(staffOnly.staff.id);
    const other = await newClient(manager.staff.id);
    expect((await call(staffOnly, { operation: "bulk_assign", client_ids: [other.id], target_stage: "job_ready" })).status).toBe(404);
    expect((await call(staffOnly, { operation: "bulk_assign", client_ids: [owned.id], target_stage: "job_ready", staff_id: null })).status).toBe(403);
    // A mixed inaccessible batch commits no partial moves.
    expect((await call(staffOnly, { operation: "bulk_assign", client_ids: [owned.id, other.id], target_stage: "completed" })).status).toBe(404);
    expect((await db`select current_status from clients where id=${owned.id}`)[0].current_status).toBe("new_intake");
    const response = await call(manager, { operation: "bulk_assign", client_ids: [owned.id, other.id], target_stage: "completed", reason: "" });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, changed: 2 });
    const repeated = await call(manager, { operation: "bulk_assign", client_ids: [owned.id, other.id], target_stage: "completed" });
    expect(await repeated.json()).toMatchObject({ ok: true, changed: 0 });
  });
});
