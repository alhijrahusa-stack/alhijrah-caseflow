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
];

export function RealtimeRefresher({ clientId }: { clientId?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"connecting" | "live" | "NOT_CONFIGURED" | "error">("connecting");

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 300);
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
      channel = supabase.channel(`staff-${clientId ?? "all"}`);
      for (const table of TABLES) {
        const filter = clientId ? (table === "clients" ? `id=eq.${clientId}` : `client_id=eq.${clientId}`) : undefined;
        channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, refresh);
      }
      channel.subscribe((status) => setState(status === "SUBSCRIBED" ? "live" : status === "CHANNEL_ERROR" ? "error" : "connecting"));
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      channel?.unsubscribe();
    };
  }, [clientId, router]);

  return (
    <span className="text-xs text-slate-400" data-testid="realtime-state" title="Live updates">
      {state === "live" ? "● Live" : state === "NOT_CONFIGURED" ? "Live updates NOT_CONFIGURED" : state === "error" ? "Live updates unavailable" : "Connecting…"}
    </span>
  );
}
