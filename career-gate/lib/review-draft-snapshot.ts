import type { ReviewDraftPayload } from "@/lib/review-offline-drafts";

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, ordered(nested)]));
}

/** Compare the editable save contract, preserving exact database version precision. */
export function sameReviewDraft(left: ReviewDraftPayload | null | undefined, right: ReviewDraftPayload | null | undefined) {
  if (!left || !right) return false;
  const snapshot = (payload: ReviewDraftPayload) => ordered({
    id: payload.id, reviewer_id: payload.reviewer_id, draft: payload.draft,
    document_match_confirmed: payload.document_match_confirmed,
    information_match_confirmed: payload.information_match_confirmed,
    resolved_fields: [...(payload.resolved_fields ?? [])].sort(), expected_updated_at: payload.expected_updated_at,
  });
  return JSON.stringify(snapshot(left)) === JSON.stringify(snapshot(right));
}
