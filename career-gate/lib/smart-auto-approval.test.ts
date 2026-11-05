import { describe, expect, it } from "vitest";
import { autoApprovalDecision, autoApprovalThreshold, type AutoApprovalInput } from "@/lib/smart-auto-approval";

const doc = (field_key: string, value: string, confidence_score: number | null) => ({ field_key, value, source_type: "document", confidence_score });
const base: AutoApprovalInput = {
  threshold: 0.9, aiState: "COMPLETE", documentCount: 1, extractionErrors: [], conflicts: [], reviewed: false,
  draftFullName: "JOHN DOE", draftPhone: "3135550100",
  evidence: [doc("full_name", "JOHN DOE", 0.97), doc("date_of_birth", "1990-04-05", 0.93), { field_key: "phone", value: "3135550100", source_type: "local_text", confidence_score: null }],
};

describe("auto-approval threshold", () => {
  it("defaults to 0.9, can be switched off, and is never loosened by a bad value", () => {
    expect(autoApprovalThreshold(undefined)).toBe(0.9);
    expect(autoApprovalThreshold("")).toBe(0.9);
    expect(autoApprovalThreshold("0.95")).toBe(0.95);
    expect(autoApprovalThreshold("off")).toBeNull();
    expect(autoApprovalThreshold("0")).toBeNull();
    expect(autoApprovalThreshold("abc")).toBe(0.9);
    expect(autoApprovalThreshold("7")).toBe(0.9);
    expect(autoApprovalThreshold("0.2")).toBe(0.5);
  });
});

describe("auto-approval decision", () => {
  it("approves when every identity reading from the documents is at or above the threshold", () => {
    expect(autoApprovalDecision(base)).toEqual({ eligible: true, threshold: 0.9, confidence: { full_name: 0.97, date_of_birth: 0.93 } });
    expect(autoApprovalDecision({ ...base, evidence: [doc("full_name", "JOHN DOE", 0.9)] })).toMatchObject({ eligible: true, confidence: { full_name: 0.9 } });
  });

  it("uses the lowest reading when several documents give the same field", () => {
    const evidence = [doc("full_name", "JOHN DOE", 0.99), doc("full_name", "JOHN DOE", 0.88)];
    expect(autoApprovalDecision({ ...base, evidence, documentCount: 2 })).toEqual({ eligible: false, reason: "full_name_below_threshold" });
  });

  it.each([
    ["disabled", { threshold: null }],
    ["review_started", { reviewed: true }],
    ["no_documents", { documentCount: 0 }],
    ["ai_partial", { aiState: "PARTIAL" }],
    ["ai_failed", { aiState: "FAILED" }],
    ["extraction_errors", { extractionErrors: [{ code: "MULTIPLE_CLIENTS_DETECTED" }] }],
    ["source_conflicts", { conflicts: [{ field_key: "date_of_birth", type: "SOURCE_CONFLICT" }] }],
    ["full_name_missing", { draftFullName: " " }],
    ["phone_missing", { draftPhone: null }],
    ["full_name_not_from_document", { evidence: [{ field_key: "full_name", value: "JOHN DOE", source_type: "local_text", confidence_score: null }] }],
    ["full_name_confidence_unknown", { evidence: [doc("full_name", "JOHN DOE", null)] }],
    ["full_name_below_threshold", { evidence: [doc("full_name", "JOHN DOE", 0.89)] }],
    ["date_of_birth_below_threshold", { evidence: [doc("full_name", "JOHN DOE", 0.97), doc("date_of_birth", "1990-04-05", 0.6)] }],
  ] as const)("leaves the file for a person: %s", (reason, change) => {
    expect(autoApprovalDecision({ ...base, ...change } as AutoApprovalInput)).toEqual({ eligible: false, reason });
  });
});
