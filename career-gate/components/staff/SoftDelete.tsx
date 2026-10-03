"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Management-only recoverable archive action. Records and documents are retained. */
export function SoftDelete({ clientId, compact = false }: { clientId: string; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return <button type="button" className={compact ? "archive-client-button" : "text-sm font-semibold text-red-300 hover:text-red-200"} onClick={() => setOpen(true)}>Archive</button>;
  }

  async function archive() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/staff/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "archive", client_id: clientId, reason }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error?.message ?? "Archive failed");
      router.push("/staff/clients");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Archive failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="archive-delete-form" data-testid="form-soft-delete" onSubmit={(e) => { e.preventDefault(); void archive(); }}>
      <label className="text-xs font-semibold text-red-200" htmlFor={`del_reason_${clientId}`}>Archive reason</label>
      <input id={`del_reason_${clientId}`} required className="input min-w-56 py-1" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="archive-confirm-button" disabled={pending}>{pending ? "Archiving…" : "Confirm"}</button>
      <button type="button" className="text-xs text-slate-400 hover:text-slate-200" onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
      {error && <p className="w-full text-xs text-red-300" role="alert">{error}</p>}
      <p className="w-full text-xs text-slate-500">Recoverable: the client, documents, and audit history remain retained.</p>
    </form>
  );
}
