"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type HealthState = "unknown" | "healthy" | "degraded" | "unavailable";
type RealtimeState = "unknown" | "connecting" | "live" | "offline" | "NOT_CONFIGURED";
type HealthPayload = { ok?: boolean; status?: "HEALTHY" | "DEGRADED" | "UNAVAILABLE"; dbMs?: number };
type IdleWindow = typeof window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

const SAMPLE_MS = 60_000;
const TIMEOUT_MS = 4_000;

export function ExecutiveTelemetry() {
  const pathname = usePathname();
  const [health, setHealth] = useState<HealthState>("unknown");
  const [dbMs, setDbMs] = useState<number | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [realtime, setRealtime] = useState<RealtimeState>("unknown");
  const navigationStarted = useRef<number | null>(null);

  const sample = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch("/api/health/ui", {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as HealthPayload | null;
      if (!response.ok || !body?.ok) {
        setHealth("unavailable");
        setDbMs(null);
        return;
      }
      setDbMs(typeof body.dbMs === "number" ? body.dbMs : null);
      setHealth(body.status === "DEGRADED" ? "degraded" : body.status === "HEALTHY" ? "healthy" : "unknown");
    } catch {
      setDbMs(null);
      setHealth("unavailable");
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    const idle = window as IdleWindow;
    let timer: number | null = null;
    let idleId: number | null = null;
    const start = () => void sample();
    if (idle.requestIdleCallback) idleId = idle.requestIdleCallback(start, { timeout: 2500 });
    else timer = window.setTimeout(start, 1800);
    const interval = window.setInterval(() => void sample(), SAMPLE_MS);
    const onVisibility = () => { if (document.visibilityState === "visible" && health === "unavailable") void sample(); };
    const onRealtime = (event: Event) => {
      const detail = (event as CustomEvent<{ state?: RealtimeState }>).detail;
      if (detail?.state) setRealtime(detail.state);
    };
    const onNavigationStart = (event: Event) => {
      const at = (event as CustomEvent<{ at?: number }>).detail?.at;
      navigationStarted.current = typeof at === "number" ? at : performance.now();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("career-gate:realtime-state", onRealtime as EventListener);
    window.addEventListener("career-gate:navigation-start", onNavigationStart as EventListener);
    return () => {
      if (timer != null) window.clearTimeout(timer);
      if (idleId != null) idle.cancelIdleCallback?.(idleId);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("career-gate:realtime-state", onRealtime as EventListener);
      window.removeEventListener("career-gate:navigation-start", onNavigationStart as EventListener);
    };
  }, [sample, health]);

  useEffect(() => {
    if (navigationStarted.current == null) return;
    setLatency(Math.max(0, Math.round(performance.now() - navigationStarted.current)));
    navigationStarted.current = null;
  }, [pathname]);

  const healthLabel = health === "healthy" ? "SYSTEM" : health === "degraded" ? "DEGRADED" : health === "unavailable" ? "UNAVAILABLE" : "SYSTEM";
  const realtimeLabel = realtime === "live" ? "LIVE" : realtime === "connecting" ? "CONNECTING" : realtime === "offline" ? "OFFLINE" : realtime === "NOT_CONFIGURED" ? "NOT CONFIGURED" : "REALTIME";
  const realtimeTone = realtime === "NOT_CONFIGURED" ? "unknown" : realtime;

  return (
    <div className="cg-telemetry" aria-label="Application runtime status">
      <span className="cg-telemetry-item" data-state={health} title={`System health: ${health}${dbMs == null ? "" : ` · DB ${dbMs} ms`}`}>
        <span className="cg-telemetry-dot" aria-hidden="true" />
        <span>{healthLabel}</span>
      </span>
      <span className="cg-telemetry-separator" aria-hidden="true" />
      <span className="cg-telemetry-item" data-state={realtimeTone} title={`Realtime: ${realtime}`}>
        <span className="cg-telemetry-dot" aria-hidden="true" />
        <span>{realtimeLabel}</span>
      </span>
      <span className="cg-telemetry-separator" aria-hidden="true" />
      <span className="cg-telemetry-item" data-state={latency == null ? "unknown" : latency > 1200 ? "degraded" : "healthy"} title="Last staff-route navigation latency">
        <span>NAV {latency == null ? "—" : `${latency} ms`}</span>
      </span>
    </div>
  );
}
