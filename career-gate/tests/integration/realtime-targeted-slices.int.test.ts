import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { StaffSession } from "@/lib/auth";
import { CLIENT_FILE_SLICES, clientFile, clientFileSlices, parseClientFileSlices } from "@/lib/queries";
import { payloadsForResources, RESOURCE_PAYLOADS, RESOURCES } from "@/lib/realtime-resources";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";

/**
 * The scoped read behind a targeted realtime update.
 *
 * Proven against the real schema through the same functions the API route
 * calls: a targeted refetch must return exactly the page's own values for the
 * slices it asked for, and nothing else. Synthetic data only.
 */

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
const trace = "realtime-slices-int";

let manager: StaffSession;
let clientId: string;
// A range of its own: the integration suites share one database.
let phoneSequence = 8300;
const nextPhone = () => `313555${String(++phoneSequence).padStart(4, "0")}`;

async function makeStaff(key: string, role: "admin" | "manager" | "staff"): Promise<StaffSession> {
  const authUserId = randomUUID();
  await db`insert into auth.users (id,email) values (${authUserId},${`${key}@test.invalid`})`;
  const [staff] = await db`
    insert into staff (display_name,email,role,auth_user_id,active)
    values (${`TEST ${key}`},${`${key}@test.invalid`},${role},${authUserId},true)
    returning id,display_name,email,role`;
  return { authUserId, staff: staff as StaffSession["staff"] };
}

beforeAll(async () => {
  manager = await makeStaff("slices-manager", "manager");
  const client = await db.begin((tx) =>
    insertClient(tx, {
      source: "staff_manual",
      profile: ProfileSchema.parse({ full_name: "Synthetic Slice Client", phone: nextPhone(), email: null, date_of_birth: "1990-04-05", employment_history: [] }),
      primary: [], backup: [], status: "new_intake" as never, nextStep: null,
      assignedStaff: manager.staff.id, createdBy: null, communicationConsent: true,
    }, { staffId: null, traceId: trace }));
  clientId = String((client as { id: string }).id);
  await db`insert into notes (client_id,staff_id,note) values (${clientId},${manager.staff.id},'synthetic slice note')`;
  await db`insert into tasks (client_id,title,status,created_by) values (${clientId},'Synthetic slice task','pending',${manager.staff.id})`;
});

afterAll(async () => {
  await db.end();
});

describe("scoped slice reads", () => {
  it("returns only the slices asked for", async () => {
    const out = await clientFileSlices(manager, clientId, ["tasks"]);
    expect(Object.keys(out ?? {})).toEqual(["tasks"]);
    expect((out?.tasks ?? []).length).toBe(1);
  });

  it("returns the same values the full client file renders", async () => {
    const full = await clientFile(manager, clientId);
    const scoped = await clientFileSlices(manager, clientId, ["tasks", "notes", "client"]);
    expect(scoped).not.toBeNull();
    expect(scoped?.tasks).toEqual(full?.tasks);
    expect(scoped?.notes).toEqual(full?.notes);
    expect(scoped?.client).toEqual(full?.client);
  });

  it("reads every declared slice without error", async () => {
    const out = await clientFileSlices(manager, clientId, CLIENT_FILE_SLICES);
    expect(Object.keys(out ?? {}).sort()).toEqual([...CLIENT_FILE_SLICES].sort());
  });

  it("reports a missing client as not found, never as empty slices", async () => {
    const absent = await clientFileSlices(manager, randomUUID(), ["tasks"]);
    expect(absent).toBeNull();
    const absentWithClient = await clientFileSlices(manager, randomUUID(), ["client"]);
    expect(absentWithClient).toBeNull();
  });

  it("returns an empty result for an empty request", async () => {
    expect(await clientFileSlices(manager, clientId, [])).toEqual({});
  });

  it("drops unknown slice names instead of failing the request", () => {
    expect(parseClientFileSlices(["tasks", "pg_shadow", "", "tasks"])).toEqual(["tasks"]);
    expect(parseClientFileSlices(["drop table clients"])).toEqual([]);
  });

  it("resolves every resource payload to a readable slice or a derived payload", async () => {
    // Anything the graph can ask for must be answerable, or a targeted update
    // would degrade into a route refresh at runtime.
    const derived = new Set(["requirements", "nextAction", "account"]);
    for (const resource of RESOURCES) {
      for (const payload of RESOURCE_PAYLOADS[resource]) {
        if (derived.has(payload)) continue;
        expect(parseClientFileSlices([payload]), `${resource} -> ${payload}`).toEqual([payload]);
      }
    }
  });

  it("reads the whole payload set for a document review in one scoped call", async () => {
    const payloads = payloadsForResources(["documents", "readiness", "next_action", "activity"]);
    const slices = parseClientFileSlices(payloads);
    const out = await clientFileSlices(manager, clientId, slices);
    expect(out).not.toBeNull();
    expect(Object.keys(out ?? {}).sort()).toEqual([...slices].sort());
  });
});

describe("scope enforcement", () => {
  it("hides a client outside an assigned staff member's scope", async () => {
    // RLS, not the graph, decides what a staff member may read. A scoped
    // refetch must not become a way around it.
    const other = await makeStaff("slices-other-staff", "staff");
    const out = await clientFileSlices(other, clientId, ["client", "notes"]);
    expect(out).toBeNull();
  });
});
