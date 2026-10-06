import {
  normalizeEnglishProficiency,
  normalizeImportLanguage,
  normalizeShiftDays,
  normalizeShiftTime,
  normalizeSmartDate,
} from "@/lib/smart-client-fields";
import {
  SMART_FIELDS,
  type SmartEvidence,
  type SmartField,
  smartFieldText,
} from "@/components/staff/smart/field-contract";

/**
 * Local reading of the sixteen reviewed fields for the capture surface.
 *
 * The deterministic extractor returns raw source values keyed by intake-row names. This
 * module maps those onto the reviewed field contract and runs the SAME canonical
 * normalizers the server uses — it never re-implements one, and it never infers a value
 * the extractor did not find (notably, preferred language is never derived from English
 * proficiency). Everything here is a read of local evidence; the server stays
 * authoritative the moment a case is staged.
 */

/** Reviewed field key → the intake-row key the deterministic extractor fills. */
const SOURCE_KEY: Record<string, string> = {
  preferred_location: "site_code",
  location_option_2: "backup_site_code",
};

function sourceKeyFor(key: string) {
  return SOURCE_KEY[key] ?? key;
}

export type LocalFieldReading = {
  field: SmartField;
  /** Exactly what the source said, or "" when the extractor found nothing. */
  raw: string;
  /** The canonical interpretation, or null when the source value is not valid. */
  normalized: string | string[] | null;
  /** True when a raw value exists but no canonical value could be derived from it. */
  invalid: boolean;
  evidence: SmartEvidence | undefined;
};

function normalizeFor(key: string, raw: string): string | string[] | null {
  if (!raw.trim()) return null;
  switch (key) {
    case "date_of_birth": return normalizeSmartDate(raw);
    case "preferred_language": return normalizeImportLanguage(raw);
    case "english_proficiency": return normalizeEnglishProficiency(raw);
    case "shift_days": return normalizeShiftDays(raw);
    case "shift_start_time":
    case "shift_end_time": return normalizeShiftTime(raw);
    default: return raw.trim();
  }
}

/** Fields whose raw source text is only meaningful once canonicalized. */
const CANONICAL_ONLY = new Set(["date_of_birth", "preferred_language", "english_proficiency", "shift_days", "shift_start_time", "shift_end_time"]);

export function readLocalFields(
  row: Readonly<Record<string, unknown>>,
  evidence: readonly SmartEvidence[],
): LocalFieldReading[] {
  return SMART_FIELDS.map((field) => {
    const sourceKey = sourceKeyFor(field.key);
    const raw = smartFieldText(row[sourceKey]).trim();
    const normalized = normalizeFor(field.key, raw);
    const entry = evidence.find((item) => item.field_key === sourceKey || item.field_key === field.key);
    return {
      field,
      raw,
      normalized,
      invalid: Boolean(raw) && normalized == null && CANONICAL_ONLY.has(field.key),
      evidence: entry,
    };
  });
}

/** The value the capture surface shows: the canonical reading when there is one. */
export function localDisplayValue(reading: LocalFieldReading) {
  if (reading.normalized != null) return reading.normalized;
  return reading.invalid ? "" : reading.raw;
}

/**
 * Provenance for a locally read field: `normalized` when the canonical value differs from
 * the source text, otherwise the extractor's own provenance. Returns null when the
 * extractor found nothing, so nothing is invented.
 */
export function localProvenance(reading: LocalFieldReading): string | null {
  if (!reading.raw) return null;
  const canonical = smartFieldText(reading.normalized);
  if (reading.normalized != null && canonical !== reading.raw) return "normalized";
  return reading.evidence?.source_type ?? "local_text";
}

/** Source coverage, stated only as a factual band — never a fabricated percentage. */
export function sourceMatchState(args: { hasText: boolean; documentCount: number; detectedFields: number }) {
  if (!args.hasText && !args.documentCount) return "MANUAL SOURCE" as const;
  if (args.detectedFields === 0) return "MANUAL SOURCE" as const;
  return args.hasText && args.detectedFields >= 4 ? ("FULL SOURCE CAPTURED" as const) : ("PARTIAL SOURCE" as const);
}
