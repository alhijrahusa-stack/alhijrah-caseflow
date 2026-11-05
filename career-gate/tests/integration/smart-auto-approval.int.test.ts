import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import type { StaffSession } from "@/lib/auth";
import { enrichMobileImportCase, stageMobileImportV2 } from "@/lib/smart-client-mobile";
import { startImportReview } from "@/lib/smart-client-import";
import { rowsFromImageOrPdfDetailed } from "@/lib/universal-intake";

// Fixtures: object storage and the Gemini document reader. Staging, enrichment,
// the decision, approval (duplicate and identity checks), triggers and the
// audit trail run for real against the migrated database.
vi.mock("@/lib/storage", () => ({
  uploadObject: vi.fn(async () => undefined),
  downloadObject: vi.fn(async () => new Uint8Array([137, 80, 78, 71])),
  removeObject: vi.fn(async () => undefined),
}));
vi.mock("@/lib/universal-intake", async (original) => ({
  ...(await original<typeof import("@/lib/universal-intake")>()),
  rowsFromImageOrPdfDetailed: vi.fn(),
}));

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
let manager: StaffSession;
let phone = 8800;

function reads(row: Record<string, string>, confidence: Record<string, number>) {
  vi.mocked(rowsFromImageOrPdfDetailed).mockResolvedValue([{ row, confidence }] as never);
}

async function stage(name: string) {
  const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "id-card.png", { type: "image/png" });
  const staged = await stageMobileImportV2({
    session: manager, notes: `Phone: 313555${++phone}`, files: [file], idempotencyKey: `auto-${randomUUID()}`,
  });
  return { caseId: String(staged.case_id), name };
}

beforeAll(async () => {
  const authId = randomUUID();
  await db`insert into auth.users (id,email) values (${authId},${`auto-approve-${authId}@test.invalid`})`;
  const [staff] = await db`
    insert into staff (display_name,email,role,auth_user_id,active)
    values (${`TEST Auto Approve ${authId.slice(0, 8)}`},${`auto-approve-${authId}@test.invalid`},'manager',${authId},true)
    returning id,display_name,email,role`;
  manager = { authUserId: authId, staff: staff as StaffSession["staff"] };
});
afterEach(() => { delete process.env.SMART_AUTO_APPROVE_MIN_CONFIDENCE; });
afterAll(async () => { await db.end(); });

describe("Smart Collect automatic approval (identity confidence >= 90%)", () => {
  it("approves a file whose identity was read at 90% or more and records it as automatic", async () => {
    const { caseId } = await stage("auto");
    reads({ full_name: "TEST AUTO NADIA HASSAN", date_of_birth: "1991-03-14" }, { full_name: 0.96, date_of_birth: 0.92 });
    const result = await enrichMobileImportCase(manager, caseId, "auto-approve-ok");
    expect(result.auto_approval).toMatchObject({ status: "approved", threshold: 0.9, confidence: { full_name: 0.96, date_of_birth: 0.92 } });

    const [row] = await db`select status,approved_by,reviewer_id,created_client_id,verification_result,document_match_confirmed from client_import_cases where id=${caseId}`;
    expect(row).toMatchObject({ status: "APPROVED_FILE", approved_by: manager.staff.id, reviewer_id: manager.staff.id, document_match_confirmed: false });
    expect(row.verification_result.auto_approval).toMatchObject({ approved_automatically: true, threshold: 0.9 });
    const [client] = await db`select full_name,phone from clients where id=${row.created_client_id}`;
    expect(client.full_name).toBe("TEST AUTO NADIA HASSAN");
    const [log] = await db`select new_value from activity_log where client_id=${row.created_client_id} and entity_type='client_import_case'`;
    expect(log.new_value.auto_approval).toMatchObject({ approved_automatically: true, confidence: { full_name: 0.96 } });
    expect(log.new_value.override.reason).toMatch(/Automatic approval/);
    // Follow-up work for what was not read still reaches a person.
    const tasks = await db`select title from tasks where client_id=${row.created_client_id}`;
    expect(tasks.map(task => task.title)).toContain("Complete client intake review");
  });

  it("leaves the file for a person when a reading is below 90%", async () => {
    const { caseId } = await stage("low");
    reads({ full_name: "TEST AUTO LOW READING", date_of_birth: "1990-01-01" }, { full_name: 0.97, date_of_birth: 0.7 });
    const result = await enrichMobileImportCase(manager, caseId, "auto-approve-low");
    expect(result.auto_approval).toEqual({ status: "not_eligible", reason: "date_of_birth_below_threshold" });
    const [row] = await db`select status,created_client_id,verification_result from client_import_cases where id=${caseId}`;
    expect(row.status).not.toBe("APPROVED_FILE");
    expect(row.created_client_id).toBeNull();
    expect(row.verification_result.auto_approval).toEqual({ status: "not_eligible", reason: "date_of_birth_below_threshold" });
  });

  it("does not approve a file a person has opened", async () => {
    const { caseId } = await stage("opened");
    await startImportReview(manager, caseId, manager.staff.id);
    reads({ full_name: "TEST AUTO OPENED FILE" }, { full_name: 0.99 });
    const result = await enrichMobileImportCase(manager, caseId, "auto-approve-opened");
    expect(result.auto_approval).toEqual({ status: "not_eligible", reason: "review_started" });
    expect((await db`select status from client_import_cases where id=${caseId}`)[0].status).toBe("UNDER_REVIEW");
  });

  it("still refuses a duplicate identity, and can be switched off", async () => {
    const first = await stage("dup-1");
    reads({ full_name: "TEST AUTO SAME PERSON", date_of_birth: "1985-07-07" }, { full_name: 0.98, date_of_birth: 0.98 });
    expect((await enrichMobileImportCase(manager, first.caseId, "auto-dup-1")).auto_approval.status).toBe("approved");
    const [{ phone: firstPhone }] = await db`select c.phone from clients c join client_import_cases i on i.created_client_id=c.id where i.id=${first.caseId}`;

    // Same person, same phone, in a second upload: approval's duplicate check refuses it.
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "id-card.png", { type: "image/png" });
    const second = await stageMobileImportV2({ session: manager, notes: `Phone: ${firstPhone}`, files: [file], idempotencyKey: `auto-${randomUUID()}` });
    const outcome = (await enrichMobileImportCase(manager, String(second.case_id), "auto-dup-2")).auto_approval;
    expect(outcome.status).not.toBe("approved");
    expect((await db`select created_client_id from client_import_cases where id=${String(second.case_id)}`)[0].created_client_id).toBeNull();

    process.env.SMART_AUTO_APPROVE_MIN_CONFIDENCE = "off";
    const off = await stage("off");
    reads({ full_name: "TEST AUTO SWITCHED OFF" }, { full_name: 0.99 });
    expect((await enrichMobileImportCase(manager, off.caseId, "auto-off")).auto_approval).toEqual({ status: "not_eligible", reason: "disabled" });
  });
});
