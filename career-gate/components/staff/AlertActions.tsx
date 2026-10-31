"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { publishMutation } from "@/components/staff/realtime/update-bus";
import { useToast } from "@/components/ui/Toast";

/** Resolve / Ignore via POST /api/audit/alerts/[id]. Ignore requires a reason. */
export function AlertActions({ id, clientId = null }: { id: string; clientId?: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<"resolve" | "ignore" | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const submit = async () => {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch(`/api/audit/alerts/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mode === "ignore" ? { action: "ignore", reason: text } : { action: "resolve", note: text || undefined }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) return toast("error", data?.error?.message ?? "Could not update alert");
    toast("success", mode === "ignore" ? "Alert ignored" : "Alert resolved");
    setMode(null);
    if (publishMutation(mode === "ignore" ? "ignore_alert" : "resolve_alert", clientId) !== null) startTransition(() => router.refresh());
    } catch {
      toast("error", "Could not confirm the update. Refresh the alert list before retrying.");
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        <button type="button" disabled={pending} className="rounded border border-slate-300 px-2 py-0.5 text-xs" onClick={() => { setMode("resolve"); setText(""); }}>Resolve</button>
        <button type="button" disabled={pending} className="rounded border border-slate-300 px-2 py-0.5 text-xs" onClick={() => { setMode("ignore"); setText(""); }}>Ignore</button>
      </div>
      {mode && (
        <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <input aria-label={mode === "ignore" ? "Ignore reason" : "Resolution note"} required={mode === "ignore"} disabled={pending} className="input py-1 text-xs"
            placeholder={mode === "ignore" ? "Reason (required)" : "Note (optional)"} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="rounded bg-brand-600 px-2 text-xs text-white" disabled={pending}>Save</button>
        </form>
      )}
    </div>
  );
}
