import { describe, it, expect } from "vitest";
import { DOCUMENT_AUTOFILL_CONFIDENCE_FLOOR, mergeIntakeDocumentSuggestions } from "@/lib/client-intake-extraction";

const record = (row: Record<string, string>, confidence = 0.98) =>
  ({ row, confidence: Object.fromEntries(Object.keys(row).map((key) => [key, confidence])) });

describe("Client Intake Link document auto-fill evidence", () => {
  it("normalizes explicit dates, contact details and English proficiency before filling the form", () => {
    const result = mergeIntakeDocumentSuggestions([{ filename: "id.pdf", rows: [record({
      full_name: "Nadia Example", date_of_birth: "04/11/1992", phone: "(313) 555-0167",
      email: "NADIA@example.com", english_proficiency: "Good", preferred_language: "Arabic",
    })] }]);
    expect(result.fields).toMatchObject({
      full_name: "Nadia Example", date_of_birth: "1992-04-11", phone: "3135550167",
      email: "nadia@example.com", english_proficiency: "GOOD", preferred_language: "ar",
    });
    expect(result.review_fields).toEqual([]);
  });

  it("never chooses between conflicting source values", () => {
    const result = mergeIntakeDocumentSuggestions([
      { filename: "front.png", rows: [record({ full_name: "Nadia Example", phone: "3135550101" })] },
      { filename: "back.png", rows: [record({ full_name: "Nadia Example", phone: "3135550199" })] },
    ]);
    expect(result.fields.full_name).toBe("Nadia Example");
    expect(result.fields.phone).toBeUndefined();
    expect(result.review_reasons.phone).toBe("conflict");
    expect(result.field_sources.phone).toEqual(["front.png", "back.png"]);
  });

  it("quarantines all fields when the documents belong to different applicants", () => {
    const result = mergeIntakeDocumentSuggestions([
      { filename: "a.pdf", rows: [record({ full_name: "Nadia Example", email: "a@example.com" })] },
      { filename: "b.pdf", rows: [record({ full_name: "Another Person", phone: "3135550101" })] },
    ]);
    expect(result.fields).toEqual({});
    expect(result.review_reasons.email).toBe("identity_conflict");
    expect(result.review_reasons.phone).toBe("identity_conflict");
    expect(result.document_warnings).toHaveLength(1);
  });

  it("does not auto-fill multiple clients extracted from the same document", () => {
    const result = mergeIntakeDocumentSuggestions([{ filename: "two.pdf", rows: [
      record({ full_name: "Nadia Example" }), record({ full_name: "Other Person" }),
    ] }]);
    expect(result.fields).toEqual({});
    expect(result.review_reasons.full_name).toBe("multiple_applicants");
  });

  it("flags uncertain or invalid values for manual review without falsifying them", () => {
    const result = mergeIntakeDocumentSuggestions([{ filename: "blurry.png", rows: [
      { row: { date_of_birth: "32/33/2020", email: "not-an-email", phone: "3135550101" },
        confidence: { date_of_birth: 0.99, email: 0.99, phone: DOCUMENT_AUTOFILL_CONFIDENCE_FLOOR - 0.01 } },
    ] }]);
    expect(result.fields).toEqual({});
    expect(result.review_reasons).toMatchObject({ date_of_birth: "invalid_value", email: "invalid_value", phone: "low_confidence" });
  });

  it("never treats missing model confidence as proof of accuracy", () => {
    const result = mergeIntakeDocumentSuggestions([{ filename: "a.png", rows: [{ row: { city: "Dearborn" } }] }]);
    expect(result.fields.city).toBeUndefined();
    expect(result.review_reasons.city).toBe("low_confidence");
  });
});
