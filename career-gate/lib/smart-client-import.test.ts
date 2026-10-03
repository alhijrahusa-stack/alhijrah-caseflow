import { describe, expect, it } from "vitest";
import {
  CANONICAL_IMPORT_HEADERS,
  IMPORT_SCHEMA_HASH,
  IMPORT_STATUSES,
  prepareImportDraft,
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

  it("rejects missing canonical minimum Client identity data", () => {
    expect(() => prepareImportDraft({ full_name: "Only Name", phone: null })).toThrow();
  });

  it("defines the exact import lifecycle and a stable SHA-256 schema hash", () => {
    expect(IMPORT_STATUSES).toEqual(["PENDING", "UNDER_REVIEW", "MISSING_DOCUMENT", "APPROVED_FILE"]);
    expect(IMPORT_SCHEMA_HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(CANONICAL_IMPORT_HEADERS[0]).toBe("full_name");
    expect(CANONICAL_IMPORT_HEADERS[1]).toBe("phone");
  });

  it("generates a real XLSX ZIP payload without a template dependency", () => {
    const workbook = buildCareerGateImportTemplate();
    expect(workbook.length).toBeGreaterThan(1000);
    expect(workbook[0]).toBe(0x50);
    expect(workbook[1]).toBe(0x4b);
  });
});
