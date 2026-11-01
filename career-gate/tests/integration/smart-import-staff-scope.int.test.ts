import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { withStaff, type StaffSession } from "@/lib/auth";
import { approveImportCase, assignImportReviewer, beginImportOverride, cancelImportOverride, getImportCase, getImportDocument, recoverImportCapture, saveImportReview, stageSheetRows, startImportReview, verifyImportCase } from "@/lib/smart-client-import";
import { archiveImportCase, listActiveImportQueue, listArchivedImportQueue } from "@/lib/smart-import-archive";
import { reattachSmartImportDocuments } from "@/lib/smart-client-reattach";
import { enrichMobileImportCase, stageMobileImportV2 } from "@/lib/smart-client-mobile";
import { assertCaptureLease } from "@/lib/smart-capture";

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2 });
let manager: StaffSession;
let staff: StaffSession;
let other: StaffSession;

async function makeStaff(role: "manager" | "staff"): Promise<StaffSession> {
  const authId = randomUUID();
  const email = `smart-scope-${authId}@test.invalid`;
  await db`insert into auth.users (id,email) values (${authId},${email})`;
  const [row] = await db`insert into staff (display_name,email,role,auth_user_id,active)
    values (${`TEST Smart Scope ${role} ${authId}`},${email},${role},${authId},true) returning id,display_name,email,role`;
  return { authUserId: authId, staff: row as StaffSession["staff"] };
}

beforeAll(async () => {
  manager = await makeStaff("manager");
  staff = await makeStaff("staff");
  other = await makeStaff("staff");
});
afterAll(async () => { await db.end(); });

describe("assigned smart import reviewer", () => {
  it("limits review, documents, counters and approval to the assigned authorized staff member", async () => {
    const marker = `TEST Smart Scope ${randomUUID()}`;
    const staged = await stageSheetRows({ session: manager, source: "csv", idempotencyKey: randomUUID(), rows: [
      { full_name: `${marker} Assigned`, phone: "6165568801" },
      { full_name: `${marker} Other`, phone: "6165568802" },
      { full_name: `${marker} Unassigned`, phone: "6165568803" },
    ] });
    const own = String(staged.cases[0].id), foreign = String(staged.cases[1].id), unassigned = String(staged.cases[2].id);
    const revision = async (id: string) => {
      const [row] = await db`select revision::text as revision from client_import_cases where id=${id}`;
      return String(row.revision);
    };
    const initial = await revision(own);
    await expect(assignImportReviewer(staff, own, staff.staff.id, initial, "scope-unauthorized-assign")).rejects.toMatchObject({ code: "forbidden" });
    await db`update staff set permission_mode='custom',custom_permissions=array[]::text[] where id=${staff.staff.id}`;
    await expect(assignImportReviewer(manager, own, staff.staff.id, initial, "scope-assign")).rejects.toMatchObject({ code: "invalid_reviewer" });
    await db`update staff set custom_permissions=array['review_smart_import'] where id=${staff.staff.id}`;
    await assignImportReviewer(manager, own, staff.staff.id, initial, "scope-assign");
    await assignImportReviewer(manager, foreign, other.staff.id, await revision(foreign), "scope-assign-other");
    await expect(assignImportReviewer(manager, own, other.staff.id, initial, "scope-stale-transfer")).rejects.toMatchObject({ code: "review_changed" });
    await assignImportReviewer(manager, own, other.staff.id, await revision(own), "scope-transfer");
    const [transferred] = await db`select reviewer_id from client_import_cases where id=${own}`;
    expect(transferred.reviewer_id).toBe(other.staff.id);
    await expect(getImportCase(staff, own)).rejects.toMatchObject({ code: "not_found" });
    await assignImportReviewer(manager, own, staff.staff.id, await revision(own), "scope-transfer-back");
    const assignmentLog = await db`select staff_id,detail from security_events where event='smart_import_reviewer_assigned' and detail->>'case_id'=${own} order by id`;
    expect(assignmentLog).toHaveLength(3);
    expect(assignmentLog[0]).toMatchObject({ staff_id: manager.staff.id, detail: { case_id: own, previous_reviewer_id: null, reviewer_id: staff.staff.id } });
    expect(assignmentLog[1]).toMatchObject({ staff_id: manager.staff.id, detail: { case_id: own, previous_reviewer_id: staff.staff.id, reviewer_id: other.staff.id } });
    const queue = await listActiveImportQueue(staff, { q: marker });
    expect(queue.total).toBe(1);
    expect(queue.rows.map(row => row.id)).toEqual([own]);
    expect(Object.values(queue.counters).reduce((a,b) => a + b, 0)).toBe(1);
    expect((await listArchivedImportQueue(staff, { q: marker })).total).toBe(0);
    await expect(getImportCase(staff, foreign)).rejects.toMatchObject({ code: "not_found" });
    await expect(getImportCase(staff, unassigned)).rejects.toMatchObject({ code: "not_found" });
    await expect(withStaff(staff, tx => tx`select id from client_import_cases`)).rejects.toMatchObject({ code: "42501" });
    const [doc] = await db`insert into client_import_documents(import_case_id,storage_reference,original_filename,mime_type,size_bytes,sha256,uploaded_by)
      values(${foreign},${`scope/${randomUUID()}`},'private.pdf','application/pdf',1,${"a".repeat(64)},${manager.staff.id}) returning id`;
    await expect(getImportDocument(staff, String(doc.id))).rejects.toMatchObject({ code: "not_found" });
    const [ownDoc] = await db`insert into client_import_documents(import_case_id,storage_reference,original_filename,mime_type,size_bytes,sha256,uploaded_by)
      values(${own},${`scope/${randomUUID()}`},'owned.pdf','application/pdf',1,${"b".repeat(64)},${manager.staff.id}) returning id`;
    expect((await getImportDocument(staff, String(ownDoc.id))).import_case_id).toBe(own);
    await db`delete from client_import_documents where id=${ownDoc.id}`;
    const detail = await getImportCase(staff, own);
    const args = { id: own, reviewerId: staff.staff.id, draft: detail.case.mapped_draft, documentConfirmed: false, informationConfirmed: false, traceId: "scope-approve", expectedRevision: String(detail.case.revision) };
    await expect(verifyImportCase(other, own, String(detail.case.revision))).rejects.toMatchObject({ code: "not_found" });
    await expect(saveImportReview(staff, { ...args, reviewerId: other.staff.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(approveImportCase(staff, { ...args, expectedRevision: undefined })).rejects.toMatchObject({ code: "client_upgrade_required" });
    await expect(approveImportCase(staff, args)).rejects.toMatchObject({ code: "override_required" });
    await db`update staff set custom_permissions=array[]::text[] where id=${staff.staff.id}`;
    await expect(approveImportCase(staff, { ...args, override: true, overrideReason: "Documents due at next visit" })).rejects.toMatchObject({ code: "forbidden" });
    await db`update staff set custom_permissions=array['review_smart_import'] where id=${staff.staff.id}`;
    await expect(approveImportCase(staff, { ...args, override: true, overrideReason: "Documents due at next visit" })).rejects.toMatchObject({ code: "pending_override_required" });
    const pending = await beginImportOverride(staff, args);
    expect(pending.state).toBe("PENDING_OVERRIDE");
    const resumed = await getImportCase(staff, own);
    expect(resumed.case.verification_result.workflow_override).toMatchObject({ state: "PENDING_OVERRIDE", started_by: staff.staff.id, reviewer_id: staff.staff.id, outstanding_fields: expect.arrayContaining(["source_documents"]) });
    await expect(saveImportReview(staff, { ...args, expectedRevision: String(pending.revision) })).rejects.toMatchObject({ code: "pending_override_active" });
    await expect(verifyImportCase(staff, own, String(pending.revision))).rejects.toMatchObject({ code: "pending_override_active" });
    await expect(startImportReview(staff, own, staff.staff.id, String(pending.revision))).rejects.toMatchObject({ code: "pending_override_active" });
    await expect(archiveImportCase(manager, own, String(pending.revision))).rejects.toMatchObject({ code: "pending_override_active" });
    await expect(reattachSmartImportDocuments({ session: manager, caseId: own, files: [new File(["pdf"], "test.pdf", { type: "application/pdf" })] })).rejects.toMatchObject({ code: "pending_override_active" });
    await expect(assignImportReviewer(manager, own, other.staff.id, String(pending.revision), "pending-transfer")).rejects.toMatchObject({ code: "pending_override_active" });
    const altered = structuredClone(resumed.case.mapped_draft);
    altered.profile.full_name = "TEST Changed While Override Pending";
    await expect(approveImportCase(staff, { ...args, draft: altered, expectedRevision: String(pending.revision), override: true, overrideReason: "Documents due at next visit" })).rejects.toMatchObject({ code: "review_changed" });
    const [notCreated] = await db`select created_client_id from client_import_cases where id=${own}`;
    expect(notCreated.created_client_id).toBeNull();
    await expect(cancelImportOverride(other, own, String(pending.revision), "foreign-cancel")).rejects.toMatchObject({ code: "not_found" });
    await expect(cancelImportOverride(staff, own, args.expectedRevision, "stale-cancel")).rejects.toMatchObject({ code: "review_changed" });
    const cancelled = await cancelImportOverride(staff, own, String(pending.revision), "cancel-override");
    expect(cancelled.state).toBe("CANCELLED");
    const reopened = await beginImportOverride(staff, { ...args, expectedRevision: String(cancelled.revision) });
    const pendingEvents = await db`select event from security_events where event in ('smart_import_override_pending','smart_import_override_cancelled') and detail->>'case_id'=${own} order by id`;
    expect(pendingEvents.map(row => row.event)).toEqual(["smart_import_override_pending", "smart_import_override_cancelled", "smart_import_override_pending"]);
    const reason = "Documents due at next visit";
    const savedDraft = (await getImportCase(staff, own)).case.mapped_draft;
    const [a,b] = await Promise.all([
      approveImportCase(staff, { ...args, draft: savedDraft, expectedRevision: String(reopened.revision), override: true, overrideReason: reason }),
      approveImportCase(staff, { ...args, draft: savedDraft, expectedRevision: String(reopened.revision), override: true, overrideReason: reason }),
    ]);
    expect(a.client_id).toBe(b.client_id);
    expect([a.idempotent,b.idempotent].sort()).toEqual([false,true]);
    const [client] = await db`select current_status,assigned_staff from clients where id=${a.client_id}`;
    expect(client).toMatchObject({ current_status: "new_intake", assigned_staff: staff.staff.id });
    const logs = await db`select staff_id,new_value from activity_log where client_id=${a.client_id} and action='client_updated' and entity_type='client_import_case' and entity_id=${own}`;
    expect(logs).toHaveLength(1);
    expect(logs[0].staff_id).toBe(staff.staff.id);
    expect(logs[0].new_value.override).toMatchObject({ reason, actor_id: staff.staff.id, outstanding_fields: expect.arrayContaining(["source_documents"]) });
    const [finished] = await db`select verification_result from client_import_cases where id=${own}`;
    expect(finished.verification_result.workflow_override).toMatchObject({ state: "APPROVED", started_by: staff.staff.id, completed_by: staff.staff.id });
  });

  it("defers delayed OCR and linked client submission without erasing a pending override", async () => {
    const name = `TEST Pending OCR ${randomUUID()}`;
    const staged = await stageMobileImportV2({ session: manager, notes: `Full Name: ${name}\nPhone: 6165568899`, files: [], idempotencyKey: randomUUID() });
    expect(staged.verification_result.processing_state).toBe("CAPTURED");
    const id = staged.case_id;
    const detail = await getImportCase(manager, id);
    const pending = await beginImportOverride(manager, { id, reviewerId: manager.staff.id, draft: detail.case.mapped_draft,
      documentConfirmed: false, informationConfirmed: false, expectedRevision: String(detail.case.revision), traceId: "pending-ocr" });
    await expect(enrichMobileImportCase(manager, id)).rejects.toMatchObject({ code: "pending_override_active" });
    const [link] = await db`insert into client_import_links(token_hash,status,issued_by,expires_at,import_case_id)
      values(${"c".repeat(64)},'PROCESSING',${manager.staff.id},now()+interval '1 hour',${id}) returning id`;
    await expect(stageMobileImportV2({ session: manager, notes: `Full Name: ${name}\nPhone: 6165568899`, files: [], idempotencyKey: randomUUID(), targetCaseId: id, linkId: String(link.id) }))
      .rejects.toMatchObject({ code: "pending_override_active" });
    const resumed = await getImportCase(manager, id);
    expect(resumed.case.verification_result.workflow_override).toMatchObject({ state: "PENDING_OVERRIDE", started_by: manager.staff.id });
    expect(resumed.case.revision).toBe(pending.revision);
    await cancelImportOverride(manager, id, String(pending.revision), "pending-ocr-cancel");
  });

  it("fences an interrupted capture, keeps already stored documents, and refuses a late writer", async () => {
    const staged = await stageSheetRows({ session: manager, source: "csv", idempotencyKey: randomUUID(), rows: [{ full_name: `TEST Capture Recovery ${randomUUID()}`, phone: "6165568877" }] });
    const id = String(staged.cases[0].id), generation = randomUUID();
    await db`update client_import_cases set verification_result=${db.json({ processing_state: "CAPTURING", capture_generation: generation })} where id=${id}`;
    const [row] = await db`select revision::text as revision from client_import_cases where id=${id}`;
    await expect(recoverImportCapture(staff, id, String(row.revision), "capture-denied")).rejects.toMatchObject({ code: "forbidden" });
    await expect(beginImportOverride(manager, { id, reviewerId: manager.staff.id, draft: (await getImportCase(manager,id)).case.mapped_draft,
      documentConfirmed: false, informationConfirmed: false, expectedRevision: String(row.revision), traceId: "capture-begin" })).rejects.toMatchObject({ code: "capture_in_progress" });
    let unlock!: () => void;
    let acquired!: () => void;
    const entered = new Promise<void>(resolve => { acquired = resolve; });
    const release = new Promise<void>(resolve => { unlock = resolve; });
    const writer = db.begin(async tx => {
      await assertCaptureLease(tx, id, generation);
      acquired();
      await release;
      await tx`insert into client_import_documents(import_case_id,storage_reference,original_filename,mime_type,size_bytes,sha256,uploaded_by)
        values(${id},${`capture/${randomUUID()}`},'stored.pdf','application/pdf',1,${"d".repeat(64)},${manager.staff.id})`;
    });
    await entered;
    const recovery = recoverImportCapture(manager, id, String(row.revision), "capture-recovery");
    unlock();
    await writer;
    const recovered = await recovery;
    expect(recovered).toMatchObject({ state: "CAPTURE_INTERRUPTED", document_count: 1 });
    expect(await db`select id from client_import_documents where import_case_id=${id}`).toHaveLength(1);
    await expect(db.begin(tx => assertCaptureLease(tx, id, generation))).rejects.toMatchObject({ code: "capture_superseded" });
    const [saved] = await db`select verification_result from client_import_cases where id=${id}`;
    expect(saved.verification_result).toMatchObject({ processing_state: "CAPTURE_INTERRUPTED", capture_recovered_by: manager.staff.id, document_count: 1 });
    const [audit] = await db`select staff_id,detail from security_events where event='smart_import_capture_recovered' and detail->>'case_id'=${id}`;
    expect(audit).toMatchObject({ staff_id: manager.staff.id, detail: { case_id: id, capture_generation: generation, document_count: 1 } });
    const beforeReview = await getImportCase(manager, id);
    const reviewArgs = { id, reviewerId: manager.staff.id, draft: beforeReview.case.mapped_draft, documentConfirmed: false, informationConfirmed: false, traceId: "recovered-approval", expectedRevision: String(beforeReview.case.revision) };
    const savedReview = await saveImportReview(manager, reviewArgs);
    const afterReview = await getImportCase(manager, id);
    expect(afterReview.case.verification_result.source_capture_incomplete).toBe(true);
    await expect(approveImportCase(manager, { ...reviewArgs, draft: afterReview.case.mapped_draft, expectedRevision: String(savedReview.revision), override: true, overrideReason: "Remaining sources to be collected" })).rejects.toMatchObject({ code: "pending_override_required" });
    const pending = await beginImportOverride(manager, { ...reviewArgs, draft: afterReview.case.mapped_draft, expectedRevision: String(savedReview.revision) });
    const resumed = await getImportCase(manager, id);
    expect(resumed.case.verification_result.workflow_override.outstanding_fields).toContain("source_capture");
    const approved = await approveImportCase(manager, { ...reviewArgs, draft: resumed.case.mapped_draft, expectedRevision: String(pending.revision), override: true, overrideReason: "Remaining sources to be collected" });
    const [approvalLog] = await db`select new_value from activity_log where client_id=${approved.client_id} and action='client_updated' and entity_id=${id}`;
    expect(approvalLog.new_value.override.outstanding_fields).toContain("source_capture");
  });
});
