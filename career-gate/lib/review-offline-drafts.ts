/** Session-only review drafts. This module stores no uploaded files, auth tokens or signed document URLs. */
export const REVIEW_DRAFT_PREFIX = "career-gate:review-draft:";
export const REVIEW_DRAFT_TTL_MS = 8 * 60 * 60 * 1000;
export const REVIEW_DRAFT_EVENT = "career-gate:review-outbox";
export const REVIEW_SYNC_EVENT = "career-gate:review-draft-sync";

export type ReviewDraftPayload = {
  action: "save";
  id: string;
  reviewer_id: string;
  draft: Record<string, unknown>;
  document_match_confirmed: boolean;
  information_match_confirmed: boolean;
  resolved_fields?: string[];
  expected_updated_at: string;
  expected_actor_id?: string;
};
export type StoredReviewDraft = {
  format: 1;
  staffId: string;
  savedAt: number;
  nonce: string;
  queued: boolean;
  conflict?: boolean;
  payload: ReviewDraftPayload;
};
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
export type ReviewSyncDetail = {
  staffId: string;
  caseId: string;
  state: "syncing" | "synced" | "conflict" | "error" | "unauthorized";
  response?: Record<string, unknown>;
  appliedPayload?: ReviewDraftPayload;
  message?: string;
};

export function reviewDraftKey(staffId: string, caseId: string) {
  return `${REVIEW_DRAFT_PREFIX}${staffId}:${caseId}`;
}

export function purgeReviewDrafts(storage: StorageLike, keepStaffId?: string) {
  const prefixToKeep = keepStaffId ? `${REVIEW_DRAFT_PREFIX}${keepStaffId}:` : null;
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (key?.startsWith(REVIEW_DRAFT_PREFIX) && (!prefixToKeep || !key.startsWith(prefixToKeep))) storage.removeItem(key);
  }
}

export function readReviewDraft(storage: StorageLike, staffId: string, caseId: string, now = Date.now()): StoredReviewDraft | null {
  const key = reviewDraftKey(staffId, caseId);
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    if (raw.length > 262144) throw new Error("oversize");
    const value = JSON.parse(raw) as StoredReviewDraft;
    if (value.format !== 1 || value.staffId !== staffId || value.payload?.id !== caseId || value.payload.action !== "save"
      || value.payload.expected_actor_id !== staffId || typeof value.payload.expected_updated_at !== "string"
      || !Number.isFinite(Date.parse(value.payload.expected_updated_at)) || typeof value.payload.reviewer_id !== "string"
      || !value.payload.draft || typeof value.payload.draft !== "object" || Array.isArray(value.payload.draft)
      || typeof value.payload.document_match_confirmed !== "boolean" || typeof value.payload.information_match_confirmed !== "boolean"
      || typeof value.nonce !== "string" || typeof value.queued !== "boolean" || !Number.isFinite(value.savedAt)
      || now - value.savedAt > REVIEW_DRAFT_TTL_MS || value.savedAt > now + 60000) throw new Error("invalid");
    return value;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function writeReviewDraft(storage: StorageLike, staffId: string, payload: ReviewDraftPayload, queued: boolean): StoredReviewDraft {
  if (!payload.expected_updated_at || !Number.isFinite(Date.parse(payload.expected_updated_at))) throw new Error("A server version is required before saving an offline draft.");
  // Copy only the documented save contract, never arbitrary request headers or document data.
  const safePayload: ReviewDraftPayload = {
    action: "save", id: payload.id, reviewer_id: payload.reviewer_id, draft: payload.draft,
    document_match_confirmed: payload.document_match_confirmed, information_match_confirmed: payload.information_match_confirmed,
    ...(payload.resolved_fields ? { resolved_fields: payload.resolved_fields } : {}),
    expected_updated_at: payload.expected_updated_at, expected_actor_id: staffId,
  };
  const value: StoredReviewDraft = { format: 1, staffId, savedAt: Date.now(), nonce: crypto.randomUUID(), queued, payload: safePayload };
  const text = JSON.stringify(value);
  if (text.length > 262144) throw new Error("This draft is too large for temporary browser storage. Save while online.");
  storage.setItem(reviewDraftKey(staffId, payload.id), text);
  return value;
}

const syncing = new Map<string, { token: symbol; signal?: AbortSignal }>();
export async function syncReviewDrafts(
  storage: StorageLike,
  staffId: string,
  fetcher: typeof fetch,
  notify: (detail: ReviewSyncDetail) => void,
  signal?: AbortSignal,
) {
  if (signal?.aborted) return;
  const previous = syncing.get(staffId);
  if (previous && !previous.signal?.aborted) return;
  const operation = { token: Symbol("review-sync"), signal };
  syncing.set(staffId, operation);
  const deliver = (detail: Omit<ReviewSyncDetail, "staffId">) => {
    if (!signal?.aborted && syncing.get(staffId) === operation) notify({ ...detail, staffId });
  };
  try {
    const prefix = `${REVIEW_DRAFT_PREFIX}${staffId}:`;
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => Boolean(key?.startsWith(prefix)));
    for (const key of keys) {
      if (signal?.aborted || syncing.get(staffId) !== operation) break;
      const caseId = key.slice(prefix.length);
      const stored = readReviewDraft(storage, staffId, caseId);
      if (!stored?.queued || stored.conflict) continue;
      deliver({ caseId, state: "syncing", appliedPayload: stored.payload });
      let response: Response;
      try {
        const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
        response = await fetcher("/api/staff/smart-client-import", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store", signal: requestSignal, body: JSON.stringify(stored.payload) });
      } catch {
        deliver({ caseId, state: "error", message: "Connection unavailable. Your queued draft remains in this browser session." });
        break;
      }
      if (signal?.aborted || syncing.get(staffId) !== operation) break;
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: { code?: string; message?: string }; updated_at?: string } | null;
      if (signal?.aborted || syncing.get(staffId) !== operation) break;
      if (response.status === 401 || response.status === 403 || result?.error?.code === "session_changed") {
        purgeReviewDrafts(storage);
        deliver({ caseId, state: "unauthorized", message: "Your signed-in account changed or expired. Temporary drafts were cleared for account safety. Sign in again before reviewing." });
        break;
      }
      if (response.status === 429 || response.status >= 500) {
        deliver({ caseId, state: "error", message: result?.error?.message ?? "Server unavailable. Your queued draft is retained; retry after reconnecting." });
        break;
      }
      const current = readReviewDraft(storage, staffId, caseId);
      if (response.ok && result?.ok) {
        if (current?.nonce === stored.nonce) storage.removeItem(key);
        else if (current) {
          // Do not replace newer edits with the server response from an earlier queued draft.
          storage.setItem(key, JSON.stringify({ ...current, queued: false, conflict: true }));
          deliver({ caseId, state: "conflict", appliedPayload: stored.payload, message: "An earlier draft synced, but newer local edits are retained. Review the current server version before saving again." });
          continue;
        }
        deliver({ caseId, state: "synced", response: result as Record<string, unknown>, appliedPayload: stored.payload });
      } else {
        if (current) storage.setItem(key, JSON.stringify({ ...current, queued: false, conflict: response.status === 409 }));
        deliver({ caseId, state: response.status === 409 ? "conflict" : "error", message: result?.error?.message ?? "Draft could not be synced. Review it before trying again." });
      }
    }
  } finally { if (syncing.get(staffId) === operation) syncing.delete(staffId); }
}
