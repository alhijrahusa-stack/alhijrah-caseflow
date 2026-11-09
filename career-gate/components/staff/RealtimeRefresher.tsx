"use client";

import { type RealtimeChannel } from "@supabase/supabase-js";
import { useStaff } from "@/components/staff/StaffContext";
import type { StaffRealtimeLease } from "@/lib/shared-staff-realtime";
import { usePathname, useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";
import { publishPayload, RECOVERY_EVENT, requestRecovery, type RecoveryReason } from "@/components/staff/realtime/update-bus";
import { CLIENT_REALTIME_ENTITIES, DASHBOARD_REALTIME_ENTITIES, type ChangePayload } from "@/lib/realtime-resources";

/**
 * Staff realtime listener.
 *
 * The normal update path is targeted: every row change is resolved through the
 * EVENT -> ENTITY -> CLIENT_ID -> AFFECTED RESOURCE graph and delivered to the
 * surfaces that render those resources, which refetch only their own payloads.
 *
 * `router.refresh()` is the recovery fallback and nothing else. It runs only
 * when granularity was unavailable: an unmapped entity, a change no mounted
 * surface owns, a failed targeted refetch, or a resubscribe after the channel
 * dropped, where events may have been missed while offline.
 */

/** Debounce for the recovery refresh only; the targeted path is not debounced here. */
const RECOVERY_DEBOUNCE_MS = 1500;

type RealtimeState = "connecting" | "live" | "NOT_CONFIGURED" | "offline";

function publishRealtimeState(state: RealtimeState) {
  window.dispatchEvent(new CustomEvent("career-gate:realtime-state", { detail: { state } }));
}

export function RealtimeRefresher({ clientId }: { clientId?: string }) {
  const router = useRouter();
  const { realtime } = useStaff();
  const pathname = usePathname();
  const workspacePath = useRef(pathname);
  useEffect(() => { workspacePath.current = pathname; }, [pathname]);
  const [state, setState] = useState<RealtimeState>("connecting");
  // Why the fallback last ran, or null while every update stayed targeted.
  const [recovery, setRecovery] = useState<RecoveryReason | null>(null);

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let lease: StaffRealtimeLease | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tokenTimer: ReturnType<typeof setInterval> | null = null;
    const controller = new AbortController();
    let disposeRealtime: (() => void) | null = null;
    let recoveryPending = false;
    let wasOffline = false;

    const updateState = (next: RealtimeState) => {
      if (cancelled) return;
      setState(next);
      publishRealtimeState(next);
    };

    const performRecovery = () => {
      if (cancelled) return;
      recoveryPending = false;
      startTransition(() => { router.refresh(); });
    };

    /** Fallback path. Reached only when a targeted update was not possible. */
    const scheduleRecovery = (reason: RecoveryReason) => {
      if (cancelled) return;
      setRecovery(reason);
      recoveryPending = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (document.visibilityState === "hidden") return;
      timer = setTimeout(() => {
        timer = null;
        if (document.visibilityState === "hidden") return;
        performRecovery();
      }, RECOVERY_DEBOUNCE_MS);
    };

    const handleVisibilityChange = () => {
      if (cancelled || document.visibilityState !== "visible" || !recoveryPending) return;
      if (timer) { clearTimeout(timer); timer = null; }
      performRecovery();
    };

    const handleRecoveryRequest = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: RecoveryReason }>).detail?.reason;
      scheduleRecovery(reason ?? "unowned_resource");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener(RECOVERY_EVENT, handleRecoveryRequest);

    publishRealtimeState("connecting");

    (async () => {
      await realtime.connect();
      if (cancelled) return;
      disposeRealtime = () => lease?.release();
      tokenTimer = setInterval(() => {
        void realtime.connect().then(() => {
          if (!cancelled && channel?.state === "joined") updateState("live");
        }).catch(() => { if (!cancelled) updateState("offline"); });
      }, 4 * 60_000);
      lease = realtime.lease(`staff-${clientId ?? "operations"}`);
      channel = lease.channel;
      const tables = clientId ? CLIENT_REALTIME_ENTITIES : DASHBOARD_REALTIME_ENTITIES;

      for (const table of tables) {
        const filter = clientId ? (table === "clients" ? `id=eq.${clientId}` : `client_id=eq.${clientId}`) : undefined;
        lease.onDatabase(
          { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
          (payload) => {
            if (cancelled) return;
            // These new tables only feed the worksite desk or client history.
            // Other queues already receive the original client's update; they
            // must not refresh an entire route for each email delivery status.
            if (!clientId && (payload.table === "notifications" || payload.table === "worksite_changes")
              && workspacePath.current !== "/staff/worksite-changes") return;
            // Targeted path. A reason back means granularity was unavailable.
            const reason = publishPayload(payload as ChangePayload);
            if (reason) scheduleRecovery(reason);
          },
        );
      }

      lease.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // Events during the gap were never delivered to any surface, so the
          // only correct recovery is a full refresh.
          if (wasOffline) {
            wasOffline = false;
            requestRecovery("subscription_recovered");
          }
          updateState("live");
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          wasOffline = true;
          updateState("offline");
          return;
        }
        updateState("connecting");
      });
    })().catch((error: unknown) => updateState(error && typeof error === "object" && "code" in error && error.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "offline"));

    return () => {
      cancelled = true;
      controller.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener(RECOVERY_EVENT, handleRecoveryRequest);
      if (timer) clearTimeout(timer);
      if (tokenTimer) clearInterval(tokenTimer);
      disposeRealtime?.();
    };
  }, [clientId, router, realtime]);

  return (
    <span className="text-xs text-slate-400" data-testid="realtime-state" data-state={state} data-recovery={recovery ?? ""} title="Live updates">
      {state === "live" ? "● Live" : state === "NOT_CONFIGURED" ? "Live updates NOT_CONFIGURED" : state === "offline" ? "Live updates offline" : "Connecting…"}
    </span>
  );
}
