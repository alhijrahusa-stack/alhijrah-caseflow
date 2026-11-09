import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ImportReviewRequest } from "@/lib/import-duplicate-contract";

describe("import review request contract", () => {
  it("supports ready reasons without free text and rejects incomplete target selection", () => {
    const input = { action: "submit", case_id: randomUUID(), fingerprint: "a".repeat(32), reason: "manager_review", operation_id: randomUUID() };
    expect(ImportReviewRequest.safeParse(input).success).toBe(true);
    expect(ImportReviewRequest.safeParse({ ...input, target_kind: "client" }).success).toBe(false);
    expect(ImportReviewRequest.safeParse({ ...input, reason: "arbitrary" }).success).toBe(false);
  });
  it("requires an explicit typed record and valid operation id for restoration", () => {
    expect(ImportReviewRequest.safeParse({ action: "restore", case_id: randomUUID(), operation_id: randomUUID() }).success).toBe(true);
    expect(ImportReviewRequest.safeParse({ action: "restore", case_id: randomUUID() }).success).toBe(false);
  });
});
