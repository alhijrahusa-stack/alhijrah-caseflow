import { ENGLISH_PROFICIENCY_VALUES, LANGUAGES } from "@/lib/domain";
import { SHIFT_DAY_CODES } from "@/lib/smart-client-fields";

/**
 * Presentation contract for the sixteen reviewed Smart fields. Both the Smart Import
 * capture surface and the Smart Review matrix read this module, so the grouping, labels
 * and the state/provenance/authority derivation stay identical across the two screens.
 *
 * This module only *reads* the authoritative draft and evidence produced by the server.
 * It never derives a field value of its own and never holds a second copy of one.
 */

export type SmartFieldScope = "profile" | "review_fields";
export type SmartFieldEditor = "text" | "language" | "english_proficiency" | "shift_days" | "time" | "date";

export type SmartField = {
  key: string;
  label: string;
  scope: SmartFieldScope;
  required: boolean;
  editor: SmartFieldEditor;
  /** Shown as the accessible description of the editor; never invents a value. */
  hint?: string;
};

export const SMART_FIELD_GROUPS: readonly { title: string; fields: readonly SmartField[] }[] = [
  {
    title: "IDENTITY",
    fields: [
      { key: "full_name", label: "Full Name", scope: "profile", required: true, editor: "text" },
      { key: "phone", label: "Phone", scope: "profile", required: true, editor: "text", hint: "10-digit US number" },
      { key: "email", label: "Email", scope: "profile", required: false, editor: "text" },
      { key: "date_of_birth", label: "Date of Birth", scope: "profile", required: false, editor: "date", hint: "YYYY-MM-DD" },
    ],
  },
  {
    title: "ADDRESS",
    fields: [
      { key: "street", label: "Street", scope: "profile", required: false, editor: "text" },
      { key: "city", label: "City", scope: "profile", required: false, editor: "text" },
      { key: "state", label: "State", scope: "profile", required: false, editor: "text" },
      { key: "zip", label: "ZIP", scope: "profile", required: false, editor: "text", hint: "ZIP5 or ZIP+4" },
    ],
  },
  {
    title: "LANGUAGE & ENGLISH",
    fields: [
      { key: "preferred_language", label: "Preferred Language", scope: "profile", required: false, editor: "language" },
      { key: "english_proficiency", label: "English Proficiency", scope: "profile", required: false, editor: "english_proficiency" },
    ],
  },
  {
    title: "JOB PREFERENCES",
    fields: [
      { key: "preferred_location", label: "Preferred Location", scope: "review_fields", required: false, editor: "text" },
      { key: "location_option_1", label: "Location Option 1", scope: "review_fields", required: false, editor: "text" },
      { key: "location_option_2", label: "Location Option 2", scope: "review_fields", required: false, editor: "text" },
      { key: "shift_days", label: "Shift Days", scope: "review_fields", required: false, editor: "shift_days" },
      { key: "shift_start_time", label: "Shift Start", scope: "review_fields", required: false, editor: "time" },
      { key: "shift_end_time", label: "Shift End", scope: "review_fields", required: false, editor: "time" },
    ],
  },
] as const;

export const SMART_FIELDS: readonly SmartField[] = SMART_FIELD_GROUPS.flatMap((group) => group.fields);
export const SMART_REQUIRED_FIELDS: readonly SmartField[] = SMART_FIELDS.filter((field) => field.required);

export const LANGUAGE_OPTIONS = Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }));
export const ENGLISH_PROFICIENCY_OPTIONS = ENGLISH_PROFICIENCY_VALUES.map((value) => ({ value, label: value }));
export const SHIFT_DAY_OPTIONS = SHIFT_DAY_CODES;

export type SmartFieldState = "DETECTED" | "VERIFIED" | "MANUAL" | "REVIEW" | "MISSING" | "CONFLICT";
export type SmartFieldAuthority = "SOURCE" | "MANUAL";

export type SmartEvidence = {
  field_key?: string;
  value?: unknown;
  normalized_value?: unknown;
  source_type?: string;
  source_document_id?: string | null;
  source_page?: number | null;
  source_text_reference?: string | null;
  verification_state?: string;
  authority?: string;
  reviewer_id?: string | null;
  reviewed_at?: string | null;
};

/** Workflow states that must never be shown as a value's provenance. */
const NON_PROVENANCE = new Set(["staged", "pending", "review", "unknown", ""]);

export function smartFieldText(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value == null) return "";
  return typeof value === "string" ? value : String(value);
}

/** The most recent evidence entry for a field is its current authority. */
export function latestSmartEvidence(evidence: readonly SmartEvidence[], key: string): SmartEvidence | undefined {
  for (let i = evidence.length - 1; i >= 0; i -= 1) {
    if (evidence[i]?.field_key === key) return evidence[i];
  }
  return undefined;
}

/**
 * Provenance is where a value came from. It is deliberately separate from authority
 * (SOURCE vs MANUAL) and from workflow state, and returns null rather than guessing.
 */
export function smartProvenance(evidence: SmartEvidence | undefined): string | null {
  const raw = String(evidence?.source_type ?? "").trim().toLowerCase();
  if (!raw || NON_PROVENANCE.has(raw)) return null;
  if (raw === "manual_review") return "manual";
  if (raw === "local_text") return "local_text";
  if (/\.(pdf|png|jpe?g|webp|tiff?)$/.test(raw)) return "document";
  return raw;
}

export function smartAuthority(evidence: SmartEvidence | undefined): SmartFieldAuthority {
  const declared = String(evidence?.authority ?? "").trim().toUpperCase();
  if (declared === "MANUAL") return "MANUAL";
  if (declared === "SOURCE") return "SOURCE";
  return evidence?.source_type === "manual_review" ? "MANUAL" : "SOURCE";
}

export type SmartFieldStatus = {
  state: SmartFieldState;
  authority: SmartFieldAuthority;
  provenance: string | null;
  evidence: SmartEvidence | undefined;
  hasValue: boolean;
};

export function smartFieldStatus(args: {
  key: string;
  value: unknown;
  evidence: readonly SmartEvidence[];
  missingFields?: readonly unknown[];
  conflicts?: readonly { field_key?: unknown; field?: unknown }[];
}): SmartFieldStatus {
  const entry = latestSmartEvidence(args.evidence, args.key);
  const authority = smartAuthority(entry);
  const provenance = smartProvenance(entry);
  const hasValue = smartFieldText(args.value).trim().length > 0;
  const verification = String(entry?.verification_state ?? "").trim().toUpperCase();
  const conflicted = (args.conflicts ?? []).some(
    (item) => String(item?.field_key ?? "") === args.key || String(item?.field ?? "") === args.key,
  );
  const reportedMissing = (args.missingFields ?? []).some((item) => String(item) === args.key);

  let state: SmartFieldState;
  if (conflicted || verification === "CONFLICT") state = "CONFLICT";
  else if (!hasValue || reportedMissing) state = "MISSING";
  else if (authority === "MANUAL") state = "MANUAL";
  else if (verification === "MATCHED" || verification === "VERIFIED") state = "VERIFIED";
  else if (entry) state = "DETECTED";
  else state = "REVIEW";

  return { state, authority, provenance, evidence: entry, hasValue };
}

/** Tailwind text colour per state. Colour is always paired with the state word itself. */
export function smartStateClass(state: SmartFieldState) {
  switch (state) {
    case "VERIFIED": return "text-emerald-300";
    case "MANUAL": return "text-[#e3c884]";
    case "CONFLICT": return "text-red-300";
    case "MISSING": return "text-slate-400";
    case "DETECTED": return "text-cyan-300";
    default: return "text-amber-300";
  }
}

export function smartAuthorityClass(authority: SmartFieldAuthority) {
  return authority === "MANUAL" ? "text-[#e3c884]" : "text-cyan-200";
}

/** Required canonical fields that still have no value, for an honest N / N readout. */
export function smartRequiredReadiness(read: (field: SmartField) => unknown) {
  const missing = SMART_REQUIRED_FIELDS.filter((field) => !smartFieldText(read(field)).trim());
  return {
    total: SMART_REQUIRED_FIELDS.length,
    complete: SMART_REQUIRED_FIELDS.length - missing.length,
    missing: missing.map((field) => field.label),
  };
}
