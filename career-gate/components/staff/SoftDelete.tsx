"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction } from "@/components/forms/useAction";

/** Admin-only soft delete with a mandatory reason. Records are kept. */
export function SoftDelete({ clientId }: { clientId: string }) {
  const router = useRouter();
  const a = useAction({ successMessage: "Client soft-deleted" });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return <button type="button" className="text-sm text-red-700 hover:underline" onClick={() => setOpen(true)}>Delete client (admin)</button>;
  return (
    <form className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2" data-testid="form-soft-delete"
      onSubmit={async (e) => { e.preventDefault(); if (await a.run({ action: "soft_delete_client", client_id: clientId, reason })) router.push("/staff/clients"); }}>
      <label className="text-sm text-red-800" htmlFor="del_reason">Reason (required)</label>
      <input id="del_reason" required className="input w-64 py-1" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="rounded bg-red-600 px-3 py-1 text-sm text-white" disabled={a.pending}>Soft delete</button>
      <button type="button" className="text-sm text-slate-600" onClick={() => setOpen(false)}>Cancel</button>
      <p className="w-full text-xs text-red-800">The file and its documents are kept; it is hidden from everyone except admins.</p>
    </form>
  );
}
