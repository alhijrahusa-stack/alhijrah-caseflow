/**
 * Smart Career Collect: automatic approval of a mobile import when the AI read
 * the client's identity from the uploaded documents with high confidence.
 *
 * Owner decision (2026-11-05): a file whose identity fields were extracted at
 * 90% confidence or more is approved without a staff review. The decision here
 * is deliberately narrow; anything uncertain is left for a person:
 *
 *  - every uploaded document was read by Gemini (no failed or partial extraction,
 *    no document showing more than one person);
 *  - Full name comes from at least one document at or above the threshold, and no
 *    document reading of it falls below the threshold;
 *  - Date of birth, when any document gives it, meets the same rule;
 *  - Phone is present (staff-typed or read), since the client row requires it;
 *  - no source reading conflicts with another on any field;
 *  - no person has started reviewing the file.
 *
 * Approval itself then runs the ordinary approval path, so the duplicate-identity,
 * canonical-type, reviewer and concurrency checks still apply and still refuse.
 */

export const AUTO_APPROVAL_IDENTITY_FIELDS = Object.freeze(["full_name", "date_of_birth"] as const);
export const DEFAULT_AUTO_APPROVAL_THRESHOLD = 0.9;

/** `SMART_AUTO_APPROVE_MIN_CONFIDENCE`: a number in (0, 1], or "off" to disable. Defaults to 0.9. */
export function autoApprovalThreshold(raw: string | undefined | null = process.env.SMART_AUTO_APPROVE_MIN_CONFIDENCE): number | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return DEFAULT_AUTO_APPROVAL_THRESHOLD;
  if (value === "off" || value === "false" || value === "0") return null;
  const number = Number(value);
  // A malformed value never loosens the rule: it falls back to the default.
  return Number.isFinite(number) && number > 0 && number <= 1 ? Math.max(number, 0.5) : DEFAULT_AUTO_APPROVAL_THRESHOLD;
}

type Evidence = Record<string, unknown>;

export type AutoApprovalInput = {
  threshold: number | null;
  aiState: string;
  documentCount: number;
  extractionErrors: readonly unknown[];
  conflicts: readonly unknown[];
  evidence: readonly Evidence[];
  reviewed: boolean;
  draftPhone: unknown;
  draftFullName: unknown;
};

export type AutoApprovalDecision =
  | { eligible: true; threshold: number; confidence: Record<string, number> }
  | { eligible: false; reason: string };

const present = (value: unknown) => typeof value === "string" ? value.trim().length > 0 : value != null;

/** Pure decision; exported for tests. */
export function autoApprovalDecision(input: AutoApprovalInput): AutoApprovalDecision {
  if (input.threshold === null) return { eligible: false, reason: "disabled" };
  if (input.reviewed) return { eligible: false, reason: "review_started" };
  if (input.documentCount < 1) return { eligible: false, reason: "no_documents" };
  if (input.aiState !== "COMPLETE") return { eligible: false, reason: `ai_${input.aiState.toLowerCase()}` };
  if (input.extractionErrors.length) return { eligible: false, reason: "extraction_errors" };
  if (input.conflicts.length) return { eligible: false, reason: "source_conflicts" };
  if (!present(input.draftFullName)) return { eligible: false, reason: "full_name_missing" };
  if (!present(input.draftPhone)) return { eligible: false, reason: "phone_missing" };

  const confidence: Record<string, number> = {};
  for (const field of AUTO_APPROVAL_IDENTITY_FIELDS) {
    const readings = input.evidence.filter((entry) =>
      entry.field_key === field && entry.source_type === "document" && present(entry.value));
    if (!readings.length) {
      if (field === "full_name") return { eligible: false, reason: "full_name_not_from_document" };
      continue;
    }
    const scores = readings.map((entry) => (typeof entry.confidence_score === "number" ? entry.confidence_score : null));
    if (scores.some((score) => score === null)) return { eligible: false, reason: `${field}_confidence_unknown` };
    const lowest = Math.min(...(scores as number[]));
    if (lowest < input.threshold) return { eligible: false, reason: `${field}_below_threshold` };
    confidence[field] = lowest;
  }
  return { eligible: true, threshold: input.threshold, confidence };
}

export const AUTO_APPROVAL_REASON = "Automatic approval: identity read from the documents at or above the confidence threshold (owner policy, Smart Career Collect).";
