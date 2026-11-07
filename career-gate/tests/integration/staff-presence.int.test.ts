import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/staff/presence/route";
import { withStaff, type StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";
import { staffGuard } from "@/lib/staff-api";
import { recordStaffPresence, teamPresenceRoster } from "@/lib/staff-presence";

// Authentication alone is adapted. API validation, SQL and RLS remain real.
vi.mock("@/lib/staff-api", () => ({ staffGuard: vi.fn() }));
const db = sql();
let owner: StaffSession;
let colleague: StaffSession;
let manager: StaffSession;
let ownClient: { id: string; ref: string };
let colleagueClient: { id: string; ref: string };

async function employee(role: "staff" | "manager", label: string): Promise<StaffSession> {
  const authUserId = randomUUID();
  const email = `presence-${authUserId}@test.invalid`;
  await db`insert into auth.users(id,email) values(${authUserId},${email})`;
  const [staff] = await db`insert into staff(display_name,email,role,auth_user_id)
    values(${`TEST Presence ${label}`},${email},${role},${authUserId}) returning id,display_name,email,role`;
  return { authUserId, staff: staff as StaffSession["staff"] };
}
async function client(assigned: string) {
  return db.begin(tx => insertClient(tx, {
    source: "staff_manual", profile: ProfileSchema.parse({ full_name: `TEST Presence Client ${randomUUID()}`, phone: "7345558891", employment_history: [] }),
    primary: [], backup: [], status: "new_intake", nextStep: null, assignedStaff: assigned,
    createdBy: manager.staff.id, communicationConsent: false,
  }, { staffId: manager.staff.id, traceId: "presence-integration" }));
}
function request(as: StaffSession, body?: Record<string, unknown>, query = "") {
  vi.mocked(staffGuard).mockResolvedValue({ session: as, response: null });
  return new Request(`https://career-gate.test/api/staff/presence${query}`, {
    method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
beforeAll(async () => {
  owner = await employee("staff", "Owner"); colleague = await employee("staff", "Colleague"); manager = await employee("manager", "Manager");
  ownClient = await client(owner.staff.id); colleagueClient = await client(colleague.staff.id);
});
afterAll(async () => { await db.end(); });

describe("staff viewing presence authorization and durable state", () => {
  it("derives identity from authentication, ignores supplied identities and timestamps, and persists a safe Clients subtab", async () => {
    const before = Date.now();
    const response = await POST(request(owner, {
      path: "/staff/clients", workspace_section: "urgent", state: "active", visible: true,
      staff_id: colleague.staff.id, auth_user_id: colleague.authUserId, seen_at: "1999-01-01T00:00:00Z",
    }));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const [row] = await db`select * from staff_presence where staff_id=${owner.staff.id}`;
    expect(row).toMatchObject({ auth_user_id: owner.authUserId, path: "/staff/clients", workspace_section: "urgent", state: "active", visible: true });
    expect(new Date(row.seen_at).getTime()).toBeGreaterThanOrEqual(before - 1_000);
    expect((await db`select * from staff_presence where staff_id=${colleague.staff.id}`)).toHaveLength(0);
  });

  it("keeps the team roster manager-only while staff RLS reveals only their own durable row", async () => {
    await recordStaffPresence(colleague, { path: "/staff/appointments", state: "idle", visible: false });
    expect((await GET(request(owner))).status).toBe(403);
    await expect(teamPresenceRoster(owner)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(await withStaff(owner, tx => tx`select staff_id from staff_presence where staff_id=${colleague.staff.id}`)).toHaveLength(0);
    const response = await GET(request(manager));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.members).toEqual(expect.arrayContaining([expect.objectContaining({ staff_id: owner.staff.id }), expect.objectContaining({ staff_id: colleague.staff.id })]));
  });

  it("rejects forged staff/auth bindings and grants no employee or manager deletion permission", async () => {
    await expect(withStaff(owner, tx => tx`update staff_presence set auth_user_id=${colleague.authUserId} where staff_id=${owner.staff.id}`)).rejects.toMatchObject({ code: "42501" });
    await expect(withStaff(owner, tx => tx`insert into staff_presence(staff_id,auth_user_id,path,state,visible)
      values(${manager.staff.id},${owner.authUserId},'/staff','active',true)`)).rejects.toMatchObject({ code: "42501" });
    const updated = await withStaff(manager, tx => tx`update staff_presence set path='/staff/tasks' where staff_id=${owner.staff.id} returning staff_id`);
    expect(updated).toHaveLength(0);
    await expect(withStaff(manager, tx => tx`delete from staff_presence where staff_id=${owner.staff.id}`)).rejects.toMatchObject({ code: "42501" });
    expect((await db`select path from staff_presence where staff_id=${owner.staff.id}`)[0].path).toBe("/staff/clients");
  });

  it("rejects unsafe paths and fabricated sections at both API and database boundaries", async () => {
    for (const path of ["https://example.com", "/staff/clients?name=private", "/staff/../settings"]) {
      expect((await POST(request(owner, { path, state: "active", visible: true }))).status).toBe(400);
    }
    expect((await POST(request(owner, { path: "/staff/clients", workspace_section: "arbitrary", state: "active", visible: true }))).status).toBe(400);
    await expect(withStaff(owner, tx => tx`update staff_presence set path='/staff/clients?stage=urgent' where staff_id=${owner.staff.id}`)).rejects.toMatchObject({ code: "23514" });
    await expect(withStaff(owner, tx => tx`update staff_presence set path='/staff/tasks',workspace_section='urgent' where staff_id=${owner.staff.id}`)).rejects.toMatchObject({ code: "23514" });
  });

  it("validates opened client scope and prevents independent client identifier spoofing", async () => {
    await expect(recordStaffPresence(owner, { path: `/staff/client/${colleagueClient.id}`, state: "active", visible: true })).rejects.toMatchObject({ code: "not_found", status: 404 });
    await recordStaffPresence(owner, { path: `/staff/client/${ownClient.id}`, state: "active", visible: true });
    const [row] = await db`select active_client_id,path,workspace_section from staff_presence where staff_id=${owner.staff.id}`;
    expect(row).toMatchObject({ active_client_id: ownClient.id, path: `/staff/client/${ownClient.id}`, workspace_section: null });
    await expect(withStaff(owner, tx => tx`update staff_presence set active_client_id=${colleagueClient.id} where staff_id=${owner.staff.id}`)).rejects.toMatchObject({ code: "42501" });
  });

  it("bounds client labels to validated UUIDs and resolves names through manager RLS", async () => {
    expect((await GET(request(manager, undefined, "?clients=invalid"))).status).toBe(400);
    const response = await GET(request(manager, undefined, `?clients=${ownClient.id},${colleagueClient.id}`));
    expect(response.status).toBe(200);
    expect((await response.json()).clients).toEqual(expect.arrayContaining([expect.objectContaining({ id: ownClient.id, ref: ownClient.ref }), expect.objectContaining({ id: colleagueClient.id, ref: colleagueClient.ref })]));
    expect((await GET(request(owner, undefined, `?clients=${colleagueClient.id}`))).status).toBe(403);
  });
});
