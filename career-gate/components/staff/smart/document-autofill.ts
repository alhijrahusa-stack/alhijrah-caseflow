import {
  SMART_FIELDS,
  smartFieldText,
  type SmartField,
} from "@/components/staff/smart/field-contract";
import { localDisplayValue, sourceKeyFor, type LocalFieldReading } from "@/components/staff/smart/intelligence";

/**
 * Applying a document's read to the capture surface.
 *
 * A document is one source among several, and not the most authoritative one. The
 * order this module enforces, strongest first:
 *
 *   1. the server's own staged draft, once a case exists
 *   2. a value the staff member stated in the source box under its own label
 *   3. a validated extraction from a document
 *   4. an unlabelled inference from the source text
 *
 * So a typed "Phone: 313-555-0100" is never replaced by a document, while a name the
 * text reader merely guessed from an unlabelled line yields to a document that states
 * it plainly. Rule 1 is applied by the surface; rules 2–4 are applied here.
 *
 * A field the merge layer put in review — a cross-document conflict, a value that
 * failed validation, a low-confidence read — is deliberately NOT applied. It is
 * surfaced for the reviewer instead. Nothing here invents a value, and nothing here
 * removes one.
 */

export type DocumentSuggestions = {
  filename: string;
  fields: Record<string, string>;
  imported_fields: readonly string[];
  review_fields: readonly string[];
  review_reasons: Record<string, string>;
  field_sources: Record<string, readonly string[]>;
  document_warnings: readonly string[];
  classification: {
    document_type: string | null;
    issuing_authority: string | null;
    expiration_date: string | null;
    side: string | null;
    legibility: string | null;
    confidence: number | null;
  } | null;
  escalated: boolean;
  duration_ms: number;
  applicants: number;
  /** The machine readable zone's check-digit outcome, when the document has one. */
  mrz: {
    format: string;
    verified: boolean;
    verified_fields: readonly string[];
    issuing_state: string;
    nationality: string;
    expiration_date: string | null;
    failed_checks: readonly string[];
  } | null;
};

/** One field's accepted document value, with where it came from. */
export type AppliedField = {
  key: string;
  value: string;
  filename: string;
  /** Why this field is in review instead of applied, when it is. */
  reason: string | null;
};

export type DocumentFill = {
  /** Field key → the value a document established, strongest document first. */
  values: Record<string, string>;
  /** Field key → the filenames that contributed it. */
  sources: Record<string, string[]>;
  /** Field key → why the read left it for a human instead of applying it. */
  review: Record<string, string>;
  /** Document-level problems: a conflicting identity, an unreadable page. */
  warnings: string[];
};

/** Human wording for each review reason the merge layer can report. */
export const REVIEW_REASON_TEXT: Record<string, string> = {
  conflict: "Two documents state different values for this field.",
  identity_conflict: "The documents do not agree on who the applicant is, so nothing was filled from them.",
  low_confidence: "The document was not read clearly enough to fill this automatically.",
  invalid_value: "The document's value for this field is not a valid one.",
  multiple_applicants: "More than one applicant appears in this document.",
};

/**
 * Combines every document read so far into one set of field values.
 *
 * Documents are folded in the order they were read. A field already established by an
 * earlier document is not overwritten by a later one — but a later document that
 * disagrees puts the field into review, because silently keeping the first answer
 * would hide a real conflict.
 */
export function combineDocumentFills(reads: readonly DocumentSuggestions[]): DocumentFill {
  const values: Record<string, string> = {};
  const sources: Record<string, string[]> = {};
  const review: Record<string, string> = {};
  const warnings: string[] = [];

  for (const read of reads) {
    for (const warning of read.document_warnings) {
      if (!warnings.includes(warning)) warnings.push(warning);
    }
    for (const [key, reason] of Object.entries(read.review_reasons ?? {})) {
      if (reason) review[key] = reason;
    }
    for (const [key, value] of Object.entries(read.fields ?? {})) {
      const text = String(value ?? "").trim();
      if (!text) continue;
      const existing = values[key];
      if (existing === undefined) {
        values[key] = text;
        sources[key] = [...new Set([...(sources[key] ?? []), read.filename])];
        continue;
      }
      sources[key] = [...new Set([...(sources[key] ?? []), read.filename])];
      if (existing.toLocaleLowerCase() !== text.toLocaleLowerCase()) {
        // Two documents disagree. Neither answer is auto-filled over the other.
        review[key] = "conflict";
        delete values[key];
      }
    }
  }
  // A field in review is never also an applied value.
  for (const key of Object.keys(review)) delete values[key];
  return { values, sources, review, warnings };
}

/** True when the source text stated this field under its own label. */
function statedInText(reading: LocalFieldReading | undefined) {
  if (!reading || !smartFieldText(localDisplayValue(reading)).trim()) return false;
  const state = String(reading.evidence?.verification_state ?? "").toUpperCase();
  const strength = String((reading.evidence as { strength?: string } | undefined)?.strength ?? "").toUpperCase();
  return state === "MATCHED" || strength === "HIGH";
}

/**
 * The value to show for one field, and where it came from.
 *
 * Returns null when no source has a value, so the surface can show its own neutral
 * state rather than an empty string that looks like a cleared field.
 */
export function resolveFieldValue(args: {
  field: SmartField;
  serverDraft: Record<string, unknown> | null;
  fill: DocumentFill;
  readings: readonly LocalFieldReading[];
}): { value: unknown; origin: "server" | "text" | "document" | "inference" | null } {
  const { field, serverDraft, fill, readings } = args;
  if (serverDraft) {
    const value = serverDraft[field.key];
    return { value: value ?? null, origin: smartFieldText(value).trim() ? "server" : null };
  }

  const reading = readings.find((item) => item.field.key === field.key);
  const textValue = reading ? localDisplayValue(reading) : null;
  // 2 — a labelled statement in the source box outranks any document.
  if (statedInText(reading)) return { value: textValue, origin: "text" };

  // 3 — a validated document extraction, under either the contract key or the
  // extractor's own row key for the same field.
  const documentValue = fill.values[field.key] ?? fill.values[sourceKeyFor(field.key)];
  if (documentValue) return { value: documentValue, origin: "document" };

  // 4 — an unlabelled inference from the text, weakest of the four.
  if (smartFieldText(textValue).trim()) return { value: textValue, origin: "inference" };
  return { value: null, origin: null };
}

/** The review reason for a field, under either key the two layers use. */
export function reviewReasonFor(fill: DocumentFill, key: string): string | null {
  return fill.review[key] ?? fill.review[sourceKeyFor(key)] ?? null;
}

/** Contract fields a document established, for an honest count on the surface. */
export function documentFilledKeys(fill: DocumentFill): string[] {
  return SMART_FIELDS
    .filter((field) => Boolean(fill.values[field.key] ?? fill.values[sourceKeyFor(field.key)]))
    .map((field) => field.key);
}
