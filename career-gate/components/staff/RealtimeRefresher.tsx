"use client";

import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
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
  const [state, setState] = useState<RealtimeState>("connecting");
  // Why the fallback last ran, or null while every update stayed targeted.
  const [recovery, setRecovery] = useState<RecoveryReason | null>(null);

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
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
      const res = await fetch("/api/staff/realtime-token", { signal: controller.signal }).catch(() => null);
      const data = await res?.json().catch(() => null);
      if (cancelled) return;
      if (!data?.ok) {
        updateState(data?.error?.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "offline");
        return;
      }

      const supabase = createClient(data.url, data.anon_key, { auth: { persistSession: false, autoRefreshToken: false } });
      disposeRealtime = () => { void supabase.removeAllChannels(); };
      await supabase.realtime.setAuth(data.token);
      if (cancelled) return;
      channel = supabase.channel(`staff-${clientId ?? "operations"}`);
      const tables = clientId ? CLIENT_REALTIME_ENTITIES : DASHBOARD_REALTIME_ENTITIES;

      for (const table of tables) {
        const filter = clientId ? (table === "clients" ? `id=eq.${clientId}` : `client_id=eq.${clientId}`) : undefined;
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
          (payload) => {
            if (cancelled) return;
            // Targeted path. A reason back means granularity was unavailable.
            const reason = publishPayload(payload as ChangePayload);
            if (reason) scheduleRecovery(reason);
          },
        );
      }

      channel.subscribe((status) => {
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
    })().catch(() => updateState("offline"));

    return () => {
      cancelled = true;
      controller.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener(RECOVERY_EVENT, handleRecoveryRequest);
      if (timer) clearTimeout(timer);
      disposeRealtime?.();
    };
  }, [clientId, router]);

  return (
    <span className="text-xs text-slate-400" data-testid="realtime-state" data-recovery={recovery ?? ""} title="Live updates">
      {state === "live" ? "● Live" : state === "NOT_CONFIGURED" ? "Live updates NOT_CONFIGURED" : state === "offline" ? "Live updates offline" : "Connecting…"}
    </span>
  );
}
