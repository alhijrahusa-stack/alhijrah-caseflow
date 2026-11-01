import { describe, expect, it, vi } from "vitest";
import { purgeReviewDrafts, readReviewDraft, REVIEW_DRAFT_TTL_MS, reviewDraftKey, syncReviewDrafts, writeReviewDraft, type ReviewDraftPayload, type ReviewSyncDetail } from "@/lib/review-offline-drafts";

class MemoryStorage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
}
const staffId = "staff-owner";
const payload = (id = "review-case"): ReviewDraftPayload => ({
  action: "save", id, reviewer_id: "reviewer", draft: { profile: { full_name: "TEST Offline Draft" } },
  document_match_confirmed: false, information_match_confirmed: false,
  expected_updated_at: "2026-10-31T10:00:00.000001Z", expected_revision: "41", resolved_fields: ["full_name"],
});
const response = (status: number, value: object) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

describe("versioned offline review outbox", () => {
  it("stores only the draft save contract and binds the original actor", () => {
    const storage = new MemoryStorage();
    writeReviewDraft(storage, staffId, { ...payload(), expected_actor_id: "forged", token: "never-store" } as ReviewDraftPayload, false);
    const draft = readReviewDraft(storage, staffId, "review-case")!;
    expect(draft.payload.expected_actor_id).toBe(staffId);
    expect(draft.payload).not.toHaveProperty("token");
    expect(draft.payload.action).toBe("save");
    expect(draft.payload.expected_updated_at).toBe("2026-10-31T10:00:00.000001Z");
    expect(draft.payload.expected_revision).toBe("41");
  });
  it("discards malformed, expired or wrong-actor drafts without replaying them", () => {
    const storage = new MemoryStorage();
    const stored = writeReviewDraft(storage, staffId, payload(), true);
    expect(readReviewDraft(storage, staffId, "review-case", stored.savedAt + REVIEW_DRAFT_TTL_MS + 1)).toBeNull();
    storage.setItem(reviewDraftKey(staffId, "review-case"), JSON.stringify({ ...stored, payload: { ...stored.payload, expected_actor_id: "other" } }));
    expect(readReviewDraft(storage, staffId, "review-case")).toBeNull();
    expect(() => writeReviewDraft(storage, staffId, { ...payload(), expected_updated_at: "" }, true)).toThrow("server version");
  });
  it("replays only an explicit queued save and removes it after success", async () => {
    const storage = new MemoryStorage();
    writeReviewDraft(storage, staffId, payload("local-only"), false);
    writeReviewDraft(storage, staffId, payload(), true);
    const fetcher = vi.fn(async () => response(200, { ok: true, updated_at: "2026-10-31T10:01:00.000001Z" }));
    const events: ReviewSyncDetail[] = [];
    await syncReviewDrafts(storage, staffId, fetcher, (detail) => events.push(detail));
    expect(fetcher).toHaveBeenCalledTimes(1);
    const options = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(options.body))).toMatchObject({ action: "save", expected_updated_at: payload().expected_updated_at, expected_revision: "41", expected_actor_id: staffId });
    expect(readReviewDraft(storage, staffId, "review-case")).toBeNull();
    expect(readReviewDraft(storage, staffId, "local-only")).not.toBeNull();
    expect(events.map((detail) => detail.state)).toEqual(["syncing", "synced"]);
    expect(events.every((detail) => detail.staffId === staffId)).toBe(true);
    expect(events.at(-1)?.appliedPayload).toMatchObject({ expected_actor_id: staffId, draft: payload().draft });
  });
  it("retains legacy queued and local-only drafts without replaying either", async () => {
    const storage = new MemoryStorage();
    for (const [id, queued] of [["legacy-queued", true], ["legacy-local", false]] as const) {
      const stored = writeReviewDraft(storage, staffId, payload(id), queued);
      const legacyPayload = { ...stored.payload };
      delete legacyPayload.expected_revision;
      storage.setItem(reviewDraftKey(staffId, id), JSON.stringify({ ...stored, payload: legacyPayload }));
    }
    const fetcher = vi.fn();
    const events: ReviewSyncDetail[] = [];
    await syncReviewDrafts(storage, staffId, fetcher, detail => events.push(detail));
    expect(fetcher).not.toHaveBeenCalled();
    expect(readReviewDraft(storage, staffId, "legacy-queued")).toMatchObject({ queued: false, conflict: true, payload: { draft: payload().draft } });
    expect(readReviewDraft(storage, staffId, "legacy-local")).toMatchObject({ queued: false, payload: { draft: payload().draft } });
    expect(events).toEqual([expect.objectContaining({ caseId: "legacy-queued", state: "conflict" })]);
  });
  it("requires a valid positive revision for newly saved drafts", () => {
    const storage = new MemoryStorage();
    for (const revision of [undefined, "0", "01", "1.1", "9223372036854775808"]) {
      expect(() => writeReviewDraft(storage, staffId, { ...payload(), expected_revision: revision }, true)).toThrow("Reload the review");
    }
  });
  it("retains a conflict for human comparison and never retries over newer server data", async () => {
    const storage = new MemoryStorage();
    writeReviewDraft(storage, staffId, payload(), true);
    const fetcher = vi.fn(async () => response(409, { ok: false, error: { code: "review_changed", message: "Newer review exists" } }));
    const events: ReviewSyncDetail[] = [];
    await syncReviewDrafts(storage, staffId, fetcher, (detail) => events.push(detail));
    expect(readReviewDraft(storage, staffId, "review-case")).toMatchObject({ queued: false, conflict: true });
    await syncReviewDrafts(storage, staffId, fetcher, () => {});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({ state: "conflict", message: "Newer review exists" });
  });
  it("preserves newer local edits made during a queued save instead of replacing them", async () => {
    const storage = new MemoryStorage();
    writeReviewDraft(storage, staffId, payload(), true);
    const fetcher = vi.fn(async () => {
      writeReviewDraft(storage, staffId, { ...payload(), draft: { profile: { full_name: "TEST Newer Local Edit" } } }, false);
      return response(200, { ok: true, updated_at: "2026-10-31T10:02:00Z" });
    });
    const events: ReviewSyncDetail[] = [];
    await syncReviewDrafts(storage, staffId, fetcher, (detail) => events.push(detail));
    expect(readReviewDraft(storage, staffId, "review-case")).toMatchObject({ queued: false, conflict: true, payload: { draft: { profile: { full_name: "TEST Newer Local Edit" } } } });
    expect(events.at(-1)?.state).toBe("conflict");
    expect(events.some((detail) => detail.state === "synced")).toBe(false);
  });
  it("accepts an identical autosave written while the queued request is in flight", async () => {
    const storage = new MemoryStorage();
    writeReviewDraft(storage, staffId, payload(), true);
    const events: ReviewSyncDetail[] = [];
    await syncReviewDrafts(storage, staffId, async () => {
      writeReviewDraft(storage, staffId, payload(), true);
      return response(200, { ok: true, updated_at: "2026-10-31T10:02:00Z" });
    }, (detail) => events.push(detail));
    expect(readReviewDraft(storage, staffId, "review-case")).toBeNull();
    expect(events.map((detail) => detail.state)).toEqual(["syncing", "synced"]);
  });
  it("keeps queued saves during connection failures and serializes overlapping sync requests", async () => {
    const storage = new MemoryStorage();
    writeReviewDraft(storage, staffId, payload(), true);
    const fetcher = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await Promise.all([syncReviewDrafts(storage, staffId, fetcher, () => {}), syncReviewDrafts(storage, staffId, fetcher, () => {})]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(readReviewDraft(storage, staffId, "review-case")).toMatchObject({ queued: true });
  });
  it("clears all review drafts after authentication loss and removes other staff drafts on identity change", async () => {
    const storage = new MemoryStorage();
    storage.setItem("unrelated-preference", "keep");
    writeReviewDraft(storage, "other-staff", payload("other-case"), false);
    writeReviewDraft(storage, staffId, payload(), true);
    purgeReviewDrafts(storage, staffId);
    expect(readReviewDraft(storage, "other-staff", "other-case")).toBeNull();
    await syncReviewDrafts(storage, staffId, async () => response(401, { ok: false }), () => {});
    expect(readReviewDraft(storage, staffId, "review-case")).toBeNull();
    expect(storage.getItem("unrelated-preference")).toBe("keep");
  });
  it("treats a changed signed-in actor as an authentication boundary, not a version conflict", async () => {
    const storage = new MemoryStorage();
    writeReviewDraft(storage, staffId, payload(), true);
    const events: ReviewSyncDetail[] = [];
    await syncReviewDrafts(storage, staffId, async () => response(409, { ok: false, error: { code: "session_changed" } }), (detail) => events.push(detail));
    expect(readReviewDraft(storage, staffId, "review-case")).toBeNull();
    expect(events.at(-1)).toMatchObject({ staffId, state: "unauthorized" });
    expect(events.some((detail) => detail.state === "conflict")).toBe(false);
  });
  it("ignores a late successful response after sign-out cancellation without clearing retained drafts or dispatching success", async () => {
    const storage = new MemoryStorage();
    writeReviewDraft(storage, staffId, payload(), true);
    const lifetime = new AbortController();
    let complete!: (value: Response) => void;
    const fetcher = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      return new Promise<Response>((resolve) => { complete = resolve; });
    });
    const events: ReviewSyncDetail[] = [];
    const operation = syncReviewDrafts(storage, staffId, fetcher, (detail) => events.push(detail), lifetime.signal);
    lifetime.abort();
    complete(response(200, { ok: true, updated_at: "2026-10-31T12:00:00Z" }));
    await operation;
    expect(events.map((detail) => detail.state)).toEqual(["syncing"]);
    expect(readReviewDraft(storage, staffId, "review-case")).toMatchObject({ queued: true });
  });
  it("allows a fresh session to sync while an obsolete cancelled request is still settling", async () => {
    const storage = new MemoryStorage();
    writeReviewDraft(storage, staffId, payload(), true);
    const lifetime = new AbortController();
    let completeOld!: (value: Response) => void;
    const oldEvents: ReviewSyncDetail[] = [];
    const oldOperation = syncReviewDrafts(storage, staffId, async () => new Promise<Response>((resolve) => { completeOld = resolve; }), (detail) => oldEvents.push(detail), lifetime.signal);
    lifetime.abort();
    const newEvents: ReviewSyncDetail[] = [];
    await syncReviewDrafts(storage, staffId, async () => response(200, { ok: true, updated_at: "2026-10-31T13:00:00Z" }), (detail) => newEvents.push(detail), new AbortController().signal);
    completeOld(response(200, { ok: true, updated_at: "2026-10-31T12:00:00Z" }));
    await oldOperation;
    expect(oldEvents.map((detail) => detail.state)).toEqual(["syncing"]);
    expect(newEvents.map((detail) => detail.state)).toEqual(["syncing", "synced"]);
    expect(readReviewDraft(storage, staffId, "review-case")).toBeNull();
  });
});
