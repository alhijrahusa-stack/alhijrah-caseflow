"use client";

import { type RealtimeChannel } from "@supabase/supabase-js";
import { useStaff } from "@/components/staff/StaffContext";
import type { StaffRealtimeLease } from "@/lib/shared-staff-realtime";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  parsePresencePacket, presenceWorkspaceSection, PRESENCE_HEARTBEAT_MS, PRESENCE_IDLE_MS, PRESENCE_MIN_PUBLISH_MS,
  safeStaffPresencePath, type StaffPresenceState,
} from "@/lib/presence-model";

/** Viewing presence only. It neither claims a file nor locks workflow actions. */
export function StaffPresence({ authUserId }: { authUserId: string }) {
  const { realtime } = useStaff();
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
    let channel: RealtimeChannel | null = null;
    let lease: StaffRealtimeLease | null = null;
    let connected = false;
    let initializing = false;
    let publishing = false;
    let publishAgain = false;
    let lastAttempt = 0;
    let lastActivity = Date.now();
    let lastState: StaffPresenceState = "active";
    let scheduled: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    const tabId = realtime.presenceKey();
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
        await realtime.connect();
        if (disposed || channel) return;
        lease = realtime.lease(`team-presence:${authUserId}`, true);
        channel = lease.channel;
        lease.subscribe(status => {

          if (disposed) return;
          connected = status === "SUBSCRIBED";
          if (status === "CLOSED") { channel = null; lease?.release(); lease = null; }
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
      if (channel) void channel.untrack();
      lease?.release();
    };
  }, [authUserId, realtime]);

  return null;
}
