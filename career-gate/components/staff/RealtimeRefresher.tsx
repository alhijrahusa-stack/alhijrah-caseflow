"use client";

import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const TABLES = [
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

export type CareerGateRealtimeDetail = {
  table: (typeof TABLES)[number];
  clientId: string | null;
  eventType: string;
};

export function RealtimeRefresher({ clientId }: { clientId?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"connecting" | "live" | "NOT_CONFIGURED" | "error">("connecting");

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let subscribedOnce = false;

    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    };

    const dispatchChange = (detail: CareerGateRealtimeDetail) => {
      const event = new CustomEvent<CareerGateRealtimeDetail>("career-gate:realtime", {
        detail,
        cancelable: true,
      });
      const unhandled = window.dispatchEvent(event);
      if (unhandled) refresh();
    };

    const dispatchReconnect = () => {
      const event = new CustomEvent("career-gate:realtime-reconnect", { cancelable: true });
      const unhandled = window.dispatchEvent(event);
      if (unhandled) refresh();
    };

    (async () => {
      const res = await fetch("/api/staff/realtime-token").catch(() => null);
      const data = await res?.json().catch(() => null);
      if (cancelled) return;
      if (!data?.ok) {
        setState(data?.error?.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "error");
        return;
      }
      const supabase = createClient(data.url, data.anon_key, { auth: { persistSession: false, autoRefreshToken: false } });
      await supabase.realtime.setAuth(data.token);
      if (cancelled) return;
      channel = supabase.channel(`staff-${clientId ?? "all"}`);
      for (const table of TABLES) {
        const filter = clientId ? (table === "clients" ? `id=eq.${clientId}` : `client_id=eq.${clientId}`) : undefined;
        channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, (payload) => {
          const rawRow = payload.new && Object.keys(payload.new).length > 0 ? payload.new : payload.old;
          const row = rawRow as Record<string, unknown>;
          const affectedClient = table === "clients" ? row.id : row.client_id;
          dispatchChange({
            table,
            clientId: typeof affectedClient === "string" ? affectedClient : null,
            eventType: payload.eventType,
          });
        });
      }
      channel.subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          setState("live");
          if (subscribedOnce) dispatchReconnect();
          subscribedOnce = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setState("error");
        } else {
          setState("connecting");
        }
      });
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (channel) void channel.unsubscribe();
    };
  }, [clientId, router]);

  return (
    <span className="text-xs text-slate-400" data-testid="realtime-state" title="Live updates">
      {state === "live" ? "● Live" : state === "NOT_CONFIGURED" ? "Live updates NOT_CONFIGURED" : state === "error" ? "Live updates unavailable" : "Connecting…"}
    </span>
  );
}
