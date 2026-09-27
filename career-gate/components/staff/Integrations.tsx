"use client";

import { useEffect, useState } from "react";

type States = Record<string, string>;
type Model = { model: string | null; status: string; http?: number | null };

/** Admin view of provider configuration and a live model-availability check. */
export function Integrations() {
  const [states, setStates] = useState<States | null>(null);
  const [models, setModels] = useState<Record<string, Model> | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    fetch("/api/staff/providers").then((r) => r.json()).then((d) => d?.ok && setStates(d.states));
  }, []);
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4" data-testid="integrations">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Integrations</h2>
        <button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm" disabled={checking} onClick={async () => {
          setChecking(true);
          const d = await (await fetch("/api/staff/providers?live=1")).json().catch(() => null);
          setChecking(false);
          if (d?.ok) setModels(d.models);
        }}>{checking ? "Checking…" : "Check model availability"}</button>
      </div>
      {states && (
        <table className="table">
          <tbody>
            {Object.entries(states).map(([k, v]) => (
              <tr key={k}><td>{k.replace(/_/g, " ")}</td><td className={v === "CONFIGURED" ? "text-green-700" : "text-slate-500"} data-testid={`provider-${k}`}>{v}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {models && (
        <table className="table">
          <thead><tr><th>Use</th><th>Model</th><th>Status</th></tr></thead>
          <tbody>
            {Object.entries(models).map(([k, m]) => <tr key={k}><td>{k.replace(/_/g, " ")}</td><td>{m.model ?? "—"}</td><td>{m.status}{m.http ? ` (HTTP ${m.http})` : ""}</td></tr>)}
          </tbody>
        </table>
      )}
      <p className="text-xs text-slate-500">CONFIGURED means credentials are present. Only the live check confirms that a model exists for these credentials.</p>
    </section>
  );
}
