import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { withStaff, type StaffSession } from "@/lib/auth";
import { approveImportCase, assignImportReviewer, getImportCase, getImportDocument, saveImportReview, stageSheetRows, verifyImportCase } from "@/lib/smart-client-import";
import { listActiveImportQueue, listArchivedImportQueue } from "@/lib/smart-import-archive";

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2 });
let manager: StaffSession;
let staff: StaffSession;
let other: StaffSession;

async function makeStaff(role: "manager" | "staff"): Promise<StaffSession> {
  const authId = randomUUID();
  const email = `smart-scope-${authId}@test.invalid`;
  await db`insert into auth.users (id,email) values (${authId},${email})`;
  const [row] = await db`insert into staff (display_name,email,role,auth_user_id,active)
    values (${`TEST Smart Scope ${role}`},${email},${role},${authId},true) returning id,display_name,email,role`;
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
      const [row] = await db`select to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as revision from client_import_cases where id=${id}`;
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
    const args = { id: own, reviewerId: staff.staff.id, draft: detail.case.mapped_draft, documentConfirmed: false, informationConfirmed: false, traceId: "scope-approve", expectedUpdatedAt: String(detail.case.updated_at) };
    await expect(verifyImportCase(other, own, String(detail.case.updated_at))).rejects.toMatchObject({ code: "not_found" });
    await expect(saveImportReview(staff, { ...args, reviewerId: other.staff.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(approveImportCase(staff, { ...args, expectedUpdatedAt: undefined })).rejects.toMatchObject({ code: "review_version_required" });
    await expect(approveImportCase(staff, args)).rejects.toMatchObject({ code: "override_required" });
    await db`update staff set custom_permissions=array[]::text[] where id=${staff.staff.id}`;
    await expect(approveImportCase(staff, { ...args, override: true, overrideReason: "Documents due at next visit" })).rejects.toMatchObject({ code: "forbidden" });
    await db`update staff set custom_permissions=array['review_smart_import'] where id=${staff.staff.id}`;
    const reason = "Documents due at next visit";
    const [a,b] = await Promise.all([
      approveImportCase(staff, { ...args, override: true, overrideReason: reason }),
      approveImportCase(staff, { ...args, override: true, overrideReason: reason }),
    ]);
    expect(a.client_id).toBe(b.client_id);
    expect([a.idempotent,b.idempotent].sort()).toEqual([false,true]);
    const [client] = await db`select current_status,assigned_staff from clients where id=${a.client_id}`;
    expect(client).toMatchObject({ current_status: "new_intake", assigned_staff: staff.staff.id });
    const logs = await db`select staff_id,new_value from activity_log where client_id=${a.client_id} and action='client_updated' and entity_type='client_import_case' and entity_id=${own}`;
    expect(logs).toHaveLength(1);
    expect(logs[0].staff_id).toBe(staff.staff.id);
    expect(logs[0].new_value.override).toMatchObject({ reason, actor_id: staff.staff.id, outstanding_fields: expect.arrayContaining(["source_documents"]) });
  });
});
