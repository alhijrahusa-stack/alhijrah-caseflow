"use client";

import { useState } from "react";

type Probe = { model: string | null; status: "AVAILABLE" | "UNAVAILABLE" | "NOT_CONFIGURED"; reason?: string; http?: number };
type State = { fast: Probe; escalation: Probe } | null;

/** Admin-triggered real generation test. No applicant data or API secrets enter the browser. */
export function GeminiLiveCheck() {
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<State>(null);
  const [error, setError] = useState<string | null>(null);
  async function check() {
    if (checking) return;
    setChecking(true);
    setError(null);
    setResults(null);
    try {
      const response = await fetch("/api/staff/providers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "gemini_probe" }),
      });
      if (!response.ok) throw new Error(`Provider check failed (HTTP ${response.status}).`);
      const data = await response.json() as { gemini?: State };
      if (!data.gemini?.fast || !data.gemini.escalation) throw new Error("Provider check returned an invalid response.");
      setResults(data.gemini);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Provider check failed.");
    } finally {
      setChecking(false);
    }
  }
  return <div className="mt-4 space-y-3" data-testid="gemini-live-check">
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="ops-primary-button" disabled={checking} onClick={check}>
        {checking ? "Checking Gemini…" : "Test actual Gemini API connection"}
      </button>
      <p className="text-xs text-slate-400">Sends two minimal test requests to Google. No client documents are sent.</p>
    </div>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {results && <div role="status" className="grid gap-2 sm:grid-cols-2">
      {(["fast", "escalation"] as const).map((key) => {
        const result = results[key];
        return <div key={key} className="rounded-xl border border-white/10 p-3">
          <p className="text-xs font-semibold uppercase text-slate-400">{key === "fast" ? "Gemini Fast" : "Gemini Escalation"}</p>
          <p className="mt-1 text-sm text-slate-200">{result.model ?? "Model not set"}</p>
          <p className={`mt-1 font-semibold ${result.status === "AVAILABLE" ? "text-emerald-300" : "text-amber-300"}`}>{result.status === "AVAILABLE" ? "LIVE GENERATION VERIFIED" : result.status}</p>
          {result.reason && <p className="text-xs text-slate-400">{result.reason}{result.http ? ` (HTTP ${result.http})` : ""}</p>}
        </div>;
      })}
    </div>}
  </div>;
}
