import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as operate } from "@/app/api/staff/operations/route";
import { type StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { addGateJobEmail, confirmGateJobAssignment, markGateJobAccountReady, reserveGateJobEmail } from "@/lib/gate-job-account/service";
import { resolveManagerReview, submitManagerReview } from "@/lib/manager-inbox";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";
import { staffGuard } from "@/lib/staff-api";

// Only the HTTP session adapter is a fixture. Both routes below execute their
// actual SQL and RLS transactions against the migrated PostgreSQL database.
vi.mock("@/lib/staff-api", () => ({ staffGuard: vi.fn() }));
const db = sql();
let admin: StaffSession;
let phone = 7400;
const trace = "document-proof-regression";

beforeAll(async () => {
  const authUserId = randomUUID();
  const email = `document-proof-${authUserId}@test.invalid`;
  await db`insert into auth.users(id,email) values(${authUserId},${email})`;
  const [staff] = await db`insert into staff(display_name,email,role,auth_user_id)
    values('TEST Document Proof Admin',${email},'admin',${authUserId}) returning id,display_name,email,role`;
  admin = { authUserId, staff: staff as StaffSession["staff"] };
  vi.mocked(staffGuard).mockResolvedValue({ session: admin, response: null });
});
afterAll(async () => { await db.end(); });

async function preparedAccountClient() {
  const client = await db.begin(tx => insertClient(tx, {
    source: "staff_manual", profile: ProfileSchema.parse({ full_name: `TEST Document Proof ${++phone}`, phone: `313555${phone}`, employment_history: [] }),
    primary: [], backup: [], status: "ready_to_apply", nextStep: null, assignedStaff: admin.staff.id, createdBy: admin.staff.id, communicationConsent: false,
  }, { staffId: admin.staff.id, traceId: trace }));
  // Exercise the encrypted vault's actual lifecycle instead of faking a
  // clients flag or inserting an unvalidated READY account directly.
  const vault = await addGateJobEmail(admin, { email: `document-proof-${randomUUID()}@test.invalid`, password: "SyntheticFixturePassword-1", pin: "123456" }, trace);
  await reserveGateJobEmail(admin, vault.id, client.id, trace);
  const account = await confirmGateJobAssignment(admin, vault.id, client.id, trace);
  expect((await markGateJobAccountReady(admin, account.id, trace)).status).toBe("READY");
  await db`update requirements set status='complete' where client_id=${client.id} and requirement_key not like 'post_hire:%'`;
  return client;
}

async function document(clientId: string, status: "verified" | "rejected", uploadedAt: string) {
  const [row] = await db`insert into documents(client_id,doc_type,storage_path,file_name,mime_type,size_bytes,status,reviewed_by,reviewed_at,rejection_reason,uploaded_by,uploaded_at)
    values(${clientId},'photo_id',${`test/document-proof/${randomUUID()}.png`},'TEST document proof.png','image/png',32,${status},
      ${admin.staff.id},${uploadedAt},${status === "rejected" ? "Latest uploaded document is unreadable" : null},${admin.staff.id},${uploadedAt}) returning id`;
  return String(row.id);
}

describe("current document evidence on both manual lifecycle entry points", () => {
  it.each(["manager_inbox", "bulk_operations"] as const)("%s rejects a superseding rejected document and accepts its verified replacement without deleting history", async mode => {
    const client = await preparedAccountClient();
    const review = mode === "manager_inbox" ? await submitManagerReview(admin, { kind: "client", client_id: client.id, request_key: randomUUID(), note: "Review latest document proof" }, trace) : null;
    const bulk = () => operate(new Request("http://localhost/api/staff/operations", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "bulk_assign", client_ids: [client.id], target_stage: "job_ready", reason: "Latest documents reviewed" }) }));
    const route = async () => resolveManagerReview(admin, { id: review!.id, destination: "job_ready", note: "Latest documents reviewed", expected_client_version: String((await db`select updated_at::text version from clients where id=${client.id}`)[0].version) }, trace);
    async function expectBlocked() {
      if (mode === "manager_inbox") await expect(route()).rejects.toMatchObject({ code: "requirements_missing" });
      else { const response = await bulk(); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ ok: false, error: { code: "requirements_missing" } }); }
      expect((await db`select current_status from clients where id=${client.id}`)[0].current_status).toBe("ready_to_apply");
    }
    await expectBlocked(); // A READY account with zero document proof is insufficient.
    const oldVerified = await document(client.id, "verified", "2026-10-01T10:00:00Z");
    const rejectedReplacement = await document(client.id, "rejected", "2026-10-01T11:00:00Z");
    await expectBlocked();
    if (review) expect((await db`select status from manager_inbox where id=${review.id}`)[0].status).toBe("open");
    const newVerified = await document(client.id, "verified", "2026-10-01T12:00:00Z");
    if (mode === "manager_inbox") expect(await route()).toMatchObject({ already_resolved: false, client_id: client.id });
    else { const response = await bulk(); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, changed: 1, stage: "job_ready" }); }
    expect((await db`select current_status,pipeline_stage from clients where id=${client.id}`)[0]).toMatchObject({ current_status: "shift_selected", pipeline_stage: "amazon_account_waiting_job" });
    const history = await db`select id,status from documents where client_id=${client.id} order by uploaded_at,id`;
    expect(history).toEqual([{ id: oldVerified, status: "verified" }, { id: rejectedReplacement, status: "rejected" }, { id: newVerified, status: "verified" }]);
  });
});
