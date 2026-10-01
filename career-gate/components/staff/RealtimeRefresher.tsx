"use client";

import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";

const DASHBOARD_TABLES = [
  "clients",
  "client_preferences",
  "appointments",
  "tasks",
  "followups",
  "documents",
] as const;

const CLIENT_TABLES = [
  "clients",
  "client_preferences",
  "client_accounts",
  "appointments",
  "tasks",
  "followups",
  "notes",
  "documents",
  "audit_alerts",
] as const;

const REFRESH_DEBOUNCE_MS = 1500;
type RealtimeState = "connecting" | "live" | "NOT_CONFIGURED" | "offline";

function publishRealtimeState(state: RealtimeState) {
  window.dispatchEvent(new CustomEvent("career-gate:realtime-state", { detail: { state } }));
}

export function RealtimeRefresher({ clientId }: { clientId?: string }) {
  const router = useRouter();
  const [state, setState] = useState<RealtimeState>("connecting");

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let refreshPending = false;

    const updateState = (next: RealtimeState) => {
      if (cancelled) return;
      setState(next);
      publishRealtimeState(next);
    };

    publishRealtimeState("connecting");

    const performRefresh = () => {
      if (cancelled) return;
      refreshPending = false;
      startTransition(() => { router.refresh(); });
    };

    const scheduleRefresh = () => {
      if (cancelled) return;
      refreshPending = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (document.visibilityState === "hidden") return;
      timer = setTimeout(() => {
        timer = null;
        if (document.visibilityState === "hidden") return;
        performRefresh();
      }, REFRESH_DEBOUNCE_MS);
    };

    const handleVisibilityChange = () => {
      if (cancelled || document.visibilityState !== "visible" || !refreshPending) return;
      if (timer) { clearTimeout(timer); timer = null; }
      performRefresh();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    (async () => {
      const res = await fetch("/api/staff/realtime-token").catch(() => null);
      const data = await res?.json().catch(() => null);
      if (cancelled) return;
      if (!data?.ok) {
        updateState(data?.error?.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "offline");
        return;
      }

      const supabase = createClient(data.url, data.anon_key, { auth: { persistSession: false, autoRefreshToken: false } });
      await supabase.realtime.setAuth(data.token);
      channel = supabase.channel(`staff-${clientId ?? "operations"}`);
      const tables = clientId ? CLIENT_TABLES : DASHBOARD_TABLES;

      for (const table of tables) {
        const filter = clientId ? table === "clients" ? `id=eq.${clientId}` : `client_id=eq.${clientId}` : undefined;
        channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, scheduleRefresh);
      }

      channel.subscribe((status) => {
        updateState(status === "SUBSCRIBED" ? "live" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED" ? "offline" : "connecting");
      });
    })();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timer) clearTimeout(timer);
      channel?.unsubscribe();
    };
  }, [clientId, router]);

  return (
    <span className="text-xs text-slate-400" data-testid="realtime-state" title="Live updates">
      {state === "live" ? "● Live" : state === "NOT_CONFIGURED" ? "Live updates NOT_CONFIGURED" : state === "offline" ? "Live updates offline" : "Connecting…"}
    </span>
  );
}
