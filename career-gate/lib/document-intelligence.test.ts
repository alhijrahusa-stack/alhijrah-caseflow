import { describe, expect, it } from "vitest";
import {
  DOCUMENT_CLASSES,
  ESCALATION_CONFIDENCE_FLOOR,
  classifyAndExtractDocument,
  mergeDocumentStages,
  readDocumentClassification,
  readStrength,
  type DocumentExtraction,
} from "@/lib/universal-intake";

/**
 * The staged document-intelligence pipeline.
 *
 * Every stage below is exercised without a provider: the classification read, the
 * decision to pay for a second read, and the per-field merge of the two. The provider
 * call itself is covered by the NOT_CONFIGURED case, which is the behaviour this
 * environment can actually prove.
 */

function extraction(row: Record<string, string | null>, confidence: Record<string, number> = {}): DocumentExtraction {
  return { row, confidence };
}

describe("reading what the document itself is", () => {
  it("accepts each recognized class exactly", () => {
    for (const expected of DOCUMENT_CLASSES) {
      expect(readDocumentClassification({ document_type: expected })?.document_type).toBe(expected);
    }
  });

  it("normalizes spacing and case before matching a class", () => {
    expect(readDocumentClassification({ document_type: "driver license" })?.document_type).toBe("DRIVER_LICENSE");
    expect(readDocumentClassification({ document_type: "us-passport" })?.document_type).toBe("US_PASSPORT");
  });

  it("falls back to OTHER rather than guessing between classes", () => {
    expect(readDocumentClassification({ document_type: "utility bill" })?.document_type).toBe("OTHER");
  });

  it("keeps a printed expiry only when it is a real calendar date", () => {
    const of = (expiration_date: string) => readDocumentClassification({ document_type: "STATE_ID", expiration_date });
    expect(of("2030-04-15")?.expiration_date).toBe("2030-04-15");
    expect(of("04/15/2030")?.expiration_date).toBe("2030-04-15");
    // An impossible date is not a date, and neither is a word.
    expect(of("2030-02-31")?.expiration_date).toBeNull();
    expect(of("soon")?.expiration_date).toBeNull();
    // The class it did read is still reported.
    expect(of("soon")?.document_type).toBe("STATE_ID");
  });

  it("accepts only the stated side and legibility values", () => {
    expect(readDocumentClassification({ side: "front" })?.side).toBe("FRONT");
    expect(readDocumentClassification({ legibility: "poor" })?.legibility).toBe("POOR");
    expect(readDocumentClassification({ document_type: "STATE_ID", side: "sideways" })?.side).toBeNull();
    expect(readDocumentClassification({ document_type: "STATE_ID", legibility: "ok" })?.legibility).toBeNull();
  });

  it("keeps a confidence only inside its own range", () => {
    expect(readDocumentClassification({ confidence: 0.9 })?.confidence).toBe(0.9);
    expect(readDocumentClassification({ document_type: "STATE_ID", confidence: 4 })?.confidence).toBeNull();
    expect(readDocumentClassification({ document_type: "STATE_ID", confidence: -1 })?.confidence).toBeNull();
  });

  it("reports nothing at all when the document object says nothing", () => {
    expect(readDocumentClassification(null)).toBeNull();
    expect(readDocumentClassification({})).toBeNull();
    expect(readDocumentClassification("a string")).toBeNull();
  });
});

describe("deciding whether a second read is worth paying for", () => {
  it("calls a confident read strong", () => {
    const strong = [extraction(
      { full_name: "Ahmed Mohammed", date_of_birth: "1995-05-14", street: "1 Main St", city: "Detroit", state: "MI", zip: "48228", phone: "3135550100" },
      { full_name: 0.97, date_of_birth: 0.95, street: 0.93, city: 0.96, state: 0.99, zip: 0.98, phone: 0.94 },
    )];
    expect(readStrength(strong)).toEqual({ weak: false, read: 7 });
  });

  it("calls a read weak when a field that matters is below the floor", () => {
    const weak = [extraction(
      { full_name: "Ahmed Mohammed", date_of_birth: "1995-05-14" },
      { full_name: 0.97, date_of_birth: ESCALATION_CONFIDENCE_FLOOR - 0.01 },
    )];
    expect(readStrength(weak).weak).toBe(true);
  });

  it("calls a read weak when a value arrives with no confidence at all", () => {
    expect(readStrength([extraction({ full_name: "Ahmed Mohammed" }, {})]).weak).toBe(true);
  });

  it("calls an empty read weak, so a blank page gets a second look", () => {
    expect(readStrength([extraction({})]).weak).toBe(true);
    expect(readStrength([]).weak).toBe(true);
  });

  it("does not call a multi-applicant read weak on confidence grounds", () => {
    // Two people in one document is a quarantine case, not an escalation case.
    expect(readStrength([extraction({ full_name: "A" }), extraction({ full_name: "B" })])).toEqual({ weak: false, read: 0 });
  });
});

describe("merging a stronger read into the first one", () => {
  it("takes the higher-confidence value per field", () => {
    const [merged] = mergeDocumentStages(
      [extraction({ full_name: "AHMED M0HAMMED", zip: "48228" }, { full_name: 0.6, zip: 0.99 })],
      [extraction({ full_name: "Ahmed Mohammed", zip: "48Z28" }, { full_name: 0.96, zip: 0.4 })],
    );
    // The name improves; the ZIP the first read was sure of is kept.
    expect(merged.row.full_name).toBe("Ahmed Mohammed");
    expect(merged.row.zip).toBe("48228");
  });

  it("fills a field only the second read produced", () => {
    const [merged] = mergeDocumentStages(
      [extraction({ full_name: "Ahmed Mohammed" }, { full_name: 0.9 })],
      [extraction({ full_name: "Ahmed Mohammed", city: "Detroit" }, { full_name: 0.9, city: 0.95 })],
    );
    expect(merged.row.city).toBe("Detroit");
  });

  it("keeps the first read on a tie rather than churning", () => {
    const [merged] = mergeDocumentStages(
      [extraction({ city: "Detroit" }, { city: 0.9 })],
      [extraction({ city: "Dearborn" }, { city: 0.9 })],
    );
    expect(merged.row.city).toBe("Detroit");
  });

  it("never discards a value because the second read returned none", () => {
    const [merged] = mergeDocumentStages(
      [extraction({ city: "Detroit" }, { city: 0.9 })],
      [extraction({ city: null }, {})],
    );
    expect(merged.row.city).toBe("Detroit");
  });

  it("returns both rows when the two reads disagree on who the person is", () => {
    // Splicing one person's address onto another person's name is the one outcome
    // that must never happen, so the document is handed up for quarantine instead.
    const merged = mergeDocumentStages(
      [extraction({ full_name: "Ahmed Mohammed", city: "Detroit" }, { full_name: 0.9 })],
      [extraction({ full_name: "Sara Hassan", city: "Dearborn" }, { full_name: 0.99 })],
    );
    expect(merged).toHaveLength(2);
    expect(merged.map((item) => item.row.full_name)).toEqual(["Ahmed Mohammed", "Sara Hassan"]);
  });

  it("treats an OCR correction of the same name as the same person", () => {
    // This is the main thing a second read fixes; quarantining it would defeat the
    // escalation entirely.
    const [merged] = mergeDocumentStages(
      [extraction({ full_name: "AHMED M0HAMMED AL BAADAN1" }, { full_name: 0.55 })],
      [extraction({ full_name: "Ahmed Mohammed Al Baadani" }, { full_name: 0.97 })],
    );
    expect(merged.row.full_name).toBe("Ahmed Mohammed Al Baadani");
  });

  it("still quarantines a genuinely different name, including a reordered one", () => {
    expect(mergeDocumentStages(
      [extraction({ full_name: "Ahmed Mohammed" }, { full_name: 0.9 })],
      [extraction({ full_name: "Mohammed Ahmed" }, { full_name: 0.99 })],
    )).toHaveLength(2);
  });

  it("prefers the populated side when one read found no applicant", () => {
    expect(mergeDocumentStages([], [extraction({ full_name: "Ahmed Mohammed" })])).toHaveLength(1);
    expect(mergeDocumentStages([extraction({ full_name: "Ahmed Mohammed" })], [])[0].row.full_name).toBe("Ahmed Mohammed");
  });
});

describe("when the provider is not configured", () => {
  it("says so instead of reporting an empty document", async () => {
    // No key in this environment: the pipeline must refuse, not invent a blank read.
    await expect(classifyAndExtractDocument(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "application/pdf"))
      .rejects.toMatchObject({ code: "ocr_not_configured", status: 503 });
  });
});
