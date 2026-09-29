import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runAction } from "@/lib/actions";
import { runAudit } from "@/lib/audit";
import { withStaff, type StaffSession } from "@/lib/auth";
import { otpHash } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { processDocument } from "@/lib/doc-intel";
import { saveDocument } from "@/lib/documents";
import { claimKey, completeKey } from "@/lib/idempotency";
import { enqueue, processJobs, registerHandler } from "@/lib/jobs";
import { queueSubmissionNotifications } from "@/lib/notify";
import { publicStatus } from "@/lib/public-status";
import { ProfileSchema } from "@/lib/schemas";
import { suggestSlots } from "@/lib/scheduling";
import { queueEmbedding } from "@/lib/semantic";
import { ActionError, insertClient } from "@/lib/service";
import { sessionClient, startLookup, verifyCode } from "@/lib/status-access";

const db = sql();
const trace = "int-test";
type Role = "super_admin" | "admin" | "manager" | "staff";
type AccessScope = "full" | "assigned_only";
const sessions: Record<string, StaffSession> = {};
let clientPhoneSequence = 1000;
const nextClientPhone = () => `313555${String(++clientPhoneSequence).padStart(4, "0")}`;
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000004000000040802000000269309290000000970485973000003e8000003e801b57b526b0000000f49444154089963f88f041888e30000db902fd1ecba04730000000049454e44ae426082",
  "hex",
);

async function makeStaff(key: string, role: Role, accessScope: AccessScope = "full") {
  const authId = randomUUID();
  await db`insert into auth.users (id, email) values (${authId}, ${`${key}@test.invalid`})`;
  const [s] = await db`insert into staff (display_name, email, role, auth_user_id, access_scope)
    values (${`TEST ${key}`}, ${`${key}@test.invalid`}, ${role}, ${authId}, ${accessScope})
    returning id, display_name, email, role, access_scope`;
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
  await makeStaff("superadmin", "super_admin");
  await makeStaff("admin", "admin");
  await makeStaff("manager", "manager");
  await makeStaff("staff1", "staff");
  await makeStaff("staff2", "staff");
  await makeStaff("restricted", "staff", "assigned_only");
  A = await makeClient("TEST Alpha Client", { assigned: sessions.staff1.staff.id });
  B = await makeClient("TEST Beta Client");
});

afterAll(async () => {
  await db.end();
});

describe("row-level security (as authenticated role)", () => {
  const visible = async (key: string) => (await withStaff(sessions[key], (tx) => tx`select id from clients where id in (${A.id}, ${B.id})`)).map((r) => r.id).sort();

  it("full-scope staff, manager and admin see all live clients; assigned-only staff stays scoped", async () => {
    expect((await visible("staff1")).length).toBe(2);
    expect((await visible("staff2")).length).toBe(2);
    expect((await visible("manager")).length).toBe(2);
    expect((await visible("admin")).length).toBe(2);
    expect(await visible("restricted")).toEqual([]);
  });

  it("full-scope staff can create clients through RLS", async () => {
    const r = await act("manager", { action: "create_client", profile: ProfileSchema.parse({ full_name: "TEST RLS Create", phone: "3135550100", employment_history: [] }), primary: [], backup: [], status: "new_intake", next_step: null, initial_note: "TEST first note", assigned_staff: null, communication_consent: false });
    expect(r.ref).toMatch(/^CG-\d{4}-\d{6}$/);
    const rows = await withStaff(sessions.staff1, (tx) => tx`insert into clients (source, full_name, phone, next_step) values ('staff_manual', 'TEST Full Scope Create', '3135550198', 'x') returning id`);
    expect(rows).toHaveLength(1);
  });

  it("full-scope staff can work across live clients while assigned-only staff cannot", async () => {
    const rows = await withStaff(sessions.staff1, (tx) => tx`insert into notes (client_id, note, staff_id) values (${B.id}, 'full-scope', ${sessions.staff1.staff.id}) returning id`);
    expect(rows).toHaveLength(1);
    await expect(withStaff(sessions.restricted, (tx) => tx`insert into notes (client_id, note, staff_id) values (${B.id}, 'restricted', ${sessions.restricted.staff.id})`)).rejects.toMatchObject({ code: "42501" });
  });

  it("anon has no table access", async () => {
    await expect(db.begin(async (tx) => { await tx.unsafe("set local role anon"); return tx`select 1 from clients limit 1`; })).rejects.toMatchObject({ code: "42501" });
  });

  it("server-only tables are invisible to staff", async () => {
    const rows = await withStaff(sessions.admin, (tx) => tx`select count(*)::int as n from otp_requests`).catch((e) => e);
    expect(rows).toMatchObject({ code: "42501" });
  });

  it("soft-deleted clients are hidden from non-super-admin staff", async () => {
    const C = await makeClient("TEST Deleted Client");
    await act("superadmin", { action: "soft_delete_client", client_id: C.id, reason: "test" });
    const m = await withStaff(sessions.manager, (tx) => tx`select id from clients where id = ${C.id}`);
    const a = await withStaff(sessions.admin, (tx) => tx`select id from clients where id = ${C.id}`);
    const s = await withStaff(sessions.superadmin, (tx) => tx`select id from clients where id = ${C.id}`);
    expect(m.length).toBe(0);
    expect(a.length).toBe(0);
    expect(s.length).toBe(1);
  });
});

describe("staff auth linking", () => {
  it("links only pre-approved active staff records by email and refuses strangers", async () => {
    const { resolveStaffForAuthUser } = await import("@/lib/auth");
    const [preapproved] = await db`insert into staff (display_name, email, role, access_scope)
      values ('TEST Preapproved Admin', 'boss@test.invalid', 'admin', 'full') returning id`;
    const bossId = randomUUID();
    await db`insert into auth.users (id, email) values (${bossId}, 'boss@test.invalid')`;
    const created = await resolveStaffForAuthUser({ id: bossId, email: "Boss@test.invalid" });
    expect(created).toBe(preapproved.id);
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

  it("super-admin override needs a reason and is logged as an override", async () => {
    await act("superadmin", { action: "override_status", client_id: B.id, status: "ready_for_first_day", reason: "Test override", next_step: null });
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
  beforeAll(async () => {
    for (let d = 0; d < 7; d++) {
      await act("manager", { action: "upsert_availability", resource_key: "office", weekday: d, start_time: "00:00", end_time: "23:30", slot_minutes: 30, appointment_type: null, active: true });
    }
  });

  it("offers three real free slots and prevents double booking", async () => {
    const slots = await suggestSlots(db, { resourceKey: "office", count: 3 });
    expect(slots).toHaveLength(3);
    const s = slots[0];
    await act("manager", { action: "book_slot", client_id: A.id, start: s.start, end: s.end, resource_key: "office", appointment_type: "Test", location: null, notes: null });
    await expect(act("manager", { action: "book_slot", client_id: B.id, start: s.start, end: s.end, resource_key: "office", appointment_type: "Test", location: null, notes: null }))
      .rejects.toMatchObject({ code: "slot_taken" });
    const after = await suggestSlots(db, { resourceKey: "office", count: 3 });
    expect(after.map((x) => x.start)).not.toContain(s.start);
  });

  it("the exclusion constraint rejects overlaps even for manual scheduling", async () => {
    const t = new Date(Date.now() + 40 * 86_400_000).toISOString();
    await act("manager", { action: "schedule_appointment", client_id: A.id, appointment_type: "Test", scheduled_at: t, duration_minutes: 30, resource_key: "office", location: null, notes: null });
    await expect(act("manager", { action: "schedule_appointment", client_id: B.id, appointment_type: "Test", scheduled_at: t, duration_minutes: 30, resource_key: "office", location: null, notes: null }))
      .rejects.toMatchObject({ code: "23P01" });
    await act("manager", { action: "schedule_appointment", client_id: B.id, appointment_type: "Test", scheduled_at: t, duration_minutes: 30, resource_key: `staff:${sessions.staff2.staff.id}`, location: null, notes: null });
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
  it("raises alerts, honours ignore, and auto-closes when the condition clears", async () => {
    const C = await makeClient("TEST Audit Client");
    await act("superadmin", { action: "override_status", client_id: C.id, status: "ready_for_first_day", reason: "test", next_step: null });
    await runAudit(C.id, trace);
    const [al] = await db`select id, rule, status from audit_alerts where client_id = ${C.id} and rule = 'ready_for_first_day_without_start_date'`;
    expect(al.status).toBe("open");
    const [{ status: clientStatus }] = await db`select current_status as status from clients where id = ${C.id}`;
    expect(clientStatus).toBe("ready_for_first_day");

    await act("manager", { action: "ignore_alert", alert_id: al.id, reason: "Known" });
    await runAudit(C.id, trace);
    const open = await db`select 1 from audit_alerts where client_id = ${C.id} and rule = 'ready_for_first_day_without_start_date' and status = 'open'`;
    expect(open.length).toBe(0);

    await act("superadmin", { action: "override_status", client_id: C.id, status: "i9_available", reason: "test", next_step: null });
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

  it("the last active super admin cannot be demoted or disabled", async () => {
    await expect(act("superadmin", { action: "disable_staff", staff_id: sessions.superadmin.staff.id })).rejects.toMatchObject({ code: "P0001" });
  });

  it("vector search works on the semantic index and respects assigned-only RLS", async () => {
    const v = `[${Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0)).join(",")}]`;
    await db`insert into semantic_index (client_id, source_type, source_id, content_redacted, embedding, model)
             values (${A.id}, 'note', ${randomUUID()}, 'TEST schema row', ${v}::vector, 'schema-test')`;
    const own = await withStaff(sessions.staff1, (tx) => tx`select client_id from semantic_index order by embedding <=> ${v}::vector limit 5`);
    const other = await withStaff(sessions.restricted, (tx) => tx`select client_id from semantic_index order by embedding <=> ${v}::vector limit 5`);
    expect(own.map((r) => r.client_id)).toContain(A.id);
    expect(other.length).toBe(0);
  });
});