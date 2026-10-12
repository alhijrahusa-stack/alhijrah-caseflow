import { CLIENT_EDITABLE_FIELDS, type ClientEditableField } from "@/lib/client-intake-fields";
import { normalizeEnglishProficiency, normalizeImportLanguage, normalizeShiftTime, normalizeSmartDate } from "@/lib/smart-client-fields";

/**
 * Public Client Intake Link only. A model's text is untrusted evidence,
 * not an authoritative client correction.
 * The confidence cutoff is a conservative screening policy, not a calibrated accuracy claim.
 */
export const DOCUMENT_AUTOFILL_CONFIDENCE_FLOOR = 0.85;

export type IntakeDocumentRow = {
  row: Record<string, string | null | undefined>;
  confidence?: Record<string, number | null | undefined>;
};
export type IntakeDocumentResult = {
  filename: string;
  rows: IntakeDocumentRow[];
};
export type ReviewReason = "conflict" | "identity_conflict" | "low_confidence" | "invalid_value" | "multiple_applicants";
export type IntakeDocumentSuggestions = {
  fields: Partial<Record<ClientEditableField, string>>;
  imported_fields: ClientEditableField[];
  review_fields: ClientEditableField[];
  review_reasons: Partial<Record<ClientEditableField, ReviewReason>>;
  field_sources: Partial<Record<ClientEditableField, string[]>>;
  document_warnings: string[];
};

function normalize(field: ClientEditableField, value: string): string | null {
  const raw = value.normalize("NFKC").replace(/[\r\n]+/g, " ").trim();
  if (!raw || raw.length > 200) return null;
  switch (field) {
    case "email": return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw) ? raw.toLowerCase() : null;
    case "phone": {
      const digits = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
      return digits.length === 10 ? digits : null;
    }
    case "date_of_birth": return normalizeSmartDate(raw);
    case "zip": return /^\d{5}(?:-\d{4})?$/.test(raw) ? raw : null;
    case "state": return /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : null;
    case "preferred_language": return normalizeImportLanguage(raw);
    case "english_proficiency": return normalizeEnglishProficiency(raw);
    case "shift_start_time":
    case "shift_end_time": return normalizeShiftTime(raw);
    case "full_name": return /\p{L}/u.test(raw) && !/[\d@]/.test(raw) ? raw : null;
    default: return raw;
  }
}

/** No values are invented or resolved by priority when documents disagree. */
export function mergeIntakeDocumentSuggestions(documents: readonly IntakeDocumentResult[]): IntakeDocumentSuggestions {
  const fields: IntakeDocumentSuggestions["fields"] = {};
  const reviewReasons: IntakeDocumentSuggestions["review_reasons"] = {};
  const fieldSources: IntakeDocumentSuggestions["field_sources"] = {};
  const warnings: string[] = [];
  const candidates = new Map<ClientEditableField, { value: string; confidence: number | null; filename: string }[]>();
  const allSeen = new Set<ClientEditableField>();

  for (const document of documents) {
    if (document.rows.length > 1) {
      warnings.push(`Multiple applicants detected in ${document.filename}; no data from this document was automatically applied.`);
      for (const item of document.rows) {
        for (const field of CLIENT_EDITABLE_FIELDS) {
          if (typeof item.row[field] === "string" && item.row[field]?.trim()) {
            allSeen.add(field);
            reviewReasons[field] = "multiple_applicants";
          }
        }
      }
      continue;
    }
    if (document.rows.length === 0) {
      warnings.push(`No identifiable applicant data was read from ${document.filename}.`);
      continue;
    }
    const result = document.rows[0];
    for (const field of CLIENT_EDITABLE_FIELDS) {
      const original = result.row[field];
      if (typeof original !== "string" || !original.trim()) continue;
      allSeen.add(field);
      const value = normalize(field, original);
      if (!value) {
        reviewReasons[field] = "invalid_value";
        continue;
      }
      const confidence = result.confidence?.[field];
      const current = candidates.get(field) ?? [];
      current.push({ value, confidence: typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : null, filename: document.filename });
      candidates.set(field, current);
    }
  }

  // A person mismatch invalidates the entire combined auto-fill, not merely the
  // name field. Never mix one person's phone with another person's identification.
  const identityConflict = (["full_name", "date_of_birth"] as const).some((field) =>
    new Set((candidates.get(field) ?? []).map((item) => item.value.toLocaleLowerCase())).size > 1,
  );

  for (const field of CLIENT_EDITABLE_FIELDS) {
    const items = candidates.get(field) ?? [];
    if (!items.length) continue;
    fieldSources[field] = [...new Set(items.map((item) => item.filename))];
    if (identityConflict) {
      reviewReasons[field] = "identity_conflict";
    } else if (new Set(items.map((item) => item.value.toLocaleLowerCase())).size > 1) {
      reviewReasons[field] = "conflict";
    } else if (!reviewReasons[field]) {
      if (items.some((item) => item.confidence === null || item.confidence < DOCUMENT_AUTOFILL_CONFIDENCE_FLOOR)) {
        reviewReasons[field] = "low_confidence";
      } else {
        fields[field] = items[0].value;
      }
    }
  }
  if (identityConflict) warnings.push("Documents disagree on the applicant identity. Verify the documents before using extracted details.");
  return {
    fields,
    imported_fields: CLIENT_EDITABLE_FIELDS.filter((field) => fields[field] !== undefined),
    review_fields: CLIENT_EDITABLE_FIELDS.filter((field) => allSeen.has(field) && (reviewReasons[field] !== undefined || fields[field] === undefined)),
    review_reasons: reviewReasons,
    field_sources: fieldSources,
    document_warnings: warnings,
  };
}
