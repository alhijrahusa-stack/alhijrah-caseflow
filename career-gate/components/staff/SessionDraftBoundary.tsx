"use client";

import { useEffect, useState } from "react";
import { useStaff } from "@/components/staff/StaffContext";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { publishMutation } from "@/components/staff/realtime/update-bus";
import { purgeReviewDrafts, REVIEW_DRAFT_EVENT, REVIEW_SYNC_EVENT, syncReviewDrafts } from "@/lib/review-offline-drafts";

export function SessionDraftBoundary() {
  const { me } = useStaff();
  const { t } = useStaffLanguage();
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    try { purgeReviewDrafts(sessionStorage, me.id); } catch { /* Storage can be unavailable in a restricted browser. */ }
    let signedOut = false;
    let disposed = false;
    const lifetime = new AbortController();
    let channel: BroadcastChannel | null = null;
    try { if (typeof BroadcastChannel !== "undefined") channel = new BroadcastChannel("career-gate:staff-session"); } catch { /* Some private browser policies disallow cross-tab channels. */ }
    const sync = () => {
      setOffline(!navigator.onLine);
      if (disposed || signedOut || !navigator.onLine) return;
      try {
        void syncReviewDrafts(sessionStorage, me.id, fetch, (detail) => {
          if (disposed || signedOut || lifetime.signal.aborted || detail.staffId !== me.id) return;
          if (detail.state === "synced") publishMutation("import_case", null);
          window.dispatchEvent(new CustomEvent(REVIEW_SYNC_EVENT, { detail }));
          if (detail.state === "unauthorized") clearSession();
        }, lifetime.signal).catch(() => { /* Review save surfaces temporary storage failures. */ });
      } catch { /* The review status reports storage failures at the save action. */ }
    };
    const clearSession = () => { signedOut = true; lifetime.abort(); try { purgeReviewDrafts(sessionStorage); } catch {} };
    const signOut = () => { clearSession(); channel?.postMessage("signed_out"); };
    if (channel) channel.onmessage = (event) => { if (event.data === "signed_out") clearSession(); };
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    window.addEventListener("focus", sync);
    window.addEventListener(REVIEW_DRAFT_EVENT, sync);
    window.addEventListener("career-gate:sign-out", signOut);
    sync();
    if ("serviceWorker" in navigator && window.isSecureContext && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/staff-sw.js", { scope: "/staff", updateViaCache: "none" }).catch(() => { /* Offline draft saving still works without installation. */ });
    }
    return () => {
      disposed = true; lifetime.abort(); channel?.close();
      window.removeEventListener("online", sync); window.removeEventListener("offline", sync); window.removeEventListener("focus", sync);
      window.removeEventListener(REVIEW_DRAFT_EVENT, sync); window.removeEventListener("career-gate:sign-out", signOut);
    };
  }, [me.id]);
  return offline ? <p role="status" className="royal-offline-status">◌ {t("Offline · loaded reviews remain editable. Save drafts to sync after reconnecting; approvals require a connection.", "غير متصل · يمكنك تعديل المراجعات المفتوحة وحفظ المسودات للمزامنة عند عودة الاتصال. الاعتماد يتطلب اتصالاً.")}</p> : null;
}
