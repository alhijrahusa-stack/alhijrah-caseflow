"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction } from "@/components/forms/useAction";

/** Management-only recoverable archive action. Records and documents are retained. */
export function SoftDelete({ clientId, compact = false }: { clientId: string; compact?: boolean }) {
  const router = useRouter();
  const a = useAction({ successMessage: "Client moved to archive" });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!open) {
    return <button type="button" className={compact ? "archive-client-button" : "text-sm font-semibold text-red-300 hover:text-red-200"} onClick={() => setOpen(true)}>Archive</button>;
  }

  return (
    <form
      className="archive-delete-form"
      data-testid="form-soft-delete"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await a.run({ action: "soft_delete_client", client_id: clientId, reason })) router.push("/staff/clients");
      }}
    >
      <label className="text-xs font-semibold text-red-200" htmlFor={`del_reason_${clientId}`}>Archive reason</label>
      <input id={`del_reason_${clientId}`} required className="input min-w-56 py-1" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="archive-confirm-button" disabled={a.pending}>{a.pending ? "Archiving…" : "Confirm"}</button>
      <button type="button" className="text-xs text-slate-400 hover:text-slate-200" onClick={() => setOpen(false)}>Cancel</button>
      <p className="w-full text-xs text-slate-500">Recoverable: the client, documents, and audit history remain retained.</p>
    </form>
  );
}
