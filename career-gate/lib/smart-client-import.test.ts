import { describe, expect, it } from "vitest";
import {
  CANONICAL_IMPORT_HEADERS,
  IMPORT_SCHEMA_HASH,
  IMPORT_STATUSES,
  decomposeUsAddress,
  evidenceMatchScore,
  normalizeEvidenceValue,
  prepareImportDraft,
  readinessScore,
  requiredMissingFromDraft,
} from "@/lib/smart-client-import-core";
import { buildCareerGateImportTemplate } from "@/lib/smart-client-template";

describe("Smart Career Collect Client canonical import contract", () => {
  it("normalizes a valid row into the existing Client profile contract", () => {
    const draft = prepareImportDraft({
      "Full Name": "Test Client",
      "Phone": "+1 (313) 555-0199",
      "Email": "TEST@EXAMPLE.COM",
      "Preferred Language": "English",
      "Notes": "Imported for review",
    });
    expect(draft.profile.full_name).toBe("Test Client");
    expect(draft.profile.phone).toBe("3135550199");
    expect(draft.profile.email).toBe("test@example.com");
    expect(draft.status).toBe("new_intake");
    expect(draft.initial_note).toBe("Imported for review");
    expect(requiredMissingFromDraft(draft)).toEqual([]);
  });

  it("decomposes a deterministic combined US address without overriding explicit components", () => {
    expect(decomposeUsAddress("12091 BLOOM ST DETROIT, MI 48212-3678")).toEqual({
      street: "12091 BLOOM ST",
      city: "DETROIT",
      state: "MI",
      zip: "48212-3678",
    });
    const draft = prepareImportDraft({
      full_name: "Test Client",
      phone: "3135550199",
      address: "12091 BLOOM ST DETROIT, MI 48212-3678",
    });
    expect(draft.profile.street).toBe("12091 BLOOM ST");
    expect(draft.profile.city).toBe("DETROIT");
    expect(draft.profile.state).toBe("MI");
    expect(draft.profile.zip).toBe("48212-3678");

    const explicit = prepareImportDraft({
      full_name: "Test Client",
      phone: "3135550199",
      address: "12091 BLOOM ST DETROIT, MI 48212-3678",
      city: "Dearborn",
      state: "MI",
      zip: "48126",
    });
    expect(explicit.profile.city).toBe("Dearborn");
    expect(explicit.profile.state).toBe("MI");
    expect(explicit.profile.zip).toBe("48126");
  });

  it("rejects missing canonical minimum Client identity data", () => {
    expect(() => prepareImportDraft({ full_name: "Only Name", phone: null })).toThrow();
  });

  it("defines the exact import lifecycle and a stable SHA-256 schema hash", () => {
    expect(IMPORT_STATUSES).toEqual(["PENDING", "UNDER_REVIEW", "MISSING_DOCUMENT", "APPROVED_FILE"]);
    expect(IMPORT_SCHEMA_HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(CANONICAL_IMPORT_HEADERS[0]).toBe("full_name");
    expect(CANONICAL_IMPORT_HEADERS[1]).toBe("phone");
    expect(CANONICAL_IMPORT_HEADERS).toContain("backup_site_code");
    expect(CANONICAL_IMPORT_HEADERS).toContain("backup_shift_code");
  });

  it("normalizes evidence without silently resolving conflicts", () => {
    expect(normalizeEvidenceValue("phone", "+1 (313) 555-0199")).toBe("3135550199");
    expect(normalizeEvidenceValue("email", " TEST@Example.com ")).toBe("test@example.com");
    expect(evidenceMatchScore("full_name", "Abdullah Musaeed", "Abdullah Musaeed")).toBe(100);
    expect(evidenceMatchScore("full_name", "Abdullah Musaeed", "Abdullah Musaied")).toBeGreaterThan(80);
    expect(evidenceMatchScore("full_name", "Abdullah Musaeed", "Different Person")).toBeLessThan(50);
  });

  it("computes readiness from operational state rather than a decorative constant", () => {
    const ready = readinessScore({ requiredMissing: 0, blockingConflicts: 0, reviewerAssigned: true, verificationCompleted: true, documentConfirmed: true, informationConfirmed: true, documentCount: 1 });
    const blocked = readinessScore({ requiredMissing: 1, blockingConflicts: 1, reviewerAssigned: false, verificationCompleted: false, documentConfirmed: false, informationConfirmed: false, documentCount: 0 });
    expect(ready).toBe(100);
    expect(blocked).toBeLessThan(ready);
  });

  it("generates a real XLSX ZIP payload without a template dependency", () => {
    const workbook = buildCareerGateImportTemplate();
    expect(workbook.length).toBeGreaterThan(1000);
    expect(workbook[0]).toBe(0x50);
    expect(workbook[1]).toBe(0x4b);
  });
});