import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ActionSchema, runAction } from "@/lib/actions";
import { runAudit } from "@/lib/audit";
import { withStaff, type StaffSession } from "@/lib/auth";
import { reconcileAccount, lockAccount } from "@/lib/accounting-ledger";
import { POST_HIRE_ITEMS } from "@/lib/domain";
import { operationalClientList } from "@/lib/operational-clients";
import { appointmentPage } from "@/lib/queries";
import { executiveSummary } from "@/lib/executive-summary";
import { otpHash } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { processDocument } from "@/lib/doc-intel";
import { saveDocument } from "@/lib/documents";
import { claimKey, completeKey } from "@/lib/idempotency";
import { enqueue, processJobs, registerHandler } from "@/lib/jobs";
import { queueSubmissionNotifications } from "@/lib/notify";
import { queueAdvanceAppointmentReminders, queueAppointmentEmails, appointmentEmailIdempotencyKey } from "@/lib/appointment-email";
import { AMAZON_INTERVIEW_SITES, warehouseLocation } from "@/lib/amazon-interview-sites";
import { publicStatus } from "@/lib/public-status";
import { ProfileSchema } from "@/lib/schemas";
import { suggestSlots } from "@/lib/scheduling";
import { queueEmbedding } from "@/lib/semantic";
import { ActionError, insertClient } from "@/lib/service";
import { sessionClient, startLookup, verifyCode } from "@/lib/status-access";

const db = sql();
const trace = "int-test";
type Role = "admin" | "manager" | "staff";
const sessions: Record<string, StaffSession> = {};
let clientPhoneSequence = 1000;
const nextClientPhone = () => `313555${String(++clientPhoneSequence).padStart(4, "0")}`;
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000004000000040802000000269309290000000970485973000003e8000003e801b57b526b0000000f49444154089963f88f041888e30000db902fd1ecba04730000000049454e44ae426082",
  "hex",
);

async function makeStaff(key: string, role: Role) {
  const authId = randomUUID();
  await db`insert into auth.users (id, email) values (${authId}, ${`${key}@test.invalid`})`;
  const [s] = await db`insert into staff (display_name, email, role, auth_user_id) values (${`TEST ${key}`}, ${`${key}@test.invalid`}, ${role}, ${authId}) returning id, display_name, email, role`;
  sessions[key] = { authUserId: authId, staff: s as StaffSession["staff"] };
}

async function makeClient(name: string, opts: { assigned?: string; status?: string; email?: string | null } = {}) {
  return db.begin((tx) =>
    insertClient(tx, {
      source: "staff_manual",
      profile: ProfileSchema.parse({ full_name: name, phone: nextClientPhone(), email: opts.email === undefined ? `${name.replace(/\W/g, "").toLowerCase()}@test.invalid` : opts.email, date_of_birth: "1990-04-05", employment_history: [] }),
      primary: [], backup: [], status: (opts.status ?? "new_intake") as never, nextStep: null,
      assignedStaff: opts.assigned ?? null, createdBy: null, communicationConsent: true,
    }, { staffId: null, traceId: trace }));
}

const act = (key: string, a: Parameters<typeof runAction>[1]) =>
  withStaff(sessions[key], async (tx) => {
    const semantic: { source: "note" | "task" | "contact" | "followup"; id: string }[] = [];
    const r = await runAction({ tx, actor: { staffId: sessions[key].staff.id, traceId: trace }, role: sessions[key].staff.role, semantic }, a);
    for (const s of semantic) await queueEmbedding(tx, s.source, s.id, trace);
    return r;
  });

let A: { id: string; ref: string };
let B: { id: string; ref: string };

beforeAll(async () => {
  await makeStaff("admin", "admin");
  await makeStaff("manager", "manager");
  await makeStaff("staff1", "staff");
  await makeStaff("staff2", "staff");
  A = await makeClient("TEST Alpha Client", { assigned: sessions.staff1.staff.id });
  B = await makeClient("TEST Beta Client");
});

afterAll(async () => {
  await db.end();
});

describe("row-level security (as authenticated role)", () => {
  it("persists and audits English edits, preserves omitted values, and enforces RLS", async () => {
    const client = await makeClient("TEST English Profile", { assigned: sessions.staff1.staff.id });
    const profile = { full_name: "TEST English Profile", phone: (await db`select phone from clients where id=${client.id}`)[0].phone };
    const update = (value: Record<string, unknown>) => ActionSchema.parse({ action: "update_client", client_id: client.id, profile: { ...profile, ...value } });
    await act("staff1", update({ english_proficiency: "GOOD" }));
    await act("staff1", update({ city: "Detroit" }));
    expect((await db`select english_proficiency from clients where id=${client.id}`)[0].english_proficiency).toBe("GOOD");
    await expect(act("staff2", update({ english_proficiency: "NONE" }))).rejects.toThrow();
    await act("staff1", ActionSchema.parse({ action: "patch_client", client_id: client.id, field: "english_proficiency", value: "FAIR" }));
    expect((await db`select english_proficiency from clients where id=${client.id}`)[0].english_proficiency).toBe("FAIR");
    const logs = await db`select old_value,new_value from activity_log where client_id=${client.id} and new_value ? 'english_proficiency' order by created_at`;
    expect(logs.map((r) => r.new_value.english_proficiency)).toEqual(["GOOD", "FAIR"]);
    await expect(act("staff1", { action: "patch_client", client_id: client.id, field: "english_proficiency", value: "invented" })).rejects.toMatchObject({ code: "invalid_input" });
    await act("staff1", update({ english_proficiency: null }));
    expect((await db`select english_proficiency from clients where id=${client.id}`)[0].english_proficiency).toBeNull();
  });

  const visible = async (key: string) => (await withStaff(sessions[key], (tx) => tx`select id from clients where id in (${A.id}, ${B.id})`)).map((r) => r.id).sort();

  it("staff sees only assigned clients; manager and admin see all", async () => {
    expect(await visible("staff1")).toEqual([A.id]);
    expect(await visible("staff2")).toEqual([]);
    expect((await visible("manager")).length).toBe(2);
    expect((await visible("admin")).length).toBe(2);
  });

  it("managers create clients through RLS (INSERT … RETURNING sees the new row); staff cannot", async () => {
    const r = await act("manager", { action: "create_client", profile: ProfileSchema.parse({ full_name: "TEST RLS Create", phone: "3135550100", employment_history: [] }), primary: [], backup: [], status: "new_intake", next_step: null, initial_note: "TEST first note", assigned_staff: null, communication_consent: false });
    expect(r.ref).toMatch(/^CG-\d{4}-\d{6}$/);
    await expect(withStaff(sessions.staff1, (tx) => tx`insert into clients (source, full_name, phone, next_step) values ('staff_manual', 'X', '3135550100', 'x')`)).rejects.toMatchObject({ code: "42501" });
  });

  it("staff cannot write to an unassigned client's records", async () => {
    await expect(withStaff(sessions.staff1, (tx) => tx`insert into notes (client_id, note, staff_id) values (${B.id}, 'x', ${sessions.staff1.staff.id})`)).rejects.toMatchObject({ code: "42501" });
  });

  it("anon has no table access", async () => {
    await expect(db.begin(async (tx) => { await tx.unsafe("set local role anon"); return tx`select 1 from clients limit 1`; })).rejects.toMatchObject({ code: "42501" });
  });

  it("server-only tables are invisible to staff", async () => {
    const rows = await withStaff(sessions.admin, (tx) => tx`select count(*)::int as n from otp_requests`).catch((e) => e);
    expect(rows).toMatchObject({ code: "42501" });
  });

  it("soft-deleted clients are hidden from managers but not admins", async () => {
    const C = await makeClient("TEST Deleted Client");
    await act("admin", { action: "soft_delete_client", client_id: C.id, reason: "test" });
    const m = await withStaff(sessions.manager, (tx) => tx`select id from clients where id = ${C.id}`);
    const a = await withStaff(sessions.admin, (tx) => tx`select id from clients where id = ${C.id}`);
    expect(m.length).toBe(0);
    expect(a.length).toBe(1);
  });
});

describe("admin bootstrap", () => {
  it("links the configured admin email as admin, links known staff by email, and refuses strangers", async () => {
    const { resolveStaffForAuthUser } = await import("@/lib/auth");
    vi.stubEnv("CAREER_GATE_ADMIN_EMAIL", "boss@test.invalid");
    const bossId = randomUUID();
    await db`insert into auth.users (id, email) values (${bossId}, 'boss@test.invalid')`;
    const created = await resolveStaffForAuthUser({ id: bossId, email: "Boss@test.invalid" });
    const [boss] = await db`select role, auth_user_id from staff where id = ${created}`;
    expect(boss).toMatchObject({ role: "admin", auth_user_id: bossId });

    await db`insert into staff (display_name, email, role) values ('TEST Known', 'known@test.invalid', 'staff')`;
    const knownId = randomUUID();
    await db`insert into auth.users (id, email) values (${knownId}, 'known@test.invalid')`;
    const linked = await resolveStaffForAuthUser({ id: knownId, email: "known@test.invalid" });
    const [known] = await db`select role, auth_user_id from staff where id = ${linked}`;
    expect(known).toMatchObject({ role: "staff", auth_user_id: knownId });

    const strangerId = randomUUID();
    await db`insert into auth.users (id, email) values (${strangerId}, 'stranger@test.invalid')`;
    expect(await resolveStaffForAuthUser({ id: strangerId, email: "stranger@test.invalid" })).toBeNull();
    vi.unstubAllEnvs();
    const otherId = randomUUID();
    await db`insert into auth.users (id, email) values (${otherId}, 'boss2@test.invalid')`;
    expect(await resolveStaffForAuthUser({ id: otherId, email: "boss2@test.invalid" })).toBeNull();
  });
});

describe("status state machine", () => {
  it("rejects invalid transitions in the server and in the database", async () => {
    await expect(act("manager", { action: "update_status", client_id: B.id, status: "completed", next_step: null })).rejects.toBeInstanceOf(ActionError);
    await expect(db`update clients set current_status = 'completed' where id = ${B.id}`).rejects.toMatchObject({ code: "P0001" });
    await expect(db`update clients set current_status = 'bogus' where id = ${B.id}`).rejects.toBeTruthy();
  });

  it("allows valid transitions and logs them", async () => {
    await act("manager", { action: "update_status", client_id: B.id, status: "needs_review", next_step: null });
    const [log] = await db`select action, old_value, new_value from activity_log where client_id = ${B.id} and action = 'status_changed' order by id desc limit 1`;
    expect(log.new_value.status).toBe("needs_review");
  });

  it("admin override needs a reason and is logged as an override", async () => {
    await act("admin", { action: "override_status", client_id: B.id, status: "ready_for_first_day", reason: "Test override", next_step: null });
    const [c] = await db`select current_status from clients where id = ${B.id}`;
    expect(c.current_status).toBe("ready_for_first_day");
    const [log] = await db`select new_value from activity_log where client_id = ${B.id} and action = 'status_overridden'`;
    expect(log.new_value.reason).toBe("Test override");
  });

  it("new clients must start in an entry state", async () => {
    await expect(makeClient("TEST Bad Start", { status: "completed" })).rejects.toMatchObject({ code: "P0001" });
  });
});

describe("scheduling and collision prevention", () => {
  it("stores all eleven Amazon interview locations with canonical FK codes, and retains them after edits", async () => {
    const sites = await db`select code,location_text from amazon_interview_locations where active order by code`;
    expect(sites).toHaveLength(11);
    for (const site of AMAZON_INTERVIEW_SITES) {
      expect(sites.some(record=>record.code===site.code && record.location_text===warehouseLocation(site))).toBe(true);
      const when=new Date(Date.now()+(110+AMAZON_INTERVIEW_SITES.indexOf(site))*86_400_000).toISOString();
      const booked = await act("manager",{
        action:"schedule_appointment",client_id:B.id,appointment_type:"Amazon interview location check",
        scheduled_at:when,duration_minutes:30,resource_key:"office",
        location:warehouseLocation(site),notes:null,approve_booking:true
      });
      const [saved] = await db`select location,location_id from appointments where id=${String(booked.appointment_id)}`;
      expect(saved).toEqual({location:warehouseLocation(site),location_id:site.code});
    }
    const first=AMAZON_INTERVIEW_SITES[0];
    const second=AMAZON_INTERVIEW_SITES[1];
    const [appointment]=await db`select id from appointments where client_id=${B.id} and location_id=${first.code} order by created_at desc limit 1`;
    await act("manager",{action:"update_appointment",appointment_id:String(appointment.id),location:warehouseLocation(second),notes:undefined});
    const [edited]=await db`select location,location_id from appointments where id=${appointment.id}`;
    expect(edited).toEqual({location:warehouseLocation(second),location_id:second.code});
    await act("manager",{action:"update_appointment",appointment_id:String(appointment.id),location:"Career Gate Office",notes:undefined});
    const [cleared]=await db`select location_id from appointments where id=${appointment.id}`;
    expect(cleared.location_id).toBeNull();
  });

  beforeAll(async () => {
    for (let d = 0; d < 7; d++) {
      await act("manager", { action: "upsert_availability", resource_key: "office", weekday: d, start_time: "00:00", end_time: "23:30", slot_minutes: 30, appointment_type: null, active: true });
    }
  });

  it("keeps office slots open for different clients while blocking same-client conflicts", async () => {
    const slots = await suggestSlots(db, { resourceKey: "office", count: 3 });
    expect(slots).toHaveLength(3);
    const s = slots[0];
    await act("manager", { action: "book_slot", client_id: A.id, start: s.start, end: s.end, resource_key: "office", appointment_type: "Test", location: null, notes: null });
    await act("manager", { action: "book_slot", client_id: B.id, start: s.start, end: s.end, resource_key: "office", appointment_type: "Test", location: null, notes: null });
    await expect(act("manager", { action: "book_slot", client_id: A.id, start: s.start, end: s.end, resource_key: "office", appointment_type: "Test", location: null, notes: null }))
      .rejects.toMatchObject({ code: "23P01" });
    const after = await suggestSlots(db, { resourceKey: "office", count: 3 });
    expect(after.map((x) => x.start)).toContain(s.start);
  });

  it("prevents one applicant's overlapping appointments across different staff and resources", async () => {
    const t = new Date(Date.now() + 41 * 86_400_000).toISOString();
    await act("manager", { action: "schedule_appointment", client_id: A.id, appointment_type: "Interview", scheduled_at: t, duration_minutes: 30, resource_key: "office", location: null, notes: null });
    await act("manager", { action: "schedule_appointment", client_id: B.id, appointment_type: "Interview", scheduled_at: t, duration_minutes: 30, resource_key: "office", location: null, notes: null });
    await expect(act("manager", { action: "schedule_appointment", client_id: A.id, appointment_type: "Test", scheduled_at: t, duration_minutes: 30, resource_key: `staff:${sessions.staff2.staff.id}`, location: null, notes: null }))
      .rejects.toMatchObject({ code: "23P01" });
  });

  it("permits two different clients at the same Amazon site and exact time", async () => {
    const site = warehouseLocation(AMAZON_INTERVIEW_SITES[0]);
    const start = new Date(Date.now()+181*86_400_000).toISOString();
    const make = (clientId: string) => act("manager",{
      action:"schedule_appointment",client_id:clientId,appointment_type:"Interview",
      scheduled_at:start,duration_minutes:30,resource_key:"office",location:site,notes:null
    });
    const [a,b]=await Promise.all([make(A.id),make(B.id)]);
    const appointments=await db`select client_id,location_id from appointments where id in (${String(a.appointment_id)},${String(b.appointment_id)})`;
    expect(appointments).toHaveLength(2);
    expect(appointments.map(row=>row.client_id).sort()).toEqual([A.id,B.id].sort());
    expect(appointments.every(row=>row.location_id==="DTW1")).toBe(true);
  });

  it("rejects rescheduling the same client into an overlapping interval without overwriting the appointment", async () => {
    const firstTime = new Date(Date.now()+184*86_400_000).toISOString();
    const nextTime = new Date(Date.now()+185*86_400_000).toISOString();
    const first = await act("manager",{
      action:"schedule_appointment",client_id:A.id,appointment_type:"First",
      scheduled_at:firstTime,duration_minutes:40,resource_key:"office",location:null,notes:null
    });
    const second = await act("manager",{
      action:"schedule_appointment",client_id:A.id,appointment_type:"Second",
      scheduled_at:nextTime,duration_minutes:30,resource_key:"office",location:null,notes:null
    });
    await expect(act("manager",{
      action:"update_appointment",appointment_id:String(second.appointment_id),
      scheduled_at:new Date(new Date(firstTime).getTime()+5*60_000).toISOString(),
      duration_minutes:30,location:undefined,notes:undefined,
    })).rejects.toMatchObject({code:"23P01"});
    const [saved]=await db`select scheduled_at,status from appointments where id=${String(second.appointment_id)}`;
    expect(new Date(saved.scheduled_at).toISOString()).toBe(nextTime);
    expect(saved.status).toBe("scheduled");
    const [original]=await db`select scheduled_at from appointments where id=${String(first.appointment_id)}`;
    expect(new Date(original.scheduled_at).toISOString()).toBe(firstTime);
  });

  it("protects the same client under concurrent overlapping writes", async () => {
    const t = new Date(Date.now() + 44 * 86_400_000).toISOString();
    const results = await Promise.allSettled([
      act("manager", { action: "schedule_appointment", client_id: A.id, appointment_type: "Test", scheduled_at: t, duration_minutes: 30, resource_key: "office", location: null, notes: null }),
      act("manager", { action: "schedule_appointment", client_id: A.id, appointment_type: "Test", scheduled_at: t, duration_minutes: 30, resource_key: `staff:${sessions.staff2.staff.id}`, location: null, notes: null }),
    ]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
    expect((results.find(r=>r.status==="rejected") as PromiseRejectedResult).reason).toMatchObject({code:"23P01"});
  });
});

describe("transactional appointment notification and reminder outbox", () => {
  it("records an approved appointment and queues recipient-aware emails without claiming a send", async () => {
    const client = await makeClient("TEST Notification Profile");
    const instant = new Date(Date.now() + 56 * 86_400_000).toISOString();
    const created = await act("manager", {
      action:"schedule_appointment",client_id:client.id,appointment_type:"Employment interview",
      lifecycle_interview:false,approve_booking:true,scheduled_at:instant,duration_minutes:30,
      resource_key:"office",location:"Romulus (DTW1): Amazon Fulfillment Center - 32801 Ecorse Rd, Romulus, MI 48174",notes:null,
    });
    expect(created.status).toBe("confirmed");
    const createdId = String(created.appointment_id);
    const [appt] = await db`select status,location from appointments where id=${createdId}`;
    expect(appt.status).toBe("confirmed");
    const notifications=await db`select template,payload,status,idempotency_key from notifications where client_id=${client.id} and payload->>'appointmentId'=${createdId}`;
    expect(notifications.some(n=>n.template==="appointment_scheduled" && n.payload.recipientKind==="client")).toBe(true);
    expect(notifications.every(n=>["queued","not_configured"].includes(String(n.status)))).toBe(true);
    expect(notifications.every(n=>n.payload.scheduledAt===instant)).toBe(true);
    expect(notifications.every(n=>typeof n.idempotency_key==="string" && n.idempotency_key.startsWith("appointment:"))).toBe(true);
    const [row]=await db`select id,client_id,scheduled_at,location,appointment_type,resource_key from appointments where id=${createdId}`;
    await withStaff(sessions.manager, tx=>queueAppointmentEmails(tx,{
      id:String(row.id),client_id:String(row.client_id),scheduled_at:new Date(row.scheduled_at),
      location:row.location,appointment_type:String(row.appointment_type),resource_key:String(row.resource_key)
    },"scheduled",trace));
    const [count]=await db`select count(*)::int n from notifications
      where payload->>'appointmentId'=${createdId} and template='appointment_scheduled'`;
    expect(count.n).toBe(notifications.filter(n=>n.template==="appointment_scheduled").length);
    expect(appointmentEmailIdempotencyKey(notifications[0].payload)).toBe(notifications[0].idempotency_key);
    await expect(db`insert into notifications(client_id,channel,template,payload,status,idempotency_key)
      values(${client.id},'email','appointment_scheduled',${db.json(notifications[0].payload)},'queued',${notifications[0].idempotency_key})`)
      .rejects.toMatchObject({code:"23505"});
  });

  it("notifies both applicant and assigned resource, and only calls a real reschedule when the time changes", async () => {
    const client = await makeClient("TEST Appointment Resource");
    const start = new Date(Date.now()+63*86_400_000).toISOString();
    const created = await act("manager", {
      action:"schedule_appointment",client_id:client.id,appointment_type:"Employment interview",
      approve_booking:true,scheduled_at:start,duration_minutes:30,
      resource_key:`staff:${sessions.manager.staff.id}`,location:"DTW1 test address",notes:null,
    });
    const appointmentId=String(created.appointment_id);
    let mail=await db`select template,payload from notifications where client_id=${client.id}
      and payload->>'appointmentId'=${appointmentId}`;
    expect(mail.filter(row=>row.template==="appointment_scheduled")).toHaveLength(2);
    expect(mail.map(row=>row.payload.recipientKind).sort()).toEqual(["client","resource"]);
    await act("manager",{
      action:"update_appointment",appointment_id:appointmentId,
      scheduled_at:start,duration_minutes:30,location:undefined,notes:"Changed instructions",
    });
    let [appt]=await db`select status,notes from appointments where id=${appointmentId}`;
    expect(appt).toMatchObject({status:"confirmed",notes:"Changed instructions"});
    mail=await db`select template,payload from notifications where client_id=${client.id}
      and payload->>'appointmentId'=${appointmentId}`;
    expect(mail.some(row=>row.template==="appointment_updated")).toBe(false);

    await act("manager",{action:"update_appointment",appointment_id:appointmentId,location:"DET1 updated address",notes:undefined});
    [appt]=await db`select status,location from appointments where id=${appointmentId}`;
    expect(appt.status).toBe("confirmed");
    expect(appt.location).toBe("DET1 updated address");
    mail=await db`select template,payload from notifications where client_id=${client.id}
      and payload->>'appointmentId'=${appointmentId}`;
    expect(mail.filter(row=>row.template==="appointment_updated")).toHaveLength(2);
  });

  it("queues one reminder in the next-day window despite repeated daily cron calls", async () => {
    const client = await makeClient("TEST Reminder Profile");
    const when = new Date(Date.now()+36*3_600_000);
    const [appt] = await db`insert into appointments (client_id,appointment_type,scheduled_at,ends_at,resource_key,location,created_by_staff,status)
      values(${client.id},'Office intake',${when},${new Date(when.getTime()+30*60_000)},'office','Office',${sessions.manager.staff.id},'confirmed') returning id`;
    const priorKey=process.env.RESEND_API_KEY;
    const priorFrom=process.env.RESEND_FROM_EMAIL;
    process.env.RESEND_API_KEY="integration-provider-not-contacted";
    process.env.RESEND_FROM_EMAIL="test@example.invalid";
    try {
      expect(await queueAdvanceAppointmentReminders()).toBe(1);
      expect(await queueAdvanceAppointmentReminders()).toBe(0);
      const [count]=await db`select count(*)::int n from notifications
        where template='appointment_reminder' and payload->>'appointmentId'=${appt.id}`;
      expect(count.n).toBe(1);
    } finally {
      if(priorKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=priorKey;
      if(priorFrom===undefined)delete process.env.RESEND_FROM_EMAIL;else process.env.RESEND_FROM_EMAIL=priorFrom;
    }
  });
});

describe("rate limiting", () => {
  it("allows up to the limit per window, then blocks", async () => {
    const key = `test:${randomUUID()}`;
    const results = [];
    for (let i = 0; i < 7; i++) results.push((await db`select public.rate_limit_hit('t', ${key}, 60, 5) as ok`)[0].ok);
    expect(results).toEqual([true, true, true, true, true, false, false]);
  });
});

describe("idempotency", () => {
  it("concurrent requests with one key produce one result", async () => {
    const key = `k-${randomUUID()}`;
    const run = () => db.begin(async (tx) => {
      const c = await claimKey(tx, "test", key, "fp1");
      if (c.kind === "new") {
        await new Promise((r) => setTimeout(r, 200));
        await completeKey(tx, "test", key, 201, { ref: "X" });
      }
      return c.kind;
    });
    const kinds = (await Promise.all([run(), run()])).sort();
    expect(kinds).toEqual(["new", "replay"]);
    const conflict = await db.begin((tx) => claimKey(tx, "test", key, "fp2"));
    expect(conflict.kind).toBe("conflict");
  });
});

describe("job queue", () => {
  it("claims semantic recovery work once and leaves notification delivery untouched", async () => {
    const key = `test-semantic-recovery-${randomUUID()}`;
    const notificationKey = `test-notification-isolation-${randomUUID()}`;
    await enqueue(db, { type: "semantic_embedding", entityId: randomUUID(), payload: { source: "note" }, dedupeKey: key });
    await enqueue(db, { type: "notification_send", entityId: randomUUID(), dedupeKey: notificationKey });
    try {
      const runs = await Promise.all([processJobs(50, { types: ["semantic_embedding"], concurrency: 3 }), processJobs(50, { types: ["semantic_embedding"], concurrency: 3 })]);
      const [semantic] = await db`select id,status,attempts from jobs where dedupe_key=${key}`;
      const [notification] = await db`select status,attempts from jobs where dedupe_key=${notificationKey}`;
      expect(semantic).toMatchObject({ status: "succeeded", attempts: 1 });
      expect(runs.flat().filter(job => job.id === semantic.id)).toHaveLength(1);
      expect(notification).toMatchObject({ status: "queued", attempts: 0 });
    } finally {
      await db`delete from jobs where dedupe_key in (${key},${notificationKey})`;
    }
  });

  it("retries with backoff, then dead-letters after max attempts", async () => {
    await import("@/lib/job-handlers");
    registerHandler("audit_scan", async () => { throw new Error("boom"); });
    await enqueue(db, { type: "audit_scan", dedupeKey: `test-dead-${randomUUID()}`, maxAttempts: 2, payload: { client_id: A.id } });
    await processJobs(50);
    const [j1] = await db`select status, attempts, run_after > now() as later from jobs where type = 'audit_scan' order by created_at desc limit 1`;
    expect(j1).toMatchObject({ status: "queued", attempts: 1, later: true });
    await db`update jobs set run_after = now() where type = 'audit_scan' and status = 'queued'`;
    await processJobs(50);
    const [j2] = await db`select status, attempts, last_error from jobs where type = 'audit_scan' order by created_at desc limit 1`;
    expect(j2).toMatchObject({ status: "dead", attempts: 2, last_error: "boom" });
    registerHandler("audit_scan", async (job) => { await runAudit((job.payload.client_id as string) ?? null, trace); return { status: "succeeded" }; });
  });

  it("reclaims jobs whose visibility timeout lapsed", async () => {
    const key = `test-vis-${randomUUID()}`;
    await enqueue(db, { type: "audit_scan", dedupeKey: key, payload: { client_id: A.id } });
    await db`update jobs set status = 'running', locked_until = now() - interval '1 minute' where dedupe_key = ${key}`;
    await processJobs(50);
    const [j] = await db`select status from jobs where dedupe_key = ${key}`;
    expect(j.status).toBe("succeeded");
  });
});

describe("notifications are truthful", () => {
  it("records NOT_CONFIGURED and queues nothing when no provider is configured", async () => {
    const C = await makeClient("TEST Notify Client");
    const out = await db.begin((tx) => queueSubmissionNotifications(tx, { id: C.id, phone: "3135550100", email: "n@test.invalid", consent: true, payload: { first_name: "Test", ref: C.ref, submitted_at: new Date().toISOString() } }, { staffId: null, traceId: trace }));
    expect(out.map((o) => o.status)).toEqual(["not_configured", "not_configured", "not_configured"]);
    const [{ n }] = await db`select count(*)::int as n from jobs where type = 'notification_send' and entity_id in (select id::text from notifications where client_id = ${C.id})`;
    expect(n).toBe(0);
  });

  it("the database refuses 'sent' without a provider id", async () => {
    await expect(db`insert into notifications (client_id, channel, template, status) values (${A.id}, 'sms', 't', 'sent')`).rejects.toMatchObject({ code: "23514" });
  });

  it("respects missing consent", async () => {
    const out = await db.begin((tx) => queueSubmissionNotifications(tx, { id: A.id, phone: "3135550100", email: null, consent: false, payload: { first_name: "T", ref: A.ref, submitted_at: new Date().toISOString() } }, { staffId: null, traceId: trace }));
    expect(out).toEqual([]);
  });
});

describe("OTP status access", () => {
  const seed = async (clientId: string, code: string, opts: { expired?: boolean } = {}) => {
    const [r] = await db`insert into otp_requests (client_id, contact_type, delivery_status, expires_at)
      values (${clientId}, 'email', 'sent', ${new Date(Date.now() + (opts.expired ? -1000 : 300_000))}) returning id`;
    await db`update otp_requests set otp_hash = ${otpHash(r.id, code)} where id = ${r.id}`;
    return r.id as string;
  };

  it("lookup responds the same way for match and no match; nothing is sent without a provider", async () => {
    const miss = await startLookup("CG-1999-000000", "iphash", trace);
    const hit = await startLookup(A.ref, "iphash", trace);
    expect(miss.delivery).toBe("no_match");
    expect(hit.delivery).toBe("not_configured");
    const [row] = await db`select otp_hash from otp_requests where id = ${hit.challengeId}`;
    expect(row.otp_hash).toBeNull();
    expect((await verifyCode(hit.challengeId, "000000", "iphash", trace)).ok).toBe(false);
  });

  it("locks after 3 wrong codes (even for the right code)", async () => {
    const id = await seed(A.id, "123456");
    expect(await verifyCode(id, "111111", "i", trace)).toEqual({ ok: false, code: "invalid" });
    expect(await verifyCode(id, "222222", "i", trace)).toEqual({ ok: false, code: "invalid" });
    expect(await verifyCode(id, "333333", "i", trace)).toEqual({ ok: false, code: "locked" });
    expect(await verifyCode(id, "123456", "i", trace)).toEqual({ ok: false, code: "locked" });
  });

  it("expired codes fail", async () => {
    const id = await seed(A.id, "123456", { expired: true });
    expect(await verifyCode(id, "123456", "i", trace)).toEqual({ ok: false, code: "expired" });
  });

  it("a correct code creates a session bound to that client; codes cannot be replayed", async () => {
    const id = await seed(A.id, "654321");
    const r = await verifyCode(id, "654321", "i", trace);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ref).toBe(A.ref);
    expect(await sessionClient(A.ref, r.token)).toBe(A.id);
    expect(await sessionClient(B.ref, r.token)).toBeNull();
    expect((await verifyCode(id, "654321", "i", trace)).ok).toBe(false);
    const [s] = await db`select token_hash from status_sessions where client_id = ${A.id} order by created_at desc limit 1`;
    expect(s.token_hash).not.toBe(r.token);
    await db`update status_sessions set expires_at = now() - interval '1 second' where client_id = ${A.id}`;
    expect(await sessionClient(A.ref, r.token)).toBeNull();
  });

  it("the public projection exposes only public-safe fields", async () => {
    const s = await publicStatus(A.id);
    expect(Object.keys(s!).sort()).toEqual(["appointment", "first_name", "next_step", "pending_actions", "ref", "start_date", "status", "status_label", "updated_at"]);
  });
});

describe("audit agent", () => {
  it("distinguishes an ended appointment awaiting an outcome from a missing appointment", async () => {
    const client = await makeClient("TEST Appointment Audit Classification");
    await act("admin", { action: "override_status", client_id: client.id, status: "appointment_scheduled", reason: "Audit regression fixture", next_step: null });
    await runAudit(client.id, trace);
    expect((await db`select rule from audit_alerts where client_id=${client.id} and status='open'`).map(row => row.rule)).toContain("appointment_scheduled_without_appointment");
    const when = new Date(Date.now() - 48 * 3_600_000);
    const [appointment] = await db`insert into appointments (client_id,appointment_type,scheduled_at,ends_at,resource_key,location,created_by_staff,status)
      values(${client.id},'Office intake',${when},${new Date(when.getTime()+30*60_000)},'office','Office',${sessions.manager.staff.id},'confirmed') returning id`;
    await runAudit(client.id, trace);
    const open = (await db`select rule from audit_alerts where client_id=${client.id} and status='open'`).map(row => row.rule);
    expect(open).toContain("appointment_outcome_missing");
    expect(open).not.toContain("appointment_scheduled_without_appointment");
    await db`update appointments set status='attended' where id=${appointment.id}`;
    await runAudit(client.id, trace);
    const attended = (await db`select rule from audit_alerts where client_id=${client.id} and status='open'`).map(row => row.rule);
    expect(attended).toContain("appointment_outcome_missing");
    expect(attended).not.toContain("appointment_scheduled_without_appointment");
    await db`update appointments set status='confirmed',scheduled_at=now()+interval '2 days',ends_at=now()+interval '2 days 30 minutes' where id=${appointment.id}`;
    await runAudit(client.id, trace);
    expect(await db`select 1 from audit_alerts where client_id=${client.id} and rule in ('appointment_outcome_missing','appointment_scheduled_without_appointment') and status='open'`).toHaveLength(0);
  });

  it("raises alerts, honours ignore, and auto-closes when the condition clears", async () => {
    const C = await makeClient("TEST Audit Client");
    await act("admin", { action: "override_status", client_id: C.id, status: "ready_for_first_day", reason: "test", next_step: null });
    await runAudit(C.id, trace);
    const [al] = await db`select id, rule, status from audit_alerts where client_id = ${C.id} and rule = 'ready_for_first_day_without_start_date'`;
    expect(al.status).toBe("open");
    const [{ status: clientStatus }] = await db`select current_status as status from clients where id = ${C.id}`;
    expect(clientStatus).toBe("ready_for_first_day");

    await act("manager", { action: "ignore_alert", alert_id: al.id, reason: "Known" });
    await runAudit(C.id, trace);
    const open = await db`select 1 from audit_alerts where client_id = ${C.id} and rule = 'ready_for_first_day_without_start_date' and status = 'open'`;
    expect(open.length).toBe(0);

    await act("admin", { action: "override_status", client_id: C.id, status: "i9_available", reason: "test", next_step: null });
    await runAudit(C.id, trace);
    const [i9] = await db`select id from audit_alerts where client_id = ${C.id} and rule = 'i9_available_without_required_prior_steps' and status = 'open'`;
    expect(i9).toBeTruthy();
    await act("manager", { action: "update_post_hire", client_id: C.id, item: "screening", status: "confirmed", note: "Client confirmed", start_date: undefined });
    await runAudit(C.id, trace);
    const [closed] = await db`select status from audit_alerts where id = ${i9.id}`;
    expect(closed.status).toBe("resolved");
  });

  it("a verified document without reviewer metadata is impossible", async () => {
    await expect(db`insert into documents (client_id, doc_type, storage_path, file_name, mime_type, size_bytes, status)
      values (${A.id}, 'other', ${`x/${randomUUID()}`}, 'x', 'image/png', 1, 'verified')`).rejects.toMatchObject({ code: "23514" });
  });
});

describe("documents", () => {
  it("without a vision provider: NOT_CONFIGURED, needs human review, no download attempted", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const [d] = await db`insert into documents (client_id, doc_type, storage_path, file_name, mime_type, size_bytes, sha256)
      values (${A.id}, 'photo_id', ${`${A.id}/${randomUUID()}/original.png`}, 'id.png', 'image/png', 10, ${"a".repeat(64)}) returning id`;
    const r = await processDocument(d.id, trace);
    expect(r).toEqual({ status: "not_configured", result: "needs_review" });
    const [doc] = await db`select status from documents where id = ${d.id}`;
    expect(doc.status).toBe("needs_review");
    const [ex] = await db`select status, provider from document_extractions where document_id = ${d.id}`;
    expect(ex.status).toBe("not_configured");
    vi.unstubAllEnvs();
  });

  it("rejects corrupt files, wrong types and extension mismatches before storing anything", async () => {
    const actor = { staffId: sessions.manager.staff.id, traceId: trace };
    const before = (await db`select count(*)::int as n from documents where client_id = ${B.id}`)[0].n;
    const corrupt = Buffer.concat([PNG.subarray(0, 20), Buffer.alloc(40)]);
    expect(await saveDocument({ clientId: B.id, docType: "photo_id", file: new File([corrupt], "id.png"), actor })).toMatchObject({ ok: false, code: "corrupt_file" });
    expect(await saveDocument({ clientId: B.id, docType: "photo_id", file: new File(["hello"], "id.png"), actor })).toMatchObject({ ok: false, code: "invalid_file" });
    expect(await saveDocument({ clientId: B.id, docType: "photo_id", file: new File([PNG], "id.pdf"), actor })).toMatchObject({ ok: false, code: "invalid_file" });
    expect((await db`select count(*)::int as n from documents where client_id = ${B.id}`)[0].n).toBe(before);
  });

  it("a storage failure leaves no document row", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:9");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "x");
    const before = (await db`select count(*)::int as n from documents`)[0].n;
    const r = await saveDocument({ clientId: B.id, docType: "photo_id", file: new File([PNG], "id.png"), actor: { staffId: null, traceId: trace } });
    expect(r).toMatchObject({ ok: false, code: "storage_error" });
    expect((await db`select count(*)::int as n from documents`)[0].n).toBe(before);
    vi.unstubAllEnvs();
  });
});

describe("integrity", () => {
  it("a failed transaction leaves no half-created client and no consumed reference", async () => {
    const [{ last_value: before }] = await db`select last_value from client_ref_counters`;
    await expect(db.begin(async (tx) => {
      await insertClient(tx, { source: "public_intake", profile: ProfileSchema.parse({ full_name: "TEST Rollback", phone: "3135550199", employment_history: [] }), primary: [], backup: [], status: "new_intake", nextStep: null, assignedStaff: null, createdBy: null, communicationConsent: false }, { staffId: null, traceId: trace });
      throw new Error("simulated DB write failure");
    })).rejects.toThrow("simulated");
    expect((await db`select count(*)::int as n from clients where full_name = 'TEST Rollback'`)[0].n).toBe(0);
    const [{ last_value: after }] = await db`select last_value from client_ref_counters`;
    expect(after).toBe(before);
  });

  it("staff can add a note on an assigned client; the embedding job is queued in the same transaction", async () => {
    const r = await act("staff1", { action: "add_note", client_id: A.id, note: "TEST staff note" });
    const [j] = await db`select status from jobs where type = 'semantic_embedding' and entity_id = ${r.note_id as string}`;
    expect(j.status).toBe("queued");
    await processJobs(50);
    const [after] = await db`select status, last_error from jobs where type = 'semantic_embedding' and entity_id = ${r.note_id as string}`;
    expect(after.status).toBe("not_configured");
  });

  it("notes, activity and access logs are append-only", async () => {
    await act("staff1", { action: "add_note", client_id: A.id, note: "TEST note" });
    await expect(db`update notes set note = 'changed' where client_id = ${A.id}`).rejects.toThrow(/append-only/);
    await expect(db`delete from activity_log where client_id = ${A.id}`).rejects.toThrow(/append-only/);
  });

  it("a completed assessment requires a confirmed answer and source", async () => {
    await expect(act("manager", { action: "update_assessment", client_id: A.id, assessment_type: "t", item_key: "k", prompt_reference: null, confirmed_answer: null, status: "completed", source: null, notes: null }))
      .rejects.toMatchObject({ code: "unconfirmed_answer" });
    await act("manager", { action: "add_standard_assessments", client_id: A.id });
    const rows = await db`select status from assessments where client_id = ${A.id}`;
    expect(rows.every((r) => r.status === "unresolved")).toBe(true);
  });

  it("the last active admin cannot be demoted or disabled", async () => {
    const admins = await db`select id from staff where role = 'admin' and active`;
    for (const a of admins.filter((entry) => entry.id !== sessions.admin.staff.id)) await db`update staff set role = 'manager' where id = ${a.id}`;
    await expect(act("admin", { action: "disable_staff", staff_id: sessions.admin.staff.id })).rejects.toMatchObject({ code: "last_admin" });
  });

  it("vector search works on the semantic index and respects RLS (schema check with a synthetic vector)", async () => {
    const v = `[${Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0)).join(",")}]`;
    await db`insert into semantic_index (client_id, source_type, source_id, content_redacted, embedding, model)
             values (${A.id}, 'note', ${randomUUID()}, 'TEST schema row', ${v}::vector, 'schema-test')`;
    const own = await withStaff(sessions.staff1, (tx) => tx`select client_id from semantic_index order by embedding <=> ${v}::vector limit 5`);
    const other = await withStaff(sessions.staff2, (tx) => tx`select client_id from semantic_index order by embedding <=> ${v}::vector limit 5`);
    expect(own.map((r) => r.client_id)).toContain(A.id);
    expect(other.length).toBe(0);
  });
});


describe("event-driven workflow completion",()=>{
  async function completePaperwork(clientId:string){
    for(const item of POST_HIRE_ITEMS) await act("manager",{action:"update_post_hire",client_id:clientId,item,status:"completed",note:"Verified integration fixture",...(item==="start_date"?{start_date:"2026-11-09"}:{})});
  }
  async function pay(clientId:string){
    const [account]=await db`select id from client_accounts where client_id=${clientId}`;
    await db`insert into payment_transactions(account_id,client_id,transaction_type,direction,amount,status,payment_method,recorded_by,idempotency_key)
      values(${account.id},${clientId},'payment','credit',150,'confirmed','cash',${sessions.manager.staff.id},${randomUUID()})`;
    await withStaff(sessions.manager,async tx=>reconcileAccount(tx,{account:await lockAccount(tx,clientId),staffId:sessions.manager.staff.id,traceId:trace,eligibilityDate:"2026-10-31"}));
  }
  it("moves a paid legacy intake with complete post-interview work out of intake and active appointments, preserving the appointment and ledger",async()=>{
    const client=await makeClient("TEST Workflow Complete");
    const [appointment]=await db`insert into appointments(client_id,appointment_type,scheduled_at,ends_at,resource_key,created_by_staff,status)
      values(${client.id},'Pre-hire appointment',now()+interval '2 days',now()+interval '2 days 30 minutes','office',${sessions.manager.staff.id},'scheduled') returning id`;
    await pay(client.id);
    expect((await db`select current_status from clients where id=${client.id}`)[0].current_status).toBe('new_intake');
    await completePaperwork(client.id);
    const [after]=await db`select current_status,pipeline_stage from clients where id=${client.id}`;
    expect(after).toMatchObject({current_status:'completed',pipeline_stage:'completed_files'});
    const intake=await operationalClientList(sessions.manager,'active',1,25,{stage:'new_intake',q:client.ref});
    expect(intake.total).toBe(0);
    expect((await operationalClientList(sessions.manager,'completed',1,25,{q:client.ref})).total).toBe(1);
    expect((await appointmentPage(sessions.manager,'all',1,25,client.ref)).total).toBe(0);
    expect(await db`select id from appointments where id=${appointment.id}`).toHaveLength(1);
    expect(await db`select id from payment_transactions where client_id=${client.id}`).toHaveLength(1);
    expect(await db`select appointment_id from appointment_outcomes where client_id=${client.id}`).toHaveLength(0);
    const [audit]=await db`select staff_id,new_value from activity_log where client_id=${client.id} and trace_id='workflow-completion-reconciliation' order by created_at desc limit 1`;
    expect(audit.staff_id).toBe(sessions.manager.staff.id);
    expect(audit.new_value).toMatchObject({paperwork_complete:true,payment_verified:true,status:'completed'});
  });
  it("waits for actual ledger settlement and cannot bypass completion evidence with an override",async()=>{
    const client=await makeClient("TEST Workflow Awaiting Payment");
    await completePaperwork(client.id);
    expect((await db`select current_status from clients where id=${client.id}`)[0].current_status).not.toBe('completed');
    await expect(act('admin',{action:'override_status',client_id:client.id,status:'completed',reason:'Cannot fake payment',next_step:null})).rejects.toThrow('completion_prerequisites_required');
    await pay(client.id);
    expect((await db`select current_status from clients where id=${client.id}`)[0].current_status).toBe('completed');
    await act('manager',{action:'update_post_hire',client_id:client.id,item:'employment_paperwork',status:'pending',note:'Requires correction'});
    expect((await db`select current_status from clients where id=${client.id}`)[0].current_status).toBe('post_hire_tasks');
  });
  it("does not expose another staff member's file during reconciliation and keeps aggregate drilldowns consistent",async()=>{
    const client=await makeClient("TEST Workflow Scoped",{assigned:sessions.staff2.staff.id});
    const [result]=await withStaff(sessions.staff1,tx=>tx`select career_gate_private.reconcile_client_completion(${client.id}) changed`);
    expect(result.changed).toBe(false);
    const summary=await executiveSummary(sessions.manager);
    for(const stage of summary.stages){
      if(stage.id==='registry')continue;
      const filter={intake:'new_intake',account:'account_setup',job:'job_ready',appointments:'appointments',paperwork:'paperwork_pending'}[stage.id] as 'new_intake';
      const list=await operationalClientList(sessions.manager,'active',1,25,{stage:filter});
      expect(stage.total,stage.id).toBe(list.total);
    }
    expect(summary.priorities.length).toBeLessThanOrEqual(5);
    expect(summary.team.every(member=>!("email" in member))).toBe(true);
  });
});
