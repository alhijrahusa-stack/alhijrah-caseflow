import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as action } from "@/app/api/staff/action/route";
import { activePipelineData } from "@/lib/operational-pipeline";
import { type StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { AMAZON_LOCATIONS } from "@/lib/location-shift-options";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";
import { staffGuard } from "@/lib/staff-api";

// Only the HTTP session adapter is a fixture: authorization, the action, its SQL,
// the dispatcher trigger and RLS run for real against the migrated database.
vi.mock("@/lib/staff-api", async (original) => ({ ...(await original<typeof import("@/lib/staff-api")>()), staffGuard: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const db = sql();
const trace = "quick-location";
let manager: StaffSession;
let staffOnly: StaffSession;
let phone = 8100;

async function member(role: "manager" | "staff") {
  const authUserId = randomUUID();
  const email = `qle-${role}-${authUserId}@test.invalid`;
  await db`insert into auth.users(id,email) values(${authUserId},${email})`;
  const [row] = await db`insert into staff(display_name,email,role,auth_user_id,permission_mode) values(${`TEST QLE ${role}`},${email},${role},${authUserId},'full') returning id,display_name,email,role`;
  return { authUserId, staff: row as StaffSession["staff"] };
}

async function newClient(assigned: string) {
  return db.begin(tx => insertClient(tx, {
    source: "staff_manual", profile: ProfileSchema.parse({ full_name: `TEST QLE ${++phone}`, phone: `313555${phone}`, employment_history: [] }),
    primary: [], backup: [], status: "new_intake", nextStep: null, assignedStaff: assigned, createdBy: assigned, communicationConsent: false,
  }, { staffId: assigned, traceId: trace }));
}

async function call(as: StaffSession, body: Record<string, unknown>) {
  vi.mocked(staffGuard).mockResolvedValue({ session: as, response: null });
  const res = await action(new Request("http://localhost/api/staff/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_preferred_location", ...body }) }));
  return { status: res.status, json: await res.json() };
}

const primaryOf = async (clientId: string) =>
  (await db`select site_code,site_name,site_address,city,shift_code,hours,auto_dispatched_at from client_preferences where client_id=${clientId} and rank='primary'`)[0];

beforeAll(async () => {
  manager = await member("manager");
  staffOnly = await member("staff");
});
afterAll(async () => { await db.end(); });

describe("quick preferred-location change", () => {
  it("creates the primary preference when none exists, and requires a shift for it", async () => {
    const client = await newClient(manager.staff.id);
    const noShift = await call(manager, { client_id: client.id, location: 1, expected_site_code: null });
    expect(noShift.status).toBe(400);
    expect(noShift.json.error.code).toBe("shift_required");

    const res = await call(manager, { client_id: client.id, location: 1, expected_site_code: null, shift: "night" });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json).toMatchObject({ ok: true, changed: true, site_code: "MI_LOC_02", site_name: AMAZON_LOCATIONS[1][0] });
    expect(await primaryOf(client.id)).toMatchObject({ site_code: "MI_LOC_02", site_name: "Romulus (DTW3)", city: "Romulus", shift_code: "night", hours: "06:30 PM – 05:00 AM" });
    expect((await db`select preferred_location from clients where id=${client.id}`)[0].preferred_location).toBe("Romulus (DTW3)");
  });

  it("moves the existing primary site, keeps its shift, re-dispatches it, shows in the pipeline and logs the change", async () => {
    const client = await newClient(manager.staff.id);
    await call(manager, { client_id: client.id, location: 0, expected_site_code: null, shift: "morning" });
    const before = await primaryOf(client.id);

    const res = await call(manager, { client_id: client.id, location: 2, expected_site_code: "MI_LOC_01" });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const after = await primaryOf(client.id);
    expect(after).toMatchObject({ site_code: "MI_LOC_03", site_name: "Lansing", site_address: AMAZON_LOCATIONS[2][1], shift_code: "morning", hours: before.hours });
    expect(new Date(after.auto_dispatched_at).getTime()).toBeGreaterThanOrEqual(new Date(before.auto_dispatched_at).getTime());
    expect((await db`select preferred_location from clients where id=${client.id}`)[0].preferred_location).toBe("Lansing");

    const board = await activePipelineData(manager);
    expect(board.clients.find(c => c.id === client.id)).toMatchObject({ site_code: "MI_LOC_03", site_name: "Lansing" });

    const logs = await db`select staff_id,old_value,new_value from activity_log where client_id=${client.id} and action='client_updated' order by created_at`;
    expect(logs.at(-1)).toMatchObject({
      staff_id: manager.staff.id,
      old_value: { preferred_location: "Romulus", site: "MI_LOC_01" },
      new_value: { preferred_location: "Lansing", site: "MI_LOC_03" },
    });

    const again = await call(manager, { client_id: client.id, location: 2, expected_site_code: "MI_LOC_03" });
    expect(again.json).toMatchObject({ ok: true, changed: false });
  });

  it("refuses a stale editor, a clash with a backup preference, and staff without management", async () => {
    const client = await newClient(staffOnly.staff.id);
    await call(manager, { client_id: client.id, location: 3, expected_site_code: null, shift: "night" });

    const stale = await call(manager, { client_id: client.id, location: 4, expected_site_code: null });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("stale_location");

    await db`insert into client_preferences(client_id,rank,preference_order,city,site_code,site_name,site_address,job_id,job_title,shift_code,catalog_source)
      values(${client.id},'backup',2,'Caledonia','MI_LOC_05','Caledonia (GRR5)','x','PREFERENCE','Amazon Associate','night','staff_preference')`;
    const clash = await call(manager, { client_id: client.id, location: 4, expected_site_code: "MI_LOC_04" });
    expect(clash.status).toBe(409);
    expect(clash.json.error.code).toBe("duplicate_preference");

    const denied = await call(staffOnly, { client_id: client.id, location: 5, expected_site_code: "MI_LOC_04" });
    expect(denied.status).toBe(403);
    expect((await primaryOf(client.id)).site_code).toBe("MI_LOC_04");
  });

  it("rejects a location outside the directory", async () => {
    const client = await newClient(manager.staff.id);
    const res = await call(manager, { client_id: client.id, location: AMAZON_LOCATIONS.length, expected_site_code: null, shift: "night" });
    expect(res.status).toBe(400);
  });
});

describe("location & shift assignment card (/api/staff/client-preference)", () => {
  it("is limited to managers and admins, as every other preference change is", async () => {
    const { POST: assign } = await import("@/app/api/staff/client-preference/route");
    const post = (as: StaffSession, body: Record<string, unknown>) => {
      vi.mocked(staffGuard).mockResolvedValue({ session: as, response: null });
      return assign(new Request("http://localhost/api/staff/client-preference", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    };
    // Assigned to the staff member, so RLS alone would let them write it.
    const client = await newClient(staffOnly.staff.id);
    const body = { client_id: client.id, location: 2, shift: "night", days: "custom", hours: "06:30 PM – 05:00 AM" };
    const denied = await post(staffOnly, body);
    expect(denied.status).toBe(403);
    expect(await primaryOf(client.id)).toBeUndefined();
    const [event] = await db`select event from security_events where staff_id=${staffOnly.staff.id} and route='/api/staff/client-preference'`;
    expect(event.event).toBe("access_denied");

    const allowed = await post(manager, body);
    expect(allowed.status).toBe(200);
    expect(await primaryOf(client.id)).toMatchObject({ site_code: "MI_LOC_03", shift_code: "night" });
  });
});
