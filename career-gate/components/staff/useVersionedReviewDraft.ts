"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { readReviewDraft, reviewDraftKey, REVIEW_DRAFT_EVENT, REVIEW_SYNC_EVENT, writeReviewDraft, type ReviewDraftPayload, type ReviewSyncDetail } from "@/lib/review-offline-drafts";

export type ReviewDraftState = "idle" | "saved" | "queued" | "syncing" | "conflict" | "error";

export function useVersionedReviewDraft(options: {
  staffId: string;
  caseId: string | null;
  serverVersion: string | null;
  onRestore: (payload: ReviewDraftPayload) => void;
  onSyncStart?: (appliedPayload?: ReviewDraftPayload) => void;
  onSynced: (data: Record<string, unknown>, appliedPayload?: ReviewDraftPayload) => boolean | void;
  onConflict: () => void;
}) {
  const [online, setOnline] = useState(true);
  const [state, setState] = useState<ReviewDraftState>("idle");
  const [message, setMessage] = useState("");
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  const restoredKey = useRef("");
  const { staffId, caseId, serverVersion } = options;

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  useEffect(() => {
    if (!caseId || !serverVersion) { restoredKey.current = ""; return; }
    const key = reviewDraftKey(staffId, caseId);
    if (restoredKey.current === key) return;
    // Restoration is an external storage operation, scheduled after the current server snapshot commits.
    // Cancelling on case/version changes prevents an old draft from leaking into a newly opened review.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      restoredKey.current = key;
      let stored;
      try { stored = readReviewDraft(sessionStorage, staffId, caseId); }
      catch { setState("error"); setMessage("Temporary browser storage is unavailable. Keep this review open and save online."); return; }
      if (!stored) { setState("idle"); setMessage(""); return; }
      if (stored.conflict || stored.payload.expected_revision !== serverVersion) {
        setState("conflict"); setMessage("A temporary draft exists from another server version. Restore it for comparison or discard it; it will not overwrite newer server data.");
        latest.current.onConflict();
        return;
      }
      latest.current.onRestore(stored.payload);
      setState(stored.queued ? "queued" : "saved");
      setMessage(stored.queued ? "Draft queued for sync when the connection returns." : "Temporary draft restored for this browser session.");
      if (stored.queued && navigator.onLine) window.dispatchEvent(new Event(REVIEW_DRAFT_EVENT));
    });
    return () => { cancelled = true; };
  }, [staffId, caseId, serverVersion]);

  useEffect(() => {
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<ReviewSyncDetail>).detail;
      if (!detail || detail.staffId !== latest.current.staffId || detail.caseId !== latest.current.caseId) return;
      if (detail.state === "synced") {
        const accepted = latest.current.onSynced(detail.response ?? {}, detail.appliedPayload);
        if (accepted === false) {
          setState("conflict"); setMessage("An earlier draft synced, but newer local edits are retained. Compare with the current server record before saving again.");
          latest.current.onConflict();
        } else { setState("idle"); setMessage("Offline draft synced with its original server version."); }
      } else if (detail.state === "conflict") {
        setState("conflict"); setMessage(detail.message ?? "This review changed while offline. Compare your retained draft with the current server record.");
        latest.current.onConflict();
      } else { if (detail.state === "syncing") latest.current.onSyncStart?.(detail.appliedPayload); setState(detail.state === "unauthorized" ? "error" : detail.state); setMessage(detail.message ?? ""); }
    };
    window.addEventListener(REVIEW_SYNC_EVENT, onSync);
    return () => window.removeEventListener(REVIEW_SYNC_EVENT, onSync);
  }, []);

  const store = useCallback((payload: ReviewDraftPayload, queued: boolean) => {
    try {
      const current = latest.current;
      if (!current.caseId || payload.id !== current.caseId) throw new Error("Open the review before saving a draft.");
      const existing = readReviewDraft(sessionStorage, current.staffId, current.caseId);
      // A stale local payload may be viewed, but must never gain a new server version implicitly.
      if (existing?.conflict || payload.expected_revision !== current.serverVersion) {
        setState("conflict"); current.onConflict(); return false;
      }
      const shouldQueue = queued || existing?.queued === true;
      writeReviewDraft(sessionStorage, current.staffId, payload, shouldQueue);
      setState(shouldQueue ? "queued" : "saved");
      setMessage(shouldQueue ? "Save queued. It will sync after reconnecting if the server version is unchanged." : "Temporary review draft saved for this browser session.");
      if (shouldQueue) window.dispatchEvent(new Event(REVIEW_DRAFT_EVENT));
      return true;
    } catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "Temporary draft could not be stored."); return false; }
  }, []);
  const persist = useCallback((payload: ReviewDraftPayload) => store(payload, false), [store]);
  const queue = useCallback((payload: ReviewDraftPayload) => store(payload, true), [store]);
  const clear = useCallback(() => {
    const current = latest.current;
    if (current.caseId) sessionStorage.removeItem(reviewDraftKey(current.staffId, current.caseId));
    setState("idle"); setMessage("");
  }, []);
  const restore = useCallback(() => {
    const current = latest.current;
    if (!current.caseId) return;
    const stored = readReviewDraft(sessionStorage, current.staffId, current.caseId);
    if (stored) current.onRestore(stored.payload);
  }, []);
  const retry = useCallback(() => window.dispatchEvent(new Event(REVIEW_DRAFT_EVENT)), []);
  return { online, state, message, persist, queue, clear, restore, retry };
}
