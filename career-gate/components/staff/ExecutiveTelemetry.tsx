"use client";

import { useCallback, useEffect, useState } from "react";

type HealthState = "unknown" | "healthy" | "degraded" | "unavailable";
type RealtimeState = "unknown" | "connecting" | "live" | "offline" | "NOT_CONFIGURED";

type HealthPayload = { ok?: boolean; status?: "HEALTHY" | "DEGRADED" | "UNAVAILABLE"; dbMs?: number };

const SAMPLE_MS = 30_000;
const TIMEOUT_MS = 6_000;

export function ExecutiveTelemetry() {
  const [health, setHealth] = useState<HealthState>("unknown");
  const [latency, setLatency] = useState<number | null>(null);
  const [realtime, setRealtime] = useState<RealtimeState>("unknown");

  const sample = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
    const started = performance.now();
    try {
      const response = await fetch("/api/health/ui", {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      const elapsed = Math.round(performance.now() - started);
      setLatency(elapsed);
      const body = (await response.json().catch(() => null)) as HealthPayload | null;
      if (!response.ok || !body?.ok) {
        setHealth("unavailable");
        return;
      }
      setHealth(body.status === "DEGRADED" ? "degraded" : body.status === "HEALTHY" ? "healthy" : "unknown");
    } catch {
      setLatency(null);
      setHealth("unavailable");
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    void sample();
    const interval = window.setInterval(() => void sample(), SAMPLE_MS);
    const onVisibility = () => { if (document.visibilityState === "visible") void sample(); };
    const onRealtime = (event: Event) => {
      const detail = (event as CustomEvent<{ state?: RealtimeState }>).detail;
      if (detail?.state) setRealtime(detail.state);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("career-gate:realtime-state", onRealtime as EventListener);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("career-gate:realtime-state", onRealtime as EventListener);
    };
  }, [sample]);

  const healthLabel = health === "healthy" ? "SYSTEM" : health === "degraded" ? "DEGRADED" : health === "unavailable" ? "UNAVAILABLE" : "SYSTEM";
  const realtimeLabel = realtime === "live" ? "LIVE" : realtime === "connecting" ? "CONNECTING" : realtime === "offline" ? "OFFLINE" : realtime === "NOT_CONFIGURED" ? "NOT CONFIGURED" : "REALTIME";
  const realtimeTone = realtime === "NOT_CONFIGURED" ? "unknown" : realtime;

  return (
    <div className="cg-telemetry" aria-label="Application runtime status">
      <span className="cg-telemetry-item" data-state={health} title={`System health: ${health}`}>
        <span className="cg-telemetry-dot" aria-hidden="true" />
        <span>{healthLabel}</span>
      </span>
      <span className="cg-telemetry-separator" aria-hidden="true" />
      <span className="cg-telemetry-item" data-state={realtimeTone} title={`Realtime: ${realtime}`}>
        <span className="cg-telemetry-dot" aria-hidden="true" />
        <span>{realtimeLabel}</span>
      </span>
      <span className="cg-telemetry-separator" aria-hidden="true" />
      <span className="cg-telemetry-item" data-state={latency == null ? "unknown" : latency > 1500 ? "degraded" : "healthy"} title="Client-observed application round trip">
        <span>APP {latency == null ? "—" : `${latency} ms`}</span>
      </span>
    </div>
  );
}
