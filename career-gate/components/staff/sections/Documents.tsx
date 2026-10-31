"use client";

import { StaffLabel, useStaffLabel } from "@/components/staff/StaffLabel";


import { useState } from "react";
import { SecureDocumentDrawer } from "@/components/staff/SecureDocumentDrawer";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
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
    return <p className="text-xs text-slate-500" data-testid="extraction-state"><StaffLabel en="Automated extraction: PENDING"/></p>;
  }
  if (ex.status === "not_configured") {
    return <p className="text-xs text-slate-500" data-testid="extraction-state"><StaffLabel en="Automated extraction: NOT_CONFIGURED (no document vision provider). Human review required."/></p>;
  }
  const fields = (ex.fields ?? []) as Row[];
  const recon = (ex.reconciliation ?? []) as Row[];
  return (
    <div className="space-y-1 text-xs" data-testid="extraction-state">
      <p className="text-slate-600">
        <strong><StaffLabel en="What:"/></strong> {fields.length}{" "}<StaffLabel en="field(s) extracted ·"/>{" "}<strong><StaffLabel en="Source:"/></strong>{" "}<StaffLabel en="uploaded document ·"/>{" "}<strong><StaffLabel en="Method:"/></strong> {ex.provider} {ex.model ?? ""}{ex.escalated ? " (escalated)" : ""} ·{" "}
        <strong><StaffLabel en="Status:"/></strong> {ex.status} · <strong><StaffLabel en="When:"/></strong> {dateTime(ex.created_at)} · <strong><StaffLabel en="Human reviewed:"/></strong>{" "}<StaffLabel en="see review below"/>{" "}</p>
      {ex.error && <p className="text-red-700"><StaffLabel en="Error:"/>{" "}{ex.error}</p>}
      {fields.length > 0 && (
        <table className="w-full text-left">
          <thead><tr className="text-slate-500"><th className="py-0.5"><StaffLabel en="Field"/></th><th><StaffLabel en="Printed"/></th><th><StaffLabel en="Normalized"/></th><th><StaffLabel en="Page"/></th></tr></thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={i}><td className="py-0.5">{f.field_name}</td><td>{f.legible ? f.raw_value ?? "—" : "illegible"}</td><td>{f.normalized_value ?? "—"}</td><td>{f.source_page ?? "—"}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {recon.length > 0 && (
        <p><StaffLabel en="Reconciliation with client record:"/>{" "}
          {recon.map((r, i) => (
            <span key={i} className={`mr-2 font-medium ${RECON_TONE[r.state]}`} data-testid="recon-state">{r.field}: {r.state}{r.similarity !== undefined ? ` (${r.similarity})` : ""}</span>
          ))}
        </p>
      )}
    </div>
  );
}

export function Documents({ docs, extractions, onAdd }: { docs: Row[]; extractions: Row[]; onAdd: () => void }) {
  const uiLabel = useStaffLabel();
  const { isManager } = useStaff();
  const toast = useToast();
  const { t } = useStaffLanguage();
  const [preview, setPreview] = useState<Row | null>(null);
  const a = useRowAction("Document review saved");
  const [reasonFor, setReasonFor] = useState<{ id: string; kind: "reject" | "reupload" } | null>(null);
  const [reason, setReason] = useState("");
  const [opening, setOpening] = useState<string | null>(null);

  async function download(id: string) {
    setOpening(id);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(id)}?mode=download`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || typeof data.url !== "string") throw new Error(data?.error?.message ?? `Could not download document (${res.status})`);
      const anchor = document.createElement("a");
      anchor.href = data.url;
      anchor.rel = "noopener noreferrer";
      anchor.download = "";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch (cause) { toast("error", cause instanceof Error ? cause.message : "Document could not be downloaded"); }
    finally { setOpening(null); }
  }

  return (
    <Card title={uiLabel("Documents")} id="documents" actions={<SmallBtn onClick={onAdd}><StaffLabel en="+ Add document"/></SmallBtn>}>
      {docs.length === 0 ? (
        <EmptyState title={uiLabel("No documents yet")} text={uiLabel("Upload the client's photo ID and work authorization.")} action={<SmallBtn onClick={onAdd}><StaffLabel en="+ Add document"/></SmallBtn>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {docs.map((d) => {
            const ex = extractions.find((e) => e.document_id === d.id);
            const advisories = ((d.quality?.advisories as string[]) ?? []).join(", ");
            return (
              <article id={`document-${String(d.id)}`} key={d.id} className="scroll-mt-28 flex gap-3 rounded-md border border-slate-200 p-3" data-testid="document-row">
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
                    <p className="font-medium">{uiLabel(DOC_LABELS[d.doc_type as keyof typeof DOC_LABELS] ?? d.doc_type)}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONE[d.status as DocStatus]}`} data-testid="document-status">{uiLabel(DOC_STATUS_LABELS[d.status as DocStatus])}</span>
                  </div>
                  <p className="truncate text-xs text-slate-500" title={d.file_name}>{d.file_name} · {Math.ceil(d.size_bytes / 1024)} KB · opened {d.open_count}×</p>
                  <p className="text-xs text-slate-500"><StaffLabel en="Uploaded"/>{" "}{dateTime(d.uploaded_at)}{" "}<StaffLabel en="by"/>{" "}{d.uploaded_by_name ?? "client (online)"} · SHA-256 {String(d.sha256 ?? "").slice(0, 12)}…</p>
                  {advisories && <p className="text-xs text-amber-700"><StaffLabel en="Quality advisories:"/>{" "}{advisories}</p>}
                  <p className="text-xs text-slate-500"><StaffLabel en="Reviewed:"/>{" "}{d.reviewed_at ? `${d.reviewed_by_name} · ${dateTime(d.reviewed_at)}` : "not yet"}
                    {d.rejection_reason && ` · Reason: ${d.rejection_reason}`}
                    {d.status === "needs_reupload" && d.review_note && ` · ${d.review_note}`}
                  </p>
                  <Trust ex={ex} />
                  <div className="flex flex-wrap gap-1 pt-1">
                    <SmallBtn onClick={() => setPreview(d)}>{t("View", "معاينة")}</SmallBtn>
                    <SmallBtn onClick={() => void download(d.id)} disabled={opening === d.id}>{t("Download", "تنزيل")}</SmallBtn>
                    {isManager && !["verified", "rejected", "processing"].includes(d.status) && (
                      <SmallBtn disabled={a.pending} onClick={() => a.go({ action: "verify_document", document_id: d.id })}><StaffLabel en="Verify"/></SmallBtn>
                    )}
                    {isManager && !["rejected", "processing"].includes(d.status) && <SmallBtn onClick={() => { setReasonFor({ id: d.id, kind: "reject" }); setReason(""); }}><StaffLabel en="Reject"/></SmallBtn>}
                    {isManager && !["verified", "rejected", "processing", "needs_reupload"].includes(d.status) && (
                      <SmallBtn onClick={() => { setReasonFor({ id: d.id, kind: "reupload" }); setReason(""); }}><StaffLabel en="Request re-upload"/></SmallBtn>
                    )}
                    {isManager && !["verified", "rejected", "processing"].includes(d.status) && (
                      <SmallBtn disabled={a.pending} onClick={() => a.go({ action: "process_document", document_id: d.id })}><StaffLabel en="Re-run extraction"/></SmallBtn>
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
                      <input aria-label={reasonFor?.kind === "reject" ? "Rejection reason" : "Re-upload reason"} required className="input py-1 text-xs" placeholder={uiLabel("Reason")} value={reason} onChange={(e) => setReason(e.target.value)} />
                      <SmallBtn type="submit" disabled={a.pending}><StaffLabel en="Save"/></SmallBtn>
                    </form>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500"><StaffLabel en="Verification is a human decision. Automated extraction never marks a document verified. Links expire after 10 minutes and every view is logged."/></p>
      {preview && <SecureDocumentDrawer key={String(preview.id)} documentId={String(preview.id)} name={String(preview.file_name ?? preview.doc_type ?? "Document")} mimeType={preview.mime_type} onClose={() => setPreview(null)} />}
      {a.error && <p role="alert" className="mt-2 text-red-600">{a.error}</p>}
    </Card>
  );
}
