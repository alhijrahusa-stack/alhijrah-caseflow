"use client";

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  parsePresencePacket, presenceWorkspaceSection, PRESENCE_HEARTBEAT_MS, PRESENCE_IDLE_MS, PRESENCE_MIN_PUBLISH_MS,
  safeStaffPresencePath, type StaffPresenceState,
} from "@/lib/presence-model";

/** Viewing presence only. It neither claims a file nor locks workflow actions. */
export function StaffPresence({ authUserId }: { authUserId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workspaceSection = presenceWorkspaceSection(pathname, new URLSearchParams(searchParams.toString()));
  const pathRef = useRef(pathname);
  const sectionRef = useRef(workspaceSection);
  const publishRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    pathRef.current = pathname;
    sectionRef.current = workspaceSection;
    publishRef.current();
  }, [pathname, workspaceSection]);

  useEffect(() => {
    let disposed = false;
    let supabase: SupabaseClient | null = null;
    let channel: RealtimeChannel | null = null;
    let connected = false;
    let initializing = false;
    let publishing = false;
    let publishAgain = false;
    let lastAttempt = 0;
    let lastActivity = Date.now();
    let lastState: StaffPresenceState = "active";
    let scheduled: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    const tabId = crypto.randomUUID();
    const stateNow = (): StaffPresenceState => document.visibilityState === "visible" && Date.now() - lastActivity < PRESENCE_IDLE_MS ? "active" : "idle";

    const publish = async () => {
      if (disposed) return;
      if (publishing) { publishAgain = true; return; }
      const path = safeStaffPresencePath(pathRef.current);
      if (!path) return;
      publishing = true;
      lastAttempt = Date.now();
      lastState = stateNow();
      try {
        const response = await fetch("/api/staff/presence", {
          method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, workspace_section: sectionRef.current, state: lastState, visible: document.visibilityState === "visible" }),
        });
        const data = await response.json().catch(() => null);
        if (disposed) return;
        if (response.status === 401 || response.status === 403) {
          connected = false;
          void channel?.untrack();
          return;
        }
        if (response.status === 400 || response.status === 404) { void channel?.untrack(); return; }
        // Publish the validated server route and timestamp, never a supplied identity.
        const packet = data?.ok ? parsePresencePacket({ ...data.presence, tab_id: tabId }) : null;
        if (packet && connected && packet.path === safeStaffPresencePath(pathRef.current)) await channel?.track(packet);
      } catch { /* Presence failure must not interrupt the employee's work. */ }
      finally {
        publishing = false;
        if (publishAgain && !disposed) { publishAgain = false; schedulePublish(); }
      }
    };
    const schedulePublish = () => {
      if (disposed || scheduled) return;
      const wait = Math.max(0, PRESENCE_MIN_PUBLISH_MS - (Date.now() - lastAttempt));
      scheduled = setTimeout(() => { scheduled = null; void publish(); }, wait);
    };
    publishRef.current = schedulePublish;

    const connect = async () => {
      if (disposed || initializing) return;
      initializing = true;
      try {
        const response = await fetch("/api/staff/realtime-token", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        const data = await response.json().catch(() => null);
        if (disposed || !data?.ok) return;
        if (!supabase) supabase = createClient(data.url, data.anon_key, { auth: { persistSession: false, autoRefreshToken: false } });
        await supabase.realtime.setAuth(data.token);
        if (disposed || channel) return;
        channel = supabase.channel(`team-presence:${authUserId}`, { config: { private: true, presence: { key: tabId } } });
        channel.subscribe(status => {
          if (disposed) return;
          connected = status === "SUBSCRIBED";
          if (connected) schedulePublish();
        });
      } catch { /* A later heartbeat or token refresh retries the connection. */ }
      finally { initializing = false; }
    };

    const onActivity = () => {
      lastActivity = Date.now();
      if (lastState === "idle" && document.visibilityState === "visible") schedulePublish();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") lastActivity = Date.now();
      schedulePublish();
    };
    const onOnline = () => { void connect(); schedulePublish(); };
    // Input only updates a local timestamp. No keystroke or pointer event is sent.
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("pointermove", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("focus", onActivity);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    const heartbeat = setInterval(() => { if (!channel) void connect(); schedulePublish(); }, PRESENCE_HEARTBEAT_MS);
    const idleTimer = setInterval(() => { if (stateNow() !== lastState) schedulePublish(); }, 15_000);
    // Browser session tokens may rotate independently of this long-lived shell.
    const tokenTimer = setInterval(() => { void connect(); }, 4 * 60_000);
    void connect();
    schedulePublish();

    return () => {
      disposed = true;
      controller.abort();
      publishRef.current = () => undefined;
      if (scheduled) clearTimeout(scheduled);
      clearInterval(heartbeat);
      clearInterval(idleTimer);
      clearInterval(tokenTimer);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("focus", onActivity);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      if (channel) { void channel.untrack(); void supabase?.removeChannel(channel); }
    };
  }, [authUserId]);

  return null;
}
