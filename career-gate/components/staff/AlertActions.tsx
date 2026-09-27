"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";

/** Resolve / Ignore via POST /api/audit/alerts/[id]. Ignore requires a reason. */
export function AlertActions({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<"resolve" | "ignore" | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const submit = async () => {
    setPending(true);
    const res = await fetch(`/api/audit/alerts/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mode === "ignore" ? { action: "ignore", reason: text } : { action: "resolve", note: text || undefined }),
    });
    const data = await res.json().catch(() => null);
    setPending(false);
    if (!data?.ok) return toast("error", data?.error?.message ?? "Could not update alert");
    toast("success", mode === "ignore" ? "Alert ignored" : "Alert resolved");
    setMode(null);
    router.refresh();
  };
  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-xs" onClick={() => { setMode("resolve"); setText(""); }}>Resolve</button>
        <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-xs" onClick={() => { setMode("ignore"); setText(""); }}>Ignore</button>
      </div>
      {mode && (
        <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <input aria-label={mode === "ignore" ? "Ignore reason" : "Resolution note"} required={mode === "ignore"} className="input py-1 text-xs"
            placeholder={mode === "ignore" ? "Reason (required)" : "Note (optional)"} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="rounded bg-brand-600 px-2 text-xs text-white" disabled={pending}>Save</button>
        </form>
      )}
    </div>
  );
}
