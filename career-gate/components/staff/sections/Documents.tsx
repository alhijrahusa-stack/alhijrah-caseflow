"use client";

import { useState } from "react";
import { useStaff } from "@/components/staff/StaffContext";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { DOC_LABELS, DOC_STATUS_LABELS, type DocStatus } from "@/lib/domain";
import { dateTime } from "@/lib/format";
import { Card, SmallBtn, useRowAction, type Row } from "./common";

const STATUS_TONE: Record<DocStatus, string> = {
  pending: "bg-slate-100 text-slate-700",
  processing: "bg-sky-100 text-sky-800",
  needs_reupload: "bg-amber-100 text-amber-900",
  needs_review: "bg-amber-100 text-amber-900",
  verified: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};
const RECON_TONE: Record<string, string> = { MATCH: "text-green-700", FORMAT_VARIANCE: "text-amber-700", MISMATCH: "text-red-700", UNVERIFIED: "text-slate-500" };

function Trust({ ex }: { ex: Row | undefined }) {
  if (!ex) {
    return <p className="text-xs text-slate-500" data-testid="extraction-state">Automated extraction: PENDING</p>;
  }
  if (ex.status === "not_configured") {
    return <p className="text-xs text-slate-500" data-testid="extraction-state">Automated extraction: NOT_CONFIGURED (no document vision provider). Human review required.</p>;
  }
  const fields = (ex.fields ?? []) as Row[];
  const recon = (ex.reconciliation ?? []) as Row[];
  return (
    <div className="space-y-1 text-xs" data-testid="extraction-state">
      <p className="text-slate-600">
        <strong>What:</strong> {fields.length} field(s) extracted · <strong>Source:</strong> uploaded document · <strong>Method:</strong> {ex.provider} {ex.model ?? ""}{ex.escalated ? " (escalated)" : ""} ·{" "}
        <strong>Status:</strong> {ex.status} · <strong>When:</strong> {dateTime(ex.created_at)} · <strong>Human reviewed:</strong> see review below
      </p>
      {ex.error && <p className="text-red-700">Error: {ex.error}</p>}
      {fields.length > 0 && (
        <table className="w-full text-left">
          <thead><tr className="text-slate-500"><th className="py-0.5">Field</th><th>Printed</th><th>Normalized</th><th>Page</th></tr></thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={i}><td className="py-0.5">{f.field_name}</td><td>{f.legible ? f.raw_value ?? "—" : "illegible"}</td><td>{f.normalized_value ?? "—"}</td><td>{f.source_page ?? "—"}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {recon.length > 0 && (
        <p>
          Reconciliation with client record:{" "}
          {recon.map((r, i) => (
            <span key={i} className={`mr-2 font-medium ${RECON_TONE[r.state]}`} data-testid="recon-state">{r.field}: {r.state}{r.similarity !== undefined ? ` (${r.similarity})` : ""}</span>
          ))}
        </p>
      )}
    </div>
  );
}

export function Documents({ docs, extractions, onAdd }: { docs: Row[]; extractions: Row[]; onAdd: () => void }) {
  const { isManager } = useStaff();
  const toast = useToast();
  const a = useRowAction("Document review saved");
  const [reasonFor, setReasonFor] = useState<{ id: string; kind: "reject" | "reupload" } | null>(null);
  const [reason, setReason] = useState("");
  const [opening, setOpening] = useState<string | null>(null);

  async function open(id: string, mode: "view" | "download") {
    setOpening(id + mode);
    const win = mode === "view" ? window.open("", "_blank") : null;
    const res = await fetch(`/api/documents/${id}?mode=${mode}`);
    const data = await res.json().catch(() => null);
    setOpening(null);
    if (!data?.ok) {
      win?.close();
      toast("error", data?.error?.message ?? `Could not open document (${res.status})`);
      return;
    }
    if (win) win.location.href = data.url;
    else window.location.assign(data.url);
  }

  return (
    <Card title="Documents" id="documents" actions={<SmallBtn onClick={onAdd}>+ Add document</SmallBtn>}>
      {docs.length === 0 ? (
        <EmptyState title="No documents yet" text="Upload the client's photo ID and work authorization." action={<SmallBtn onClick={onAdd}>+ Add document</SmallBtn>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {docs.map((d) => {
            const ex = extractions.find((e) => e.document_id === d.id);
            const advisories = ((d.quality?.advisories as string[]) ?? []).join(", ");
            return (
              <article key={d.id} className="flex gap-3 rounded-md border border-slate-200 p-3" data-testid="document-row">
                <div className="h-24 w-20 shrink-0 overflow-hidden rounded bg-slate-100">
                  {d.has_thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/documents/${d.id}/thumbnail`} alt={`${DOC_LABELS[d.doc_type as keyof typeof DOC_LABELS]} thumbnail`} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-xs text-slate-500">{d.mime_type === "application/pdf" ? `PDF · ${d.page_count ?? "?"}p` : "No preview"}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{DOC_LABELS[d.doc_type as keyof typeof DOC_LABELS] ?? d.doc_type}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONE[d.status as DocStatus]}`} data-testid="document-status">{DOC_STATUS_LABELS[d.status as DocStatus]}</span>
                  </div>
                  <p className="truncate text-xs text-slate-500" title={d.file_name}>{d.file_name} · {Math.ceil(d.size_bytes / 1024)} KB · opened {d.open_count}×</p>
                  <p className="text-xs text-slate-500">Uploaded {dateTime(d.uploaded_at)} by {d.uploaded_by_name ?? "client (online)"} · SHA-256 {String(d.sha256 ?? "").slice(0, 12)}…</p>
                  {advisories && <p className="text-xs text-amber-700">Quality advisories: {advisories}</p>}
                  <p className="text-xs text-slate-500">
                    Reviewed: {d.reviewed_at ? `${d.reviewed_by_name} · ${dateTime(d.reviewed_at)}` : "not yet"}
                    {d.rejection_reason && ` · Reason: ${d.rejection_reason}`}
                    {d.status === "needs_reupload" && d.review_note && ` · ${d.review_note}`}
                  </p>
                  <Trust ex={ex} />
                  <div className="flex flex-wrap gap-1 pt-1">
                    <SmallBtn onClick={() => open(d.id, "view")} disabled={opening === d.id + "view"}>View</SmallBtn>
                    <SmallBtn onClick={() => open(d.id, "download")} disabled={opening === d.id + "download"}>Download</SmallBtn>
                    {isManager && !["verified", "rejected", "processing"].includes(d.status) && (
                      <SmallBtn disabled={a.pending} onClick={() => a.go({ action: "verify_document", document_id: d.id })}>Verify</SmallBtn>
                    )}
                    {isManager && !["rejected", "processing"].includes(d.status) && <SmallBtn onClick={() => { setReasonFor({ id: d.id, kind: "reject" }); setReason(""); }}>Reject</SmallBtn>}
                    {isManager && !["verified", "rejected", "processing", "needs_reupload"].includes(d.status) && (
                      <SmallBtn onClick={() => { setReasonFor({ id: d.id, kind: "reupload" }); setReason(""); }}>Request re-upload</SmallBtn>
                    )}
                    {isManager && !["verified", "rejected", "processing"].includes(d.status) && (
                      <SmallBtn disabled={a.pending} onClick={() => a.go({ action: "process_document", document_id: d.id })}>Re-run extraction</SmallBtn>
                    )}
                  </div>
                  {reasonFor?.id === d.id && (
                    <form className="mt-2 flex gap-1" onSubmit={async (e) => {
                      e.preventDefault();
                      const kind = reasonFor?.kind;
                      const ok = await a.go(kind === "reject"
                        ? { action: "reject_document", document_id: d.id, reason }
                        : { action: "request_reupload", document_id: d.id, reason });
                      if (ok) setReasonFor(null);
                    }}>
                      <input aria-label={reasonFor?.kind === "reject" ? "Rejection reason" : "Re-upload reason"} required className="input py-1 text-xs" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                      <SmallBtn type="submit" disabled={a.pending}>Save</SmallBtn>
                    </form>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">Verification is a human decision. Automated extraction never marks a document verified. Links expire after 10 minutes and every view is logged.</p>
      {a.error && <p role="alert" className="mt-2 text-red-600">{a.error}</p>}
    </Card>
  );
}
