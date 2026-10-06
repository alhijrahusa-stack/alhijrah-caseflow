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
import {
  normalizeEnglishProficiency,
  normalizeImportLanguage,
  normalizeShiftDays,
  normalizeShiftTime,
  normalizeSmartDate,
  parseShiftRange,
} from "@/lib/smart-client-fields";
import { extractDeterministicClient } from "@/lib/smart-client-local";
import { REVIEW_FIELD_SOURCE_KEYS, mergeManualEvidence, sheetEvidence } from "@/lib/smart-client-import";
import { appendExtractionEvidence } from "@/lib/smart-client-mobile";
import { buildCareerGateImportTemplate } from "@/lib/smart-client-template";

describe("Smart Career Collect Client canonical import contract", () => {
  it("normalizes a valid row into the existing Client profile contract", () => {
    const draft = prepareImportDraft({
      "Full Name": "Test Client",
      "Phone": "+1 (313) 555-0199",
      "Email": "TEST@EXAMPLE.COM",
      "Preferred Language": "English",
      "English Proficiency": "Good",
      "Notes": "Imported for review",
    });
    expect(draft.profile.full_name).toBe("Test Client");
    expect(draft.profile.phone).toBe("3135550199");
    expect(draft.profile.email).toBe("test@example.com");
    expect(draft.profile.preferred_language).toBe("en");
    expect(draft.profile.english_proficiency).toBe("GOOD");
    expect(draft.status).toBe("new_intake");
    expect(draft.initial_note).toBe("Imported for review");
    expect(requiredMissingFromDraft(draft)).toEqual([]);
  });

  it("rejects malformed explicit language while preserving every current valid domain code", () => {
    expect(normalizeImportLanguage("English")).toBe("en");
    expect(normalizeImportLanguage("Arabic")).toBe("ar");
    expect(normalizeImportLanguage("Spanish")).toBe("es");
    expect(normalizeImportLanguage("em")).toBeNull();
    expect(() => prepareImportDraft({ full_name: "Test Client", phone: "3135550199", preferred_language: "em" })).toThrow(/preferred_language/);
  });

  it("normalizes English proficiency from English and Arabic source evidence", () => {
    expect(normalizeEnglishProficiency("speaks English fluently")).toBe("EXCELLENT");
    expect(normalizeEnglishProficiency("good")).toBe("GOOD");
    expect(normalizeEnglishProficiency("intermediate")).toBe("FAIR");
    expect(normalizeEnglishProficiency("limited English")).toBe("WEAK");
    expect(normalizeEnglishProficiency("لا يتحدث الإنجليزية")).toBe("NONE");
    expect(normalizeEnglishProficiency("unknown level")).toBeNull();
  });

  it("keeps preferred language separate from English proficiency, including bounded typos", () => {
    expect(normalizeEnglishProficiency("English is good")).toBe("GOOD");
    expect(normalizeEnglishProficiency("Englis is goog")).toBe("GOOD");

    const local = extractDeterministicClient([
      "Full Name: Test Client",
      "Phone: 313-555-0199",
      "Englis is goog",
    ].join("\n"));
    expect(local.row.preferred_language).toBeUndefined();
    expect(local.row.english_proficiency).toBe("Englis is goog");

    const draft = prepareImportDraft(local.row);
    expect(draft.profile.preferred_language).toBeNull();
    expect(draft.profile.english_proficiency).toBe("GOOD");
  });

  it("extracts work location from shift context without reusing the residential city", () => {
    const local = extractDeterministicClient([
      "Full Name: Test Client",
      "Phone: 313-555-0199",
      "6461 MEAD ST",
      "DEARBORN, MI 48126-2041",
      "Romulus night shift",
    ].join("\n"));
    const draft = prepareImportDraft(local.row);
    expect(draft.profile.city).toBe("DEARBORN");
    expect(draft.review_fields.preferred_location).toBe("Romulus");
    expect(draft.review_fields.location_option_1).toBeNull();
    expect(draft.review_fields.location_option_2).toBeNull();
    expect(draft.review_fields.shift_days).toBeNull();
    expect(draft.review_fields.shift_start_time).toBeNull();
    expect(draft.review_fields.shift_end_time).toBeNull();
  });

  it("uses US weekday/weekend semantics and validates DOB business range", () => {
    expect(normalizeShiftDays("Weekdays")).toEqual(["MON", "TUE", "WED", "THU", "FRI"]);
    expect(normalizeShiftDays("Weekends")).toEqual(["SAT", "SUN"]);
    expect(normalizeShiftDays("Every day")).toEqual(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]);
    expect(() => prepareImportDraft({ full_name: "Test Client", phone: "3135550199", date_of_birth: "1000-01-01" })).toThrow(/date_of_birth/i);
    expect(() => prepareImportDraft({ full_name: "Test Client", phone: "3135550199", date_of_birth: "02\/30\/2020" })).toThrow(/date_of_birth/i);
  });

  it("decomposes the exact production address fixture and preserves ZIP+4", () => {
    expect(decomposeUsAddress("28772 GOODSON ST, DETROIT, MI 48212-3768")).toEqual({
      street: "28772 GOODSON ST",
      city: "DETROIT",
      state: "MI",
      zip: "48212-3768",
    });
    const draft = prepareImportDraft({
      full_name: "Test Client",
      phone: "3135550199",
      address: "28772 GOODSON ST, DETROIT, MI 48212-3768",
    });
    expect(draft.profile.street).toBe("28772 GOODSON ST");
    expect(draft.profile.city).toBe("DETROIT");
    expect(draft.profile.state).toBe("MI");
    expect(draft.profile.zip).toBe("48212-3768");

    const explicit = prepareImportDraft({
      full_name: "Test Client",
      phone: "3135550199",
      address: "28772 GOODSON ST, DETROIT, MI 48212-3768",
      city: "Dearborn",
      state: "MI",
      zip: "48126",
    });
    expect(explicit.profile.city).toBe("Dearborn");
    expect(explicit.profile.state).toBe("MI");
    expect(explicit.profile.zip).toBe("48126");
  });

  it("preserves the exact valid email local-part through deterministic extraction and draft normalization", () => {
    const local = extractDeterministicClient("Full Name: Test Client\nPhone: 313-555-0199\nEmail: bbelalgv@gmail.com");
    expect(local.row.email).toBe("bbelalgv@gmail.com");
    const draft = prepareImportDraft({ ...local.row });
    expect(draft.profile.email).toBe("bbelalgv@gmail.com");
  });

  it("normalizes week-boundary shift days and overnight shift times", () => {
    expect(normalizeShiftDays("Thursday–Monday")).toEqual(["THU", "FRI", "SAT", "SUN", "MON"]);
    expect(normalizeShiftDays("Wed, Thu, Fri, Sat")).toEqual(["WED", "THU", "FRI", "SAT"]);
    expect(normalizeShiftTime("6pm")).toBe("18:00");
    expect(normalizeShiftTime("4:30am")).toBe("04:30");
    expect(parseShiftRange("6pm-4:30am")).toEqual({ start: "18:00", end: "04:30", overnight: true });
    expect(parseShiftRange("18:00–04:30")).toEqual({ start: "18:00", end: "04:30", overnight: true });
  });

  it("extracts approved review fields locally without inventing values", () => {
    const local = extractDeterministicClient([
      "Full Name: Test Client",
      "Phone: 313-555-0199",
      "Preferred Language: English",
      "English Proficiency: fluent",
      "Preferred Location: DTW1",
      "Shift Days: Thursday–Monday",
      "Shift Start: 6pm",
      "Shift End: 4:30am",
    ].join("\n"));
    expect(local.row.preferred_language).toBe("English");
    expect(local.row.english_proficiency).toBe("fluent");
    expect(local.row.site_code).toBe("DTW1");
    expect(local.row.shift_days).toBe("Thursday–Monday");
    expect(local.row.shift_start_time).toBe("6pm");
    expect(local.row.shift_end_time).toBe("4:30am");
  });

  it("supports the approved DOB syntaxes without reinterpreting a US date as day-first", () => {
    expect(normalizeSmartDate("1990-03-14")).toBe("1990-03-14");
    expect(normalizeSmartDate("03/14/1990")).toBe("1990-03-14");
    expect(normalizeSmartDate("14/03/1990")).toBeNull();
    expect(normalizeSmartDate("1000-01-01")).toBeNull();
    expect(normalizeSmartDate("2020-02-30")).toBeNull();
    expect(normalizeSmartDate("2020-13-01")).toBeNull();
    expect(normalizeSmartDate("placeholder")).toBeNull();

    const base = { full_name: "Test Client", phone: "3135550199" };
    expect(prepareImportDraft({ ...base, date_of_birth: "1990-03-14" }).profile.date_of_birth).toBe("1990-03-14");
    expect(prepareImportDraft({ ...base, date_of_birth: "03/14/1990" }).profile.date_of_birth).toBe("1990-03-14");
    expect(prepareImportDraft({ ...base }).profile.date_of_birth).toBeNull();
    expect(() => prepareImportDraft({ ...base, date_of_birth: "14/03/1990" })).toThrow(/date_of_birth/i);
  });

  it("validates shift time syntax and bounds without inventing values from shift words", () => {
    expect(normalizeShiftTime("12am")).toBe("00:00");
    expect(normalizeShiftTime("12pm")).toBe("12:00");
    expect(normalizeShiftTime("6:00 PM")).toBe("18:00");
    expect(normalizeShiftTime("18:00")).toBe("18:00");
    expect(normalizeShiftTime("13pm")).toBeNull();
    expect(normalizeShiftTime("0pm")).toBeNull();
    expect(normalizeShiftTime("6:99pm")).toBeNull();
    expect(normalizeShiftTime("25:00")).toBeNull();
    expect(normalizeShiftTime("18:60")).toBeNull();
    expect(normalizeShiftTime("night shift")).toBeNull();
    expect(parseShiftRange("12am-8am")).toEqual({ start: "00:00", end: "08:00", overnight: false });
    expect(parseShiftRange("12pm-8pm")).toEqual({ start: "12:00", end: "20:00", overnight: false });
    expect(parseShiftRange("6:00 PM\u20134:30 AM")).toEqual({ start: "18:00", end: "04:30", overnight: true });
    expect(normalizeShiftDays("night shift")).toBeNull();
  });

  it("expands abbreviated and named shift-day ranges to canonical codes", () => {
    expect(normalizeShiftDays("Thu-Mon")).toEqual(["THU", "FRI", "SAT", "SUN", "MON"]);
    expect(normalizeShiftDays("Thursday\u2013Monday")).toEqual(["THU", "FRI", "SAT", "SUN", "MON"]);
    expect(normalizeShiftDays("Weekday")).toEqual(["MON", "TUE", "WED", "THU", "FRI"]);
    expect(normalizeShiftDays("Weekend")).toEqual(["SAT", "SUN"]);
    expect(normalizeShiftDays("Daily")).toEqual(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]);
  });

  it("carries every one of the 16 approved Smart fields through extraction, staging and evidence", () => {
    expect(Object.keys(REVIEW_FIELD_SOURCE_KEYS)).toEqual([
      "full_name", "phone", "email", "date_of_birth", "preferred_language", "english_proficiency",
      "street", "city", "state", "zip",
      "preferred_location", "location_option_1", "location_option_2",
      "shift_days", "shift_start_time", "shift_end_time",
    ]);

    const row = {
      full_name: "Test Client",
      phone: "313-555-0199",
      email: "bbelalgv@gmail.com",
      date_of_birth: "03/14/1990",
      preferred_language: "Arabic",
      english_proficiency: "Englis is goog",
      street: "28772 GOODSON ST",
      city: "DETROIT",
      state: "MI",
      zip: "48212-3768",
      site_code: "Romulus",
      backup_site_code: "Dearborn",
      shift_days: "Thu-Mon",
      shift_start_time: "6pm",
      shift_end_time: "4:30am",
    };
    const draft = prepareImportDraft(row);
    expect(draft.profile.date_of_birth).toBe("1990-03-14");
    expect(draft.profile.preferred_language).toBe("ar");
    expect(draft.profile.english_proficiency).toBe("GOOD");
    expect(draft.profile.email).toBe("bbelalgv@gmail.com");
    expect(draft.review_fields.preferred_location).toBe("Romulus");
    expect(draft.review_fields.location_option_2).toBe("Dearborn");
    expect(draft.review_fields.shift_days).toEqual(["THU", "FRI", "SAT", "SUN", "MON"]);
    expect(draft.review_fields.shift_start_time).toBe("18:00");
    expect(draft.review_fields.shift_end_time).toBe("04:30");

    const evidence = sheetEvidence(row, draft, "csv", 2);
    const evidenceFields = new Set<string>(evidence.map((entry) => entry.field_key));
    for (const field of Object.keys(REVIEW_FIELD_SOURCE_KEYS)) {
      if (field === "location_option_1") continue;
      expect(evidenceFields.has(field)).toBe(true);
    }
    for (const entry of evidence) {
      expect(entry.authority).toBe("SOURCE");
      expect(entry.source_row).toBe(2);
    }
    const dob = evidence.find((entry) => entry.field_key === "date_of_birth");
    expect(dob?.value).toBe("03/14/1990");
    expect(dob?.normalized_value).toBe("1990-03-14");
  });

  it("records a manual review edit as the current authority without rewriting source evidence", () => {
    const sourceRow = { full_name: "Test Client", phone: "313-555-0199", english_proficiency: "Englis is goog" };
    const previous = prepareImportDraft(sourceRow);
    const source = sheetEvidence(sourceRow, previous, "csv", 1);

    const next = { ...previous, profile: { ...previous.profile, english_proficiency: "FAIR" as const } };
    const merged = mergeManualEvidence(source, previous, next, "reviewer-1");

    expect(merged.slice(0, source.length)).toEqual(source);
    const manual = merged.slice(source.length);
    expect(manual).toHaveLength(1);
    expect(manual[0]).toMatchObject({
      field_key: "english_proficiency",
      value: "FAIR",
      previous_value: "GOOD",
      authority: "MANUAL",
      source_type: "manual_review",
      verification_state: "VERIFIED",
      reviewer_id: "reviewer-1",
    });
    expect(typeof (manual[0] as { reviewed_at: string }).reviewed_at).toBe("string");

    const original = source.find((entry) => entry.field_key === "english_proficiency");
    expect(original?.value).toBe("Englis is goog");
    expect(original?.authority).toBe("SOURCE");

    const unchanged = mergeManualEvidence(merged, next, next, "reviewer-1");
    expect(unchanged).toEqual(merged);
  });

  it("keeps a later automatic extraction from displacing a manually reviewed field", () => {
    const stored = [
      { field_key: "english_proficiency", value: "Englis is goog", source_type: "csv", authority: "SOURCE", verification_state: "MATCHED" },
      { field_key: "city", value: "DETROIT", source_type: "csv", authority: "SOURCE", verification_state: "MATCHED" },
      { field_key: "english_proficiency", value: "FAIR", source_type: "manual_review", authority: "MANUAL", verification_state: "VERIFIED", reviewer_id: "reviewer-1", reviewed_at: "2026-10-06T00:00:00.000Z" },
    ];
    const reExtracted = [
      { field_key: "english_proficiency", value: "GOOD", source_type: "local_text", authority: "SOURCE", verification_state: "MATCHED" },
      { field_key: "city", value: "DETROIT", source_type: "csv", authority: "SOURCE", verification_state: "MATCHED" },
      { field_key: "zip", value: "48212-3768", source_type: "local_text", authority: "SOURCE", verification_state: "MATCHED" },
    ];
    const next = appendExtractionEvidence(stored, reExtracted);

    // Original history is immutable and still leads the array.
    expect(next.slice(0, stored.length)).toEqual(stored);
    // Only genuinely new, non-manual evidence is appended.
    expect(next.slice(stored.length)).toEqual([reExtracted[2]]);

    // The review surface reads the last entry per field as the current authority.
    const current = (field: string) => [...next].reverse().find((entry) => entry.field_key === field);
    expect(current("english_proficiency")).toMatchObject({ value: "FAIR", authority: "MANUAL", reviewer_id: "reviewer-1" });
    expect(current("zip")).toMatchObject({ value: "48212-3768", authority: "SOURCE" });

    expect(appendExtractionEvidence(null, reExtracted)).toEqual(reExtracted);
  });

  it("rejects missing canonical minimum Client identity data", () => {
    expect(() => prepareImportDraft({ full_name: "Only Name", phone: null })).toThrow();
  });

  it("defines the exact import lifecycle and a stable SHA-256 schema hash", () => {
    expect(IMPORT_STATUSES).toEqual(["PENDING", "UNDER_REVIEW", "MISSING_DOCUMENT", "APPROVED_FILE"]);
    expect(IMPORT_SCHEMA_HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(CANONICAL_IMPORT_HEADERS[0]).toBe("full_name");
    expect(CANONICAL_IMPORT_HEADERS[1]).toBe("phone");
    expect(CANONICAL_IMPORT_HEADERS).toContain("english_proficiency");
    expect(CANONICAL_IMPORT_HEADERS).toContain("shift_days");
    expect(CANONICAL_IMPORT_HEADERS).toContain("shift_start_time");
    expect(CANONICAL_IMPORT_HEADERS).toContain("shift_end_time");
    expect(CANONICAL_IMPORT_HEADERS).toContain("backup_site_code");
  });

  it("normalizes evidence without silently resolving conflicts", () => {
    expect(normalizeEvidenceValue("phone", "+1 (313) 555-0199")).toBe("3135550199");
    expect(normalizeEvidenceValue("email", " bbelalgv@gmail.com ")).toBe("bbelalgv@gmail.com");
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