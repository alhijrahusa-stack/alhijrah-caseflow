import { describe, expect, it, vi } from "vitest";
import {
  SMART_DOCUMENT_POLICY,
  admitDocuments,
  documentStatusLabel,
  documentTotals,
  releaseDocuments,
  removeDocument,
  advanceDocuments,
} from "@/components/staff/smart/document-queue";
import {
  SMART_FIELDS,
  SMART_FIELD_GROUPS,
  latestSmartEvidence,
  smartAuthority,
  smartFieldStatus,
  smartProvenance,
  smartRequiredReadiness,
  type SmartEvidence,
} from "@/components/staff/smart/field-contract";
import { localProvenance, readLocalFields, sourceMatchState } from "@/components/staff/smart/intelligence";
import { validateField } from "@/components/staff/smart/ValidationMatrix";
import { extractDeterministicClient } from "@/lib/smart-client-local";

function stubFile(name: string, type: string, size: number) {
  return { name, type, size } as unknown as File;
}

function urlStub() {
  const created: string[] = [];
  const revoked: string[] = [];
  let counter = 0;
  return {
    created,
    revoked,
    factory: {
      create: () => { counter += 1; const url = `blob:stub/${counter}`; created.push(url); return url; },
      revoke: (url: string) => { revoked.push(url); },
    },
  };
}

describe("Smart source capture document queue", () => {
  it("validates type, size and count locally before anything is uploaded", () => {
    const urls = urlStub();
    const outcome = admitDocuments([], [
      stubFile("id.png", "image/png", 2048),
      stubFile("notes.txt", "text/plain", 100),
      stubFile("huge.pdf", "application/pdf", SMART_DOCUMENT_POLICY.maxFileBytes + 1),
      stubFile("empty.pdf", "application/pdf", 0),
    ], urls.factory);

    expect(outcome.documents).toHaveLength(1);
    expect(outcome.documents[0]).toMatchObject({
      name: "id.png",
      localState: "VALIDATED",
      uploadState: "READY_TO_UPLOAD",
      processingState: "WAITING",
      previewKind: "image",
    });
    expect(outcome.rejected.map((entry) => entry.name)).toEqual(["notes.txt", "huge.pdf", "empty.pdf"]);
    for (const entry of outcome.rejected) expect(entry.reason).not.toMatch(/something went wrong/i);
    expect(outcome.rejected[0].reason).toMatch(/Unsupported type/);
    expect(outcome.rejected[1].reason).toMatch(/per-file limit/);
    expect(outcome.rejected[2].reason).toBe("File is empty.");
  });

  it("creates a local preview only for previewable images and never for a rejected file", () => {
    const urls = urlStub();
    const outcome = admitDocuments([], [
      stubFile("scan.pdf", "application/pdf", 4096),
      stubFile("photo.jpg", "image/jpeg", 4096),
      stubFile("bad.exe", "application/x-msdownload", 4096),
    ], urls.factory);

    expect(urls.created).toHaveLength(1);
    const [pdf, jpg] = outcome.documents;
    expect(pdf.previewKind).toBe("unsupported");
    expect(pdf.previewUrl).toBeNull();
    expect(jpg.previewKind).toBe("image");
    expect(jpg.previewUrl).toBe(urls.created[0]);
  });

  it("revokes the object URL when a file is removed and when the queue is released", () => {
    const urls = urlStub();
    const first = admitDocuments([], [stubFile("a.png", "image/png", 1024), stubFile("b.png", "image/png", 1024)], urls.factory);
    expect(urls.created).toHaveLength(2);

    const afterRemove = removeDocument(first.documents, first.documents[0].id, urls.factory);
    expect(afterRemove).toHaveLength(1);
    expect(urls.revoked).toEqual([urls.created[0]]);

    releaseDocuments(afterRemove, urls.factory);
    expect(urls.revoked).toEqual([urls.created[0], urls.created[1]]);
  });

  it("enforces the total upload budget and the file count without changing the policy", () => {
    const urls = urlStub();
    const big = Math.floor(SMART_DOCUMENT_POLICY.maxTotalBytes / 3);
    const outcome = admitDocuments([], [
      stubFile("1.pdf", "application/pdf", big),
      stubFile("2.pdf", "application/pdf", big),
      stubFile("3.pdf", "application/pdf", big),
      stubFile("4.pdf", "application/pdf", big),
    ], urls.factory);
    expect(outcome.documents).toHaveLength(3);
    expect(outcome.rejected[0].reason).toMatch(/Total upload would exceed/);

    const many = Array.from({ length: SMART_DOCUMENT_POLICY.maxFiles + 2 }, (_, i) => stubFile(`f${i}.pdf`, "application/pdf", 1024));
    const counted = admitDocuments([], many, urls.factory);
    expect(counted.documents).toHaveLength(SMART_DOCUMENT_POLICY.maxFiles);
    expect(counted.rejected).toHaveLength(2);
    expect(SMART_DOCUMENT_POLICY.maxFiles).toBe(10);
    expect(SMART_DOCUMENT_POLICY.maxTotalBytes).toBe(25 * 1024 * 1024);
    expect(SMART_DOCUMENT_POLICY.maxFileBytes).toBe(10 * 1024 * 1024);
  });

  it("reports the real file status through the capture lifecycle", () => {
    const urls = urlStub();
    const { documents } = admitDocuments([], [stubFile("a.png", "image/png", 1024)], urls.factory);
    expect(documentStatusLabel(documents[0])).toBe("READY");

    const uploading = advanceDocuments(documents, { uploadState: "UPLOADING" });
    expect(documentStatusLabel(uploading[0])).toBe("UPLOADING");

    const stored = advanceDocuments(uploading, { uploadState: "STORED", processingState: "WAITING" });
    expect(documentStatusLabel(stored[0])).toBe("STORED");

    expect(documentStatusLabel(advanceDocuments(stored, { processingState: "PROCESSING" })[0])).toBe("PROCESSING");
    expect(documentStatusLabel(advanceDocuments(stored, { processingState: "REVIEW_REQUIRED" })[0])).toBe("REVIEW REQUIRED");
    expect(documentStatusLabel(advanceDocuments(stored, { processingState: "COMPLETE" })[0])).toBe("COMPLETE");
    expect(documentStatusLabel(advanceDocuments(stored, { uploadState: "FAILED" })[0])).toBe("FAILED");

    expect(documentTotals(stored)).toMatchObject({ count: 1, bytes: 1024, remaining: 9 });
  });

  it("survives an environment that refuses to create object URLs", () => {
    const failing = { create: () => { throw new Error("blocked"); }, revoke: vi.fn() };
    const { documents } = admitDocuments([], [stubFile("a.png", "image/png", 1024)], failing);
    expect(documents).toHaveLength(1);
    expect(documents[0].previewUrl).toBeNull();
    expect(documents[0].localState).toBe("VALIDATED");
  });
});

describe("Smart reviewed field contract", () => {
  it("covers exactly the sixteen approved fields in four groups", () => {
    expect(SMART_FIELD_GROUPS.map((group) => group.title)).toEqual(["IDENTITY", "ADDRESS", "LANGUAGE & ENGLISH", "JOB PREFERENCES"]);
    expect(SMART_FIELDS.map((field) => field.key)).toEqual([
      "full_name", "phone", "email", "date_of_birth",
      "street", "city", "state", "zip",
      "preferred_language", "english_proficiency",
      "preferred_location", "location_option_1", "location_option_2",
      "shift_days", "shift_start_time", "shift_end_time",
    ]);
    expect(SMART_FIELDS.filter((field) => field.required).map((field) => field.key)).toEqual(["full_name", "phone"]);
  });

  it("keeps authority, provenance and workflow state separate", () => {
    expect(smartProvenance({ source_type: "staged" })).toBeNull();
    expect(smartProvenance({ source_type: "pending" })).toBeNull();
    expect(smartProvenance(undefined)).toBeNull();
    expect(smartProvenance({ source_type: "manual_review" })).toBe("manual");
    expect(smartProvenance({ source_type: "local_text" })).toBe("local_text");
    expect(smartProvenance({ source_type: "passport.png" })).toBe("document");
    expect(smartProvenance({ source_type: "csv" })).toBe("csv");

    expect(smartAuthority({ authority: "MANUAL" })).toBe("MANUAL");
    expect(smartAuthority({ source_type: "manual_review" })).toBe("MANUAL");
    expect(smartAuthority({ authority: "SOURCE" })).toBe("SOURCE");
    expect(smartAuthority(undefined)).toBe("SOURCE");
  });

  it("treats the newest evidence entry as the current authority", () => {
    const evidence: SmartEvidence[] = [
      { field_key: "english_proficiency", value: "Englis is goog", source_type: "csv", authority: "SOURCE", verification_state: "MATCHED" },
      { field_key: "english_proficiency", value: "FAIR", source_type: "manual_review", authority: "MANUAL", verification_state: "VERIFIED", reviewer_id: "r1" },
    ];
    expect(latestSmartEvidence(evidence, "english_proficiency")?.value).toBe("FAIR");

    const status = smartFieldStatus({ key: "english_proficiency", value: "FAIR", evidence });
    expect(status).toMatchObject({ state: "MANUAL", authority: "MANUAL", provenance: "manual" });
    // The original source entry is still present as immutable history.
    expect(evidence[0]).toMatchObject({ value: "Englis is goog", authority: "SOURCE" });
  });

  it("derives every reviewable state from authoritative data only", () => {
    const sourceEvidence: SmartEvidence[] = [{ field_key: "city", value: "DETROIT", source_type: "csv", authority: "SOURCE", verification_state: "MATCHED" }];
    expect(smartFieldStatus({ key: "city", value: "DETROIT", evidence: sourceEvidence }).state).toBe("VERIFIED");
    expect(smartFieldStatus({ key: "city", value: "", evidence: sourceEvidence }).state).toBe("MISSING");
    expect(smartFieldStatus({ key: "city", value: "DETROIT", evidence: sourceEvidence, missingFields: ["city"] }).state).toBe("MISSING");
    expect(smartFieldStatus({ key: "city", value: "DETROIT", evidence: sourceEvidence, conflicts: [{ field_key: "city" }] }).state).toBe("CONFLICT");
    expect(smartFieldStatus({ key: "city", value: "DETROIT", evidence: [{ field_key: "city", source_type: "csv", verification_state: "REVIEW" }] }).state).toBe("DETECTED");
    expect(smartFieldStatus({ key: "city", value: "DETROIT", evidence: [] }).state).toBe("REVIEW");
  });

  it("reports required readiness as an exact count, never a percentage", () => {
    const values: Record<string, unknown> = { full_name: "Test Client", phone: "" };
    const readiness = smartRequiredReadiness((field) => values[field.key]);
    expect(readiness).toEqual({ total: 2, complete: 1, missing: ["Phone"] });
  });
});

describe("Smart capture-surface intelligence", () => {
  it("reads the sixteen fields from local extraction without inferring preferred language", () => {
    const local = extractDeterministicClient([
      "Full Name: Test Client",
      "Phone: 313-555-0199",
      "Englis is goog",
      "6461 MEAD ST",
      "DEARBORN, MI 48126-2041",
      "Romulus night shift",
    ].join("\n"));
    const readings = readLocalFields(local.row, local.evidence);
    const byKey = Object.fromEntries(readings.map((reading) => [reading.field.key, reading]));

    expect(byKey.english_proficiency.normalized).toBe("GOOD");
    expect(byKey.preferred_language.raw).toBe("");
    expect(byKey.preferred_language.normalized).toBeNull();
    expect(byKey.city.normalized).toBe("DEARBORN");
    expect(byKey.preferred_location.normalized).toBe("Romulus");
    expect(byKey.location_option_1.normalized).toBeNull();
    expect(byKey.shift_days.normalized).toBeNull();
    expect(byKey.shift_start_time.normalized).toBeNull();
    expect(readings).toHaveLength(16);
  });

  it("normalizes captured job preferences and marks canonicalized values as such", () => {
    const local = extractDeterministicClient([
      "Full Name: Test Client",
      "Phone: 313-555-0199",
      "DOB: 03/14/1990",
      "Preferred Language: Arabic",
      "Shift Days: Thu-Mon",
      "Shift Start: 6pm",
      "Shift End: 4:30am",
    ].join("\n"));
    const readings = readLocalFields(local.row, local.evidence);
    const byKey = Object.fromEntries(readings.map((reading) => [reading.field.key, reading]));

    expect(byKey.date_of_birth.normalized).toBe("1990-03-14");
    expect(byKey.preferred_language.normalized).toBe("ar");
    expect(byKey.shift_days.normalized).toEqual(["THU", "FRI", "SAT", "SUN", "MON"]);
    expect(byKey.shift_start_time.normalized).toBe("18:00");
    expect(byKey.shift_end_time.normalized).toBe("04:30");
    expect(localProvenance(byKey.shift_start_time)).toBe("normalized");
    expect(localProvenance(byKey.full_name)).toBe("local_text");
    expect(localProvenance(byKey.location_option_2)).toBeNull();
  });

  it("flags an unparseable source value instead of silently dropping it", () => {
    const local = extractDeterministicClient("Full Name: Test Client\nPhone: 313-555-0199\nShift Start: 99pm");
    const readings = readLocalFields(local.row, local.evidence);
    const start = readings.find((reading) => reading.field.key === "shift_start_time")!;
    expect(start.raw).toBe("99pm");
    expect(start.normalized).toBeNull();
    expect(start.invalid).toBe(true);
  });

  it("states source coverage as a factual band only", () => {
    expect(sourceMatchState({ hasText: false, documentCount: 0, detectedFields: 0 })).toBe("MANUAL SOURCE");
    expect(sourceMatchState({ hasText: false, documentCount: 2, detectedFields: 0 })).toBe("MANUAL SOURCE");
    expect(sourceMatchState({ hasText: true, documentCount: 0, detectedFields: 2 })).toBe("PARTIAL SOURCE");
    expect(sourceMatchState({ hasText: true, documentCount: 1, detectedFields: 9 })).toBe("FULL SOURCE CAPTURED");
  });
});

describe("Validation Matrix field commit", () => {
  const field = (key: string) => SMART_FIELDS.find((item) => item.key === key)!;

  it("accepts a canonical value for each normalized field", () => {
    expect(validateField(field("date_of_birth"), "03/14/1990")).toEqual({ value: "1990-03-14", error: null });
    expect(validateField(field("preferred_language"), "ar")).toEqual({ value: "ar", error: null });
    expect(validateField(field("english_proficiency"), "fair")).toEqual({ value: "FAIR", error: null });
    expect(validateField(field("shift_days"), "Thu-Mon")).toEqual({ value: ["THU", "FRI", "SAT", "SUN", "MON"], error: null });
    expect(validateField(field("shift_start_time"), "6pm")).toEqual({ value: "18:00", error: null });
    expect(validateField(field("shift_end_time"), "04:30")).toEqual({ value: "04:30", error: null });
  });

  it("refuses an invalid value for that field with a specific reason", () => {
    for (const [key, raw, pattern] of [
      ["date_of_birth", "1000-01-01", /real calendar date/],
      ["date_of_birth", "14/03/1990", /real calendar date/],
      ["preferred_language", "em", /supported language code/],
      ["english_proficiency", "unknown level", /EXCELLENT, GOOD, FAIR, WEAK or NONE/],
      ["shift_days", "someday", /canonical day codes/],
      ["shift_start_time", "99pm", /valid 12-hour or 24-hour time/],
    ] as const) {
      const outcome = validateField(field(key), raw);
      expect(outcome.value, `${key}=${raw}`).toBeNull();
      expect(outcome.error, `${key}=${raw}`).toMatch(pattern);
    }
  });

  it("clears a field to null and passes free text through to server validation", () => {
    expect(validateField(field("shift_days"), "   ")).toEqual({ value: null, error: null });
    expect(validateField(field("preferred_language"), "")).toEqual({ value: null, error: null });
    expect(validateField(field("full_name"), "  Test Client  ")).toEqual({ value: "Test Client", error: null });
    expect(validateField(field("preferred_location"), "Romulus")).toEqual({ value: "Romulus", error: null });
  });
});
