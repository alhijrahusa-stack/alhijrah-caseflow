import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { findClientIdentityMatches, insertClient, logActivity } from "@/lib/service";
import { prepareImportDraft } from "@/lib/smart-client-import-core";
import { approveImportCase, saveImportReview, verifyImportCase } from "@/lib/smart-client-import";

vi.mock("@/lib/db", () => ({ sql: vi.fn() }));
vi.mock("@/lib/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/service")>()),
  findClientIdentityMatches: vi.fn(),
  insertClient: vi.fn(),
  logActivity: vi.fn(),
}));

const manager: StaffSession = {
  authUserId: "actor-auth",
  staff: { id: "actual-manager", display_name: "Review Manager", email: null, role: "manager" },
};
const reviewerId = "assigned-reviewer";
const version = "2026-10-30T15:00:00.123Z";
const nextVersion = "2026-10-30T15:00:01.456Z";
const sourceConflict = {
  field_key: "date_of_birth", type: "SOURCE_CONFLICT",
  values: [{ value: "1976-01-01", source: "document" }, { value: "1976-01-02", source: "local_text" }],
};
const sourceEvidence = [{ field_key: "date_of_birth", value: "1976-01-01", source_type: "document", verification_state: "CONFLICT" }];

function draft() {
  return prepareImportDraft({ full_name: "Review Test Client", phone: "3135550199", date_of_birth: "1976-01-01" });
}

function database(overrides: Record<string, unknown> = {}) {
  const row = {
    id: "case-1", batch_id: "batch-1", status: "UNDER_REVIEW", source_type: "mobile",
    reviewer_id: reviewerId, review_started_at: version, updated_at: new Date(version), archived_at: null,
    mapped_draft: draft(), field_evidence: sourceEvidence, conflicts: [sourceConflict],
    public_ref: "CG-2026-123456", ...overrides,
  };
  const statements: { text: string; values: unknown[] }[] = [];
  const query = vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const text = parts.join("?").replace(/\s+/g, " ").trim();
    statements.push({ text, values });
    if (text.startsWith("select id from staff where")) return [{ id: reviewerId }];
    if (text.includes("from client_import_cases") && text.includes("for update")) return [row];
    if (text.startsWith("select count(*)::int as count from client_import_documents")) return [{ count: 0 }];
    if (text.startsWith("select idempotency_key from client_import_batches")) return [{ idempotency_key: "staff-import:test" }];
    if (text.startsWith("select * from client_import_documents")) return [];
    if (text.startsWith("insert into tasks")) return [{ id: "missing-documents-task" }];
    if (text.startsWith("update client_import_cases")) return [{ id: row.id, status: row.status, updated_at: new Date(nextVersion) }];
    throw new Error(`Unexpected review persistence query: ${text}`);
  });
  const transaction = Object.assign(query, { json: (value: unknown) => value });
  const connection = Object.assign(query, { begin: async (fn: (tx: typeof transaction) => Promise<unknown>) => fn(transaction) });
  vi.mocked(sql).mockReturnValue(connection as unknown as ReturnType<typeof sql>);
  return { row, statements };
}

function saveArgs() {
  return { id: "case-1", reviewerId, draft: draft(), documentConfirmed: true, informationConfirmed: true, expectedUpdatedAt: version };
}

function approvalArgs() {
  return { ...saveArgs(), traceId: "review-audit-trace" };
}

describe("Smart Review persistence and audit regressions", () => {
  beforeEach(() => {
    vi.mocked(findClientIdentityMatches).mockResolvedValue([]);
    vi.mocked(insertClient).mockResolvedValue({ id: "canonical-client", ref: "CG-2026-123456" } as Awaited<ReturnType<typeof insertClient>>);
    vi.mocked(logActivity).mockResolvedValue(undefined);
  });
  afterEach(() => vi.resetAllMocks());

  it("persists an explicit same-value source conflict resolution with original evidence and the actual actor", async () => {
    const state = database();
    const result = await saveImportReview(manager, { ...saveArgs(), resolvedFields: ["date_of_birth"] });
    const update = state.statements.find((statement) => statement.text.startsWith("update client_import_cases"))!;
    const evidence = update.values.find((value) => Array.isArray(value) && value.some((entry) => entry?.source_type === "manual_review")) as Record<string, unknown>[];
    expect(result.updated_at).toEqual(new Date(nextVersion));
    expect(evidence[0]).toEqual(sourceEvidence[0]);
    expect(evidence).toContainEqual(expect.objectContaining({
      field_key: "date_of_birth", value: "1976-01-01", previous_value: "1976-01-01",
      reviewer_id: reviewerId, actor_id: manager.staff.id, authority: "MANUAL",
      resolution: "CONFIRMED_BY_REVIEWER", resolved_conflicts: [sourceConflict],
    }));
    expect(update.text).toContain("conflicts=?");
    expect(update.values[4]).toEqual([]);
    expect(update.text).toContain("verification_result='{}'::jsonb");
    expect(state.row.field_evidence).toEqual(sourceEvidence);
    expect(state.row.conflicts).toEqual([sourceConflict]);
  });

  it("retains unresolved source conflicts and global identity blockers while saving another field", async () => {
    const identity = { type: "IDENTITY", field_key: "date_of_birth", client_id: "other-client" };
    const addressConflict = { field_key: "city", type: "SOURCE_CONFLICT", values: ["Detroit", "Dearborn"] };
    const state = database({ conflicts: [sourceConflict, identity, addressConflict] });
    await saveImportReview(manager, { ...saveArgs(), resolvedFields: ["date_of_birth"] });
    const update = state.statements.find((statement) => statement.text.startsWith("update client_import_cases"))!;
    expect(update.values[4]).toEqual([identity, addressConflict]);
  });

  it("rejects stale-tab saves before any write and keeps the newer stored draft", async () => {
    const state = database({ updated_at: new Date(nextVersion) });
    await expect(saveImportReview(manager, saveArgs())).rejects.toMatchObject({ code: "review_changed", status: 409 });
    expect(state.statements.some((statement) => statement.text.startsWith("update"))).toBe(false);
    expect(state.row.mapped_draft).toEqual(draft());
  });

  it("rejects unknown resolution keys before persisting a draft", async () => {
    const state = database();
    await expect(saveImportReview(manager, { ...saveArgs(), resolvedFields: ["approved_by"] })).rejects.toMatchObject({ code: "invalid_resolution", status: 400 });
    expect(state.statements.some((statement) => statement.text.startsWith("update"))).toBe(false);
  });

  it("refuses edits to an import archived after the initial API lookup", async () => {
    const state = database({ archived_at: new Date(nextVersion) });
    await expect(saveImportReview(manager, saveArgs())).rejects.toMatchObject({ code: "archived", status: 409 });
    expect(state.statements.some((statement) => statement.text.startsWith("update"))).toBe(false);
  });

  it("records unsaved field changes and same-value conflict resolutions when approving directly", async () => {
    const state = database();
    const changed = draft();
    changed.profile.phone = "3135550177";
    const result = await approveImportCase(manager, { ...approvalArgs(), draft: changed, resolvedFields: ["date_of_birth"] });
    expect(result).toEqual({ client_id: "canonical-client", ref: "CG-2026-123456", idempotent: false });
    expect(insertClient).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      profile: expect.objectContaining({ phone: "3135550177" }), createdBy: manager.staff.id,
    }), { staffId: manager.staff.id, traceId: "review-audit-trace" });
    const update = state.statements.find((statement) => statement.text.includes("status='APPROVED_FILE'"))!;
    const evidence = update.values.find((value) => Array.isArray(value) && value.some((entry) => entry?.source_type === "manual_review")) as Record<string, unknown>[];
    expect(evidence[0]).toEqual(sourceEvidence[0]);
    expect(evidence).toContainEqual(expect.objectContaining({ field_key: "phone", value: "3135550177", previous_value: "3135550199", actor_id: manager.staff.id }));
    expect(evidence).toContainEqual(expect.objectContaining({ field_key: "date_of_birth", resolution: "CONFIRMED_BY_REVIEWER", resolved_conflicts: [sourceConflict] }));
  });

  it("approves unmatched source readings without confirmations and carries outstanding review into tasks and audit", async () => {
    const state = database();
    const result = await approveImportCase(manager, { ...approvalArgs(), documentConfirmed: false, informationConfirmed: false });
    expect(result.client_id).toBe("canonical-client");
    const update = state.statements.find((statement) => statement.text.includes("status='APPROVED_FILE'"))!;
    expect(update.values[2]).toEqual(sourceEvidence);
    expect(update.values[4]).toEqual([sourceConflict]);
    expect(update.values[5]).toMatchObject({ approval_ready: true, blockers: [], source_conflicts: 1, blocking_conflicts: 0, document_match_confirmed: false, information_match_confirmed: false });
    expect(update.values[6]).toBe(false);
    expect(update.values[7]).toBe(false);
    const followup = state.statements.find((statement) => statement.text.includes("'Complete client intake review'"))!;
    expect(String(followup.values[1])).toContain("Date of Birth has differing source readings");
    expect(String(followup.values[1])).toContain("matching remains unconfirmed");
    expect(state.statements.some((statement) => statement.text.includes("'Collect missing client documents'"))).toBe(true);
    expect(logActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      entityType: "client_import_case", entityId: "case-1",
      newValue: expect.objectContaining({ document_match_confirmed: false, information_match_confirmed: false, follow_up_required: true, source_conflict_count: 1 }),
    }));
    expect(state.row.field_evidence).toEqual(sourceEvidence);
    expect(state.row.conflicts).toEqual([sourceConflict]);
  });

  it("rejects stale direct approvals before creating a canonical client", async () => {
    const state = database({ updated_at: new Date(nextVersion) });
    await expect(approveImportCase(manager, approvalArgs())).rejects.toMatchObject({ code: "review_changed", status: 409 });
    expect(insertClient).not.toHaveBeenCalled();
    expect(state.statements.some((statement) => statement.text.startsWith("update"))).toBe(false);
  });

  it("returns the new revision from verification for the following approval", async () => {
    database({ conflicts: [] });
    const result = await verifyImportCase(manager, "case-1", version);
    expect(result).toMatchObject({ approval_ready: true, updated_at: new Date(nextVersion) });
  });

  it("rejects stale verification without replacing current findings", async () => {
    const state = database({ updated_at: new Date(nextVersion) });
    await expect(verifyImportCase(manager, "case-1", version)).rejects.toMatchObject({ code: "review_changed", status: 409 });
    expect(state.statements.some((statement) => statement.text.startsWith("update"))).toBe(false);
  });
});
