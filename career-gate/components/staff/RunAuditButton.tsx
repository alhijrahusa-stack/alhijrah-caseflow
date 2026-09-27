"use client";

import { useAction } from "@/components/forms/useAction";

export function RunAuditButton() {
  const { run, pending } = useAction({ successMessage: "Audit scan complete" });
  return (
    <button type="button" disabled={pending} onClick={() => run({ action: "run_audit_scan", client_id: null })} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
      {pending ? "Scanning…" : "Run audit scan"}
    </button>
  );
}
