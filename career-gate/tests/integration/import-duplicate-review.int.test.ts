import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withStaff, type StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { readImportReview, mutateImportReview } from "@/lib/import-duplicate-review";
import { managerInbox, resolveManagerReview } from "@/lib/manager-inbox";
import { listActiveImportQueue, archiveImportCase } from "@/lib/smart-import-archive";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";
import type { ImportComparison, ImportIdentity, ImportReviewQueue } from "@/lib/import-duplicate-contract";

const db = sql();
const sessions: Record<string, StaffSession> = {};
let batchId: string;
let serial = 6200;
async function createStaff(key: string, role: "manager" | "staff") {
  const authId = randomUUID(), email = `duplicate-${key}-${authId}@test.invalid`;
  await db`insert into auth.users(id,email) values(${authId},${email})`;
  const [staff] = await db`insert into staff(display_name,email,role,auth_user_id) values(${`TEST Duplicate ${key}`},${email},${role},${authId}) returning id,display_name,email,role`;
  sessions[key] = { authUserId: authId, staff: staff as StaffSession["staff"] };
}
async function imported(name = `TEST Duplicate Import ${randomUUID()}`, phone = `313555${++serial}`) {
  const draft = { profile: { full_name: name, phone, ssn: "123-45-6789", email: "private@test.invalid" } };
  const [row] = await db`insert into client_import_cases(batch_id,source_type,mapped_draft,created_by) values(${batchId},'csv',${db.json(draft)},${sessions.manager.staff.id}) returning id`;
  return String(row.id);
}
async function canonical(name: string, phone: string) {
  return db.begin(tx => insertClient(tx, { source: "staff_manual", profile: ProfileSchema.parse({ full_name: name, phone, employment_history: [] }), primary: [], backup: [], status: "new_intake", nextStep: null, assignedStaff: sessions.other.staff.id, createdBy: sessions.manager.staff.id, communicationConsent: false }, { staffId: sessions.manager.staff.id, traceId: "duplicate-fixture" }));
}
const scan = (id: string, actor = sessions.sender) => readImportReview<ImportComparison>(actor, "scan", { case_id: id });
async function submit(id: string, target?: ImportIdentity, reason?: string, operation = randomUUID()) {
  const comparison = await scan(id);
  const input = { action: "submit" as const, case_id: id, fingerprint: comparison.fingerprint, reason: reason ?? (target ? "exact_duplicate" : "manager_review"), operation_id: operation, ...(target ? { target_kind: target.kind, target_id: target.id } : {}) };
  const result = await mutateImportReview<{ id: string }>(sessions.sender, input, "duplicate-submit");
  return { ...result, input, comparison };
}
const decision = (id: string, action: "delete" | "return" | "not_duplicate", target?: ImportIdentity, operation_id = randomUUID(), actor = sessions.manager) => resolveManagerReview(actor, { id, destination: "keep_current", note: "", action, operation_id, ...(target ? { delete_record_kind: target.kind, delete_record_id: target.id } : {}) }, "duplicate-decision");
beforeAll(async () => {
  await createStaff("manager", "manager"); await createStaff("manager2", "manager"); await createStaff("sender", "staff"); await createStaff("other", "staff"); await createStaff("restricted", "staff");
  await db`update staff set permission_mode='custom',custom_permissions='{}' where id=${sessions.restricted.staff.id}`;
  const [batch] = await db`insert into client_import_batches(source_type,source_file_hash,idempotency_key,created_by) values('csv',${"a".repeat(64)},${randomUUID()},${sessions.manager.staff.id}) returning id`;
  batchId = String(batch.id);
});
afterAll(async () => { await db.end(); });

describe("verified import comparison and manager approval", () => {
  it("compares actual global records, normalized names and Arabic/NANP phone formats without leaking draft fields", async () => {
    const name = `TEST Match ${randomUUID()}`, phone = `313555${++serial}`;
    const client = await canonical(name, phone), id = await imported(`  ${name.toUpperCase()}  `, `+١ (${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`);
    const result = await scan(id);
    expect(result).toMatchObject({ level: "exact", exact_count: 1, match_count: 1 });
    expect(result.matches[0]).toMatchObject({ kind: "client", id: client.id, ref: client.ref, location: "new_intake", name_match: true, phone_match: true, level: "exact", href: `/staff/client/${client.id}` });
    expect(JSON.stringify(result)).not.toMatch(/123-45-6789|private@test.invalid|ssn|mapped_draft/);
    expect(result.matches.some(match => match.id === id)).toBe(false);
  });
  it("distinguishes name-only, phone-only, absent and insufficient matches", async () => {
    const name = `TEST Partial ${randomUUID()}`, phone = `313555${++serial}`;
    await canonical(name, phone);
    const byName = await scan(await imported(name, `616555${++serial}`));
    expect(byName.matches.find(match => match.kind === "client")).toMatchObject({ level: "partial", name_match: true, phone_match: false });
    const byPhone = await scan(await imported(`TEST Other ${randomUUID()}`, phone));
    expect(byPhone.matches.find(match => match.kind === "client")).toMatchObject({ level: "partial", name_match: false, phone_match: true });
    expect(await scan(await imported())).toMatchObject({ level: "none", match_count: 0 });
    expect(await scan(await imported(`TEST Incomplete ${randomUUID()}`, ""))).toMatchObject({ level: "insufficient", match_count: 0 });
  });
  it("searches and pages through the complete queue beyond ten or fifty rows", async () => {
    const marker = `TEST Entire Queue ${randomUUID()}`;
    await db`insert into client_import_cases(batch_id,source_type,mapped_draft,created_by) select ${batchId},'csv',jsonb_build_object('profile',jsonb_build_object('full_name',${marker}||' '||n,'phone','734555'||lpad(n::text,4,'0'))),${sessions.manager.staff.id} from generate_series(1,61) n`;
    const first = await readImportReview<ImportReviewQueue>(sessions.sender, "queue", { q: marker, page: 1 });
    const second = await readImportReview<ImportReviewQueue>(sessions.sender, "queue", { q: marker, page: 2 });
    expect(first.total).toBe(61); expect(first.rows).toHaveLength(50); expect(second.rows).toHaveLength(11);
    expect(new Set([...first.rows, ...second.rows].map(row => row.id)).size).toBe(61);
  });
  it("enforces active account, granular staff permission, manager decisions and raw staging RLS", async () => {
    const id = await imported();
    await expect(scan(id, sessions.restricted)).rejects.toMatchObject({ code: "import_review_permission_required" });
    await db`update staff set custom_permissions=array['add_task'] where id=${sessions.restricted.staff.id}`;
    expect((await scan(id, sessions.restricted)).source.id).toBe(id);
    await expect(readImportReview(sessions.sender, "trash", {})).rejects.toMatchObject({ code: "manager_access_required" });
    await expect(withStaff(sessions.sender, tx => tx`select mapped_draft from client_import_cases where id=${id}`)).rejects.toMatchObject({ code: "42501" });
    await expect(withStaff(sessions.manager, tx => tx`select career_gate_private.import_review_scan(${id})`)).rejects.toMatchObject({ code: "42501" });
    await expect(db.begin(async tx => { await tx.unsafe("set local role anon"); return tx`select career_gate_private.import_review_command('queue','{}')`; })).rejects.toMatchObject({ code: "42501" });
    await db`update staff set active=false where id=${sessions.restricted.staff.id}`;
    await expect(scan(id, sessions.restricted)).rejects.toMatchObject({ code: "import_review_access_required" });
  });
  it("rejects forged targets and stale comparisons before any handoff", async () => {
    const id = await imported(), comparison = await scan(id);
    await expect(mutateImportReview(sessions.sender, { action: "submit", case_id: id, fingerprint: comparison.fingerprint, reason: "exact_duplicate", target_kind: "client", target_id: randomUUID(), operation_id: randomUUID() }, "forged")).rejects.toMatchObject({ code: "duplicate_target_unverified" });
    await db`update client_import_cases set mapped_draft=jsonb_set(mapped_draft,'{profile,phone}','"3135559991"') where id=${id}`;
    await expect(mutateImportReview(sessions.sender, { action: "submit", case_id: id, fingerprint: comparison.fingerprint, reason: "manager_review", operation_id: randomUUID() }, "stale")).rejects.toMatchObject({ code: "duplicate_scan_stale" });
    expect((await db`select manager_review_id from client_import_cases where id=${id}`)[0].manager_review_id).toBeNull();
  });
  it("holds the original import exclusively and delivers immutable comparison evidence without creating a client", async () => {
    const name = `TEST Handoff ${randomUUID()}`, phone = `313555${++serial}`;
    const client = await canonical(name, phone), id = await imported(name, phone), comparison = await scan(id);
    const [before] = await db`select count(*)::int n from clients`;
    const sent = await submit(id, comparison.matches.find(match => match.id === client.id));
    const replay = await mutateImportReview(sessions.sender, sent.input, "replay"); expect(replay).toEqual({ id: sent.id, review_id: sent.id, created: true });
    const inbox = await managerInbox(sessions.manager, 1, { kind: "import", q: comparison.source.ref });
    const item = inbox.items.find(row => row.id === sent.id)!;
    expect(item).toMatchObject({ kind: "import", import_case_id: id, client_id: null, operational_location: "manager", snapshot: { reason_code: "exact_duplicate", selected_target: { id: client.id, name_match: true, phone_match: true }, checked_at: expect.any(String) } });
    expect((await db`select count(*)::int n from clients`)[0].n).toBe(before.n);
    expect((await listActiveImportQueue(sessions.manager, { q: name })).rows.some(row => row.id === id)).toBe(false);
    expect((await readImportReview<ImportReviewQueue>(sessions.sender, "queue", { q: name })).rows.some(row => row.id === id)).toBe(false);
    await expect(db`update client_import_cases set mapped_draft='{}' where id=${id}`).rejects.toThrow("import_manager_review_pending");
    await expect(archiveImportCase(sessions.manager, id)).rejects.toThrow();
    await expect(withStaff(sessions.manager, tx => tx`update manager_inbox set snapshot='{}' where id=${sent.id}`)).rejects.toThrow();
    await expect(withStaff(sessions.manager, async tx => {
      await tx`select set_config('cg.manager_resolution',${sent.id},true),set_config('cg.import_review_resolve',${sent.id},true)`;
      return tx`update manager_inbox set status='resolved',destination='keep_current',resolved_by=${sessions.manager.staff.id},resolved_at=now() where id=${sent.id}`;
    })).rejects.toThrow("import_review_requires_verified_command");
    await expect(decision(sent.id, "delete", comparison.source, undefined, sessions.sender)).rejects.toMatchObject({ code: "forbidden" });
    await decision(sent.id, "return");
    expect((await db`select manager_review_id from client_import_cases where id=${id}`)[0].manager_review_id).toBeNull();
  });
  it("soft-deletes only the selected source, retains documents, replays decisions and restores the same file with an audit", async () => {
    const name = `TEST Restore ${randomUUID()}`, phone = `313555${++serial}`;
    const client = await canonical(name, phone), id = await imported(name, phone), comparison = await scan(id);
    const [document] = await db`insert into client_import_documents(import_case_id,storage_reference,original_filename,mime_type,size_bytes,sha256,uploaded_by) values(${id},${randomUUID()},'evidence.pdf','application/pdf',100,${"b".repeat(64)},${sessions.manager.staff.id}) returning id`;
    const sent = await submit(id, comparison.matches.find(row => row.id === client.id)), key = randomUUID();
    const result = await decision(sent.id, "delete", comparison.source, key);
    expect(await decision(sent.id, "delete", comparison.source, key)).toEqual(result);
    expect((await db`select archived_at,manager_review_id from client_import_cases where id=${id}`)[0]).toMatchObject({ archived_at: expect.any(Date), manager_review_id: null });
    expect((await db`select deleted_at from clients where id=${client.id}`)[0].deleted_at).toBeNull();
    expect(await db`select id from client_import_documents where id=${document.id}`).toHaveLength(1);
    const trash = await readImportReview<{ rows: { id: string; documents: number }[] }>(sessions.manager, "trash", {});
    expect(trash.rows.find(row => row.id === id)).toMatchObject({ documents: 1 });
    const restore = { action: "restore" as const, case_id: id, operation_id: randomUUID() };
    await mutateImportReview(sessions.manager, restore, "restore"); await mutateImportReview(sessions.manager, restore, "restore-replay");
    expect((await db`select archived_at,manager_review_id from client_import_cases where id=${id}`)[0]).toMatchObject({ archived_at: null, manager_review_id: null });
    expect((await db`select count(*)::int n from import_review_events where import_case_id=${id} and event='restored'`)[0].n).toBe(1);
    await expect(db`update import_review_events set details='{}' where import_case_id=${id}`).rejects.toThrow("import_review_history_is_immutable");
  });
  it("can delete the matching canonical record while retaining and releasing the queued source", async () => {
    const name = `TEST Target ${randomUUID()}`, phone = `313555${++serial}`, client = await canonical(name, phone), id = await imported(name, phone), comparison = await scan(id);
    const target = comparison.matches.find(row => row.id === client.id)!;
    const sent = await submit(id, target);
    await expect(decision(sent.id, "delete", { ...target, id: randomUUID() })).rejects.toMatchObject({ code: "duplicate_target_unverified" });
    await decision(sent.id, "delete", target);
    expect((await db`select deleted_at from clients where id=${client.id}`)[0].deleted_at).toBeInstanceOf(Date);
    expect((await db`select archived_at,manager_review_id,status from client_import_cases where id=${id}`)[0]).toMatchObject({ archived_at: null, manager_review_id: null, status: "PENDING" });
    const [stamp] = await db`select resolution_target,resolved_by_name_snapshot from manager_inbox where id=${sent.id}`;
    expect(stamp).toMatchObject({ resolution_target: { kind: "client", id: client.id }, resolved_by_name_snapshot: "TEST Duplicate manager" });
  });
  it("can delete one matching import and preserve both the source and its history", async () => {
    const name = `TEST Import Pair ${randomUUID()}`, phone = `313555${++serial}`, first = await imported(name, phone), second = await imported(name, phone), comparison = await scan(first);
    const target = comparison.matches.find(row => row.id === second)!;
    const sent = await submit(first, target);
    await decision(sent.id, "delete", target);
    expect((await db`select archived_at from client_import_cases where id=${second}`)[0].archived_at).toBeInstanceOf(Date);
    expect((await db`select archived_at,manager_review_id from client_import_cases where id=${first}`)[0]).toMatchObject({ archived_at: null, manager_review_id: null });
  });
  it("automatically rejects changed comparison identity even when the manager chooses the unchanged source", async () => {
    const name = `TEST Freshness ${randomUUID()}`, phone = `313555${++serial}`, client = await canonical(name, phone), id = await imported(name, phone), comparison = await scan(id), sent = await submit(id, comparison.matches.find(row => row.id === client.id));
    await db`update clients set phone='3135559992' where id=${client.id}`;
    await expect(decision(sent.id, "delete", comparison.source)).rejects.toMatchObject({ code: "import_review_changed" });
    expect((await db`select status from manager_inbox where id=${sent.id}`)[0].status).toBe("open");
    expect((await db`select archived_at from client_import_cases where id=${id}`)[0].archived_at).toBeNull();
    await decision(sent.id, "return");
  });
  it("serializes competing managers to one audited decision", async () => {
    const id = await imported(), sent = await submit(id), comparison = await scan(id);
    const results = await Promise.all([decision(sent.id, "delete", comparison.source), decision(sent.id, "return", undefined, randomUUID(), sessions.manager2)]);
    expect(results.filter(row => row.already_resolved)).toHaveLength(1);
    expect((await db`select count(*)::int n from import_review_events where import_case_id=${id} and event='resolved'`)[0].n).toBe(1);
  });
});
