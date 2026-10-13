import { describe, expect, it } from "vitest";
import {
  combineDocumentFills,
  documentFilledKeys,
  resolveFieldValue,
  reviewReasonFor,
  type DocumentSuggestions,
} from "@/components/staff/smart/document-autofill";
import { SMART_FIELDS, type SmartField } from "@/components/staff/smart/field-contract";
import { readLocalFields } from "@/components/staff/smart/intelligence";
import { extractDeterministicClient } from "@/lib/smart-client-local";

/**
 * Zero-click auto-fill: which source wins, and what is deliberately never filled.
 *
 * The order under test, strongest first: the server's staged draft, a labelled
 * statement in the source box, a validated document extraction, an unlabelled
 * inference from the text. A field the merge layer put in review is never filled at
 * all — it is reported instead.
 */

function field(key: string): SmartField {
  const found = SMART_FIELDS.find((item) => item.key === key);
  if (!found) throw new Error(`${key} is not in the reviewed contract`);
  return found;
}

function readingsFor(source: string) {
  const local = extractDeterministicClient(source);
  return readLocalFields(local.row, local.evidence);
}

function read(partial: Partial<DocumentSuggestions> & { filename: string }): DocumentSuggestions {
  return {
    fields: {},
    imported_fields: [],
    review_fields: [],
    review_reasons: {},
    field_sources: {},
    document_warnings: [],
    classification: null,
    escalated: false,
    duration_ms: 0,
    applicants: 1,
    mrz: null,
    ...partial,
  };
}

describe("combining several document reads", () => {
  it("keeps a field a single document established", () => {
    const fill = combineDocumentFills([read({ filename: "id.png", fields: { full_name: "Ahmed Mohammed" } })]);
    expect(fill.values.full_name).toBe("Ahmed Mohammed");
    expect(fill.sources.full_name).toEqual(["id.png"]);
    expect(fill.review).toEqual({});
  });

  it("records both files when two documents agree", () => {
    const fill = combineDocumentFills([
      read({ filename: "front.png", fields: { full_name: "Ahmed Mohammed" } }),
      read({ filename: "back.png", fields: { full_name: "ahmed mohammed" } }),
    ]);
    expect(fill.values.full_name).toBe("Ahmed Mohammed");
    expect(fill.sources.full_name).toEqual(["front.png", "back.png"]);
    expect(fill.review.full_name).toBeUndefined();
  });

  it("fills nothing and reports a conflict when two documents disagree", () => {
    const fill = combineDocumentFills([
      read({ filename: "a.png", fields: { full_name: "Ahmed Mohammed" } }),
      read({ filename: "b.png", fields: { full_name: "Mohammed Ahmed" } }),
    ]);
    // Keeping the first answer would hide a real disagreement.
    expect(fill.values.full_name).toBeUndefined();
    expect(fill.review.full_name).toBe("conflict");
    expect(fill.sources.full_name).toEqual(["a.png", "b.png"]);
  });

  it("never fills a field the read itself put in review", () => {
    const fill = combineDocumentFills([read({
      filename: "blurry.png",
      fields: { city: "Detroit" },
      review_reasons: { date_of_birth: "low_confidence", zip: "invalid_value" },
    })]);
    expect(fill.values.city).toBe("Detroit");
    expect(fill.values.date_of_birth).toBeUndefined();
    expect(fill.review.date_of_birth).toBe("low_confidence");
    expect(fill.review.zip).toBe("invalid_value");
  });

  it("drops a value that a later read puts in review", () => {
    const fill = combineDocumentFills([
      read({ filename: "a.png", fields: { phone: "3135550100" } }),
      read({ filename: "b.png", review_reasons: { phone: "identity_conflict" } }),
    ]);
    expect(fill.values.phone).toBeUndefined();
    expect(fill.review.phone).toBe("identity_conflict");
  });

  it("carries every document-level warning through, once", () => {
    const fill = combineDocumentFills([
      read({ filename: "a.png", document_warnings: ["Documents disagree on the applicant identity."] }),
      read({ filename: "b.png", document_warnings: ["Documents disagree on the applicant identity."] }),
    ]);
    expect(fill.warnings).toEqual(["Documents disagree on the applicant identity."]);
  });

  it("holds nothing at all before any document is read", () => {
    const fill = combineDocumentFills([]);
    expect(fill.values).toEqual({});
    expect(fill.warnings).toEqual([]);
    expect(documentFilledKeys(fill)).toEqual([]);
  });
});

describe("which source wins for one field", () => {
  const fill = combineDocumentFills([read({
    filename: "license.png",
    fields: { full_name: "AHMED FROM LICENSE", phone: "3135559999", city: "Dearborn" },
  })]);

  it("lets the server's staged draft outrank every local source", () => {
    const resolved = resolveFieldValue({
      field: field("full_name"),
      serverDraft: { full_name: "Server Authoritative" },
      fill,
      readings: readingsFor("Full Name: Typed By Staff"),
    });
    expect(resolved.value).toBe("Server Authoritative");
    expect(resolved.origin).toBe("server");
  });

  it("lets a labelled statement in the source box outrank a document", () => {
    const resolved = resolveFieldValue({
      field: field("full_name"),
      serverDraft: null,
      fill,
      readings: readingsFor("Full Name: Typed By Staff"),
    });
    // A staff member's own entry is never replaced by a document.
    expect(resolved.value).toBe("Typed By Staff");
    expect(resolved.origin).toBe("text");
  });

  it("uses the document when the source box says nothing about the field", () => {
    const resolved = resolveFieldValue({
      field: field("city"),
      serverDraft: null,
      fill,
      readings: readingsFor("Full Name: Typed By Staff"),
    });
    expect(resolved.value).toBe("Dearborn");
    expect(resolved.origin).toBe("document");
  });

  it("lets a document outrank an unlabelled guess from the text", () => {
    // "AHMED SAMPLE NAME" is only a ranked guess, not a labelled statement.
    const resolved = resolveFieldValue({
      field: field("full_name"),
      serverDraft: null,
      fill,
      readings: readingsFor("AHMED SAMPLE NAME"),
    });
    expect(resolved.value).toBe("AHMED FROM LICENSE");
    expect(resolved.origin).toBe("document");
  });

  it("reports no value and no origin when nothing has one", () => {
    const resolved = resolveFieldValue({
      field: field("zip"),
      serverDraft: null,
      fill: combineDocumentFills([]),
      readings: readingsFor(""),
    });
    expect(resolved.value).toBeNull();
    expect(resolved.origin).toBeNull();
  });

  it("maps a contract field onto the row key the extractor uses", () => {
    // preferred_location is stored by the extractor as site_code.
    const sited = combineDocumentFills([read({ filename: "form.pdf", fields: { site_code: "DTW1" } })]);
    const resolved = resolveFieldValue({
      field: field("preferred_location"),
      serverDraft: null,
      fill: sited,
      readings: readingsFor(""),
    });
    expect(resolved.value).toBe("DTW1");
    expect(documentFilledKeys(sited)).toContain("preferred_location");
  });

  it("finds a review reason under either key the two layers use", () => {
    const sited = combineDocumentFills([read({ filename: "f.pdf", review_reasons: { site_code: "low_confidence" } })]);
    expect(reviewReasonFor(sited, "preferred_location")).toBe("low_confidence");
  });
});
