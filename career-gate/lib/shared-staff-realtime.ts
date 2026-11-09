"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { createStaffRealtimeClient } from "@/lib/staff-realtime-client";
import type { ChangePayload } from "@/lib/realtime-resources";

type StatusCallback = NonNullable<Parameters<RealtimeChannel["subscribe"]>[0]>;
type Status = Parameters<StatusCallback>[0];
type DatabaseFilter = { event: "*"; schema: "public"; table: string; filter?: string };
type Bootstrap = { ok: true; staff_id: string; token: string; url: string; anon_key: string };
type Listener = { status?: StatusCallback; presence?: () => void; changes: Map<string, (payload: ChangePayload) => void> };
type Entry = { channel: RealtimeChannel; listeners: Set<Listener>; bindings: Set<string>; subscribed: boolean; status?: Status; timer?: ReturnType<typeof setTimeout> };
export type StaffRealtimeLease = {
  channel: RealtimeChannel;
  onPresence: (callback: () => void) => void;
  onDatabase: (filter: DatabaseFilter, callback: (payload: ChangePayload) => void) => void;
  subscribe: (callback: StatusCallback) => void;
  release: () => void;
};

/** One authenticated transport and bootstrap per StaffProvider, never across requests or identities. */
export function createSharedStaffRealtime(staffId: string, fetcher: typeof fetch = (...args) => fetch(...args)) {
  let connection: ReturnType<typeof createStaffRealtimeClient> | null = null;
  let bootstrap: Bootstrap | null = null;
  let freshUntil = 0;
  let inFlight: Promise<SupabaseClient> | null = null;
  let stopped = false;
  let generation = 0;
  let controller = new AbortController();
  let presenceKey: string | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const entries = new Map<string, Entry>();

  const key = () => presenceKey ??= crypto.randomUUID();
  async function connect(): Promise<SupabaseClient> {
    if (stopped) throw new Error("Staff realtime session has ended");
    if (connection && Date.now() < freshUntil) return connection.client;
    if (inFlight) return inFlight;
    const epoch = generation;
    const work = (async () => {
      const response = await fetcher("/api/staff/realtime-token", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
      const data = await response.json().catch(() => null);
      if (stopped || epoch !== generation) throw new Error("Staff realtime session has ended");
      if (!response.ok || !data?.ok || data.staff_id !== staffId || !data.token || !data.url || !data.anon_key) {
        throw Object.assign(new Error(data?.error?.message ?? "Realtime authentication unavailable"), { code: data?.error?.code ?? "unavailable" });
      }
      if (bootstrap && (bootstrap.url !== data.url || bootstrap.anon_key !== data.anon_key)) throw new Error("Realtime configuration changed. Reload the workspace");
      connection ??= createStaffRealtimeClient(data.url, data.anon_key, data.token);
      const connected = connection;
      if (bootstrap?.token !== data.token) await connected.setToken(data.token);
      if (stopped || epoch !== generation) throw new Error("Staff realtime session has ended");
      bootstrap = data as Bootstrap;
      freshUntil = Date.now() + 3 * 60_000;
      try {
        const payload = JSON.parse(atob(data.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (Number.isFinite(payload.exp)) freshUntil = Math.min(freshUntil, payload.exp * 1000 - 45_000);
      } catch { /* Cache duration remains bounded for non-JWT test transports. */ }
      if (refreshTimer) clearTimeout(refreshTimer);
      const renew = () => { refreshTimer = null; void connect().catch(() => { if (!stopped) refreshTimer = setTimeout(renew, 10_000); }); };
      refreshTimer = setTimeout(renew, Math.max(1_000, freshUntil - Date.now()));
      return connected.client;
    })();
    inFlight = work;
    try { return await work; } finally { if (inFlight === work) inFlight = null; }
  }

  function lease(topic: string, presence = false): StaffRealtimeLease {
    if (!connection || stopped) throw new Error("Connect the authenticated staff transport first");
    let entry = entries.get(topic);
    if (!entry) {
      const channel = connection.client.channel(topic, presence ? { config: { private: true, presence: { enabled: true, key: key() } } } : undefined);
      entry = { channel, listeners: new Set(), bindings: new Set(), subscribed: false };
      entries.set(topic, entry);
    }
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined; }
    const shared = entry;
    const listener: Listener = { changes: new Map() };
    shared.listeners.add(listener);
    let released = false;
    return {
      channel: shared.channel,
      onPresence(callback) {
        listener.presence = callback;
        if (shared.bindings.has("presence")) return;
        shared.bindings.add("presence");
        shared.channel.on("presence", { event: "sync" }, () => { for (const consumer of shared.listeners) consumer.presence?.(); });
      },
      onDatabase(filter, callback) {
        const binding = JSON.stringify(filter);
        listener.changes.set(binding, callback);
        if (shared.bindings.has(binding)) return;
        shared.bindings.add(binding);
        shared.channel.on("postgres_changes", filter, payload => {
          for (const consumer of shared.listeners) consumer.changes.get(binding)?.(payload as ChangePayload);
        });
      },
      subscribe(callback) {
        listener.status = callback;
        if (shared.status) callback(shared.status);
        if (shared.subscribed) return;
        shared.subscribed = true;
        shared.channel.subscribe((status, error) => {
          shared.status = status;
          for (const consumer of shared.listeners) consumer.status?.(status, error);
        });
      },
      release() {
        if (released) return;
        released = true;
        shared.listeners.delete(listener);
        if (shared.listeners.size || shared.timer) return;
        // Strict Mode and adjacent route mounts can reuse the channel before teardown.
        shared.timer = setTimeout(() => {
          shared.timer = undefined;
          if (shared.listeners.size || entries.get(topic) !== shared) return;
          entries.delete(topic);
          void connection?.client.removeChannel(shared.channel);
        }, 0);
      },
    };
  }

  function dispose() {
    stopped = true; generation++; controller.abort(); bootstrap = null; freshUntil = 0; inFlight = null;
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    for (const entry of entries.values()) if (entry.timer) clearTimeout(entry.timer);
    entries.clear();
    const old = connection; connection = null;
    if (old) void old.client.removeAllChannels();
  }
  function resume() { if (stopped) { stopped = false; controller = new AbortController(); } }
  return { connect, lease, dispose, resume, presenceKey: key };
}
