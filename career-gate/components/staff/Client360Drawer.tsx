"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Client = { id: string; ref: string; full_name: string };
type DocumentRow = { id: string; file_name?: string; doc_type?: string; status?: string; uploaded_at?: string };
type Extraction = {
  document_id: string; provider?: string; model?: string; status?: string; created_at?: string;
  fields?: Record<string, unknown> | null; reconciliation?: Record<string, unknown> | null;
};
type ActivityRow = { id: string | number; action: string; created_at: string; staff_name?: string | null; old_value?: Record<string, unknown> | null; new_value?: Record<string, unknown> | null };
type AppointmentRow = { id: string; appointment_type: string; scheduled_at: string; status: string; outcome?: string | null; decision_at?: string | null; location?: string | null };
type AccountSummary = { payment_status: string; net_fee: number; amount_paid: number; amount_paid_visible: boolean; balance: number; application_status: string; application_completed_at: string | null };
type Data = {
  client: Record<string, unknown> | null;
  documents: DocumentRow[];
  extractions: Extraction[];
  activity: ActivityRow[];
  appointments: AppointmentRow[];
  account?: AccountSummary | null;
  nextAction?: Record<string, unknown> | null;
};

const short = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

function when(value: string | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Detroit" }).format(date)
    : value;
}

export function Client360Drawer({ client, onClose }: { client: Client; onClose: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<string | null>(null);
  const [loadingDocument, setLoadingDocument] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeWithEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeWithEscape);
    const params = new URLSearchParams({ client_id: client.id, payloads: "client,appointments,account,documents,extractions,activity,nextAction" });
    void fetch(`/api/staff/client-resource?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result?.ok) throw new Error(result?.error?.message ?? "Client data is unavailable");
        if (controller.signal.aborted) return;
        setData(result.payloads as Data);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Failed to open client record");
      });
    return () => {
      controller.abort();
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [client.id, onClose]);

  const latestExtractions = useMemo(() => {
    const result = new Map<string, Extraction>();
    for (const extraction of data?.extractions ?? []) {
      if (!result.has(extraction.document_id)) result.set(extraction.document_id, extraction);
    }
    return result;
  }, [data?.extractions]);

  async function showDocument(id: string) {
    if (loadingDocument) return;
    setError("");
    setLoadingDocument(true);
    setSelectedDocument(id);
    setDocumentUrl(null);
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result?.ok || typeof result.url !== "string")
        throw new Error(result?.error?.message ?? "Secure document preview is unavailable");
      setDocumentUrl(result.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Document could not be opened");
    } finally { setLoadingDocument(false); }
  }

  return (
    <div className="fixed inset-0 z-[200] flex justify-end bg-[#020814]/85" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside role="dialog" aria-modal="true" aria-label={`Client 360: ${client.full_name}`}
        className="flex h-full w-full max-w-[min(100vw,720px)] flex-col overflow-hidden border-l border-amber-200/25 bg-gradient-to-b from-[#13233e] to-[#070f22] shadow-[-20px_0_50px_rgba(0,0,0,.42)]">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
          <div className="min-w-0"><p className="text-[11px] font-bold tracking-[.2em] text-amber-200">CAREER GATE · CLIENT 360</p>
            <h2 className="mt-1 break-words text-xl font-semibold tracking-tight leading-6 text-white">{client.full_name}</h2>
            <p className="mt-1 font-mono text-xs text-cyan-200">{client.ref}</p>
          </div>
          <div className="flex gap-2">
            <Link href={`/staff/client/${client.id}`} className="inline-flex min-h-11 items-center rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 text-xs font-semibold text-amber-100 transition hover:bg-amber-300/20">Full record</Link>
            <button autoFocus onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-xl text-white transition hover:bg-white/20" aria-label="Close Client 360">×</button>
          </div>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 sm:p-5">
          {error && <p role="alert" className="rounded-xl border border-red-300/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
          {!data && !error && <p role="status" className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-slate-200">Loading authorized client record…</p>}
          {data && <>
            <section className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Client summary">
              {[
                ["Canonical status",data.client?.current_status],
                ["Pipeline stage",data.client?.pipeline_stage],
                ["Assigned employee",data.client?.assigned_name],
                ["Received on",when(short(data.client?.created_at))],
                ["Documents",String(data.documents.length)],
                ["Preferred site",data.client?.preferred_location],
                ["Shift",data.client?.shift_days],
                ["Next step",data.client?.next_step],
              ].map(([label,value]) => <div key={String(label)} className="min-w-0 rounded-xl border border-white/10 bg-white/[.045] px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{String(label)}</p>
                <p className="mt-1 break-words text-sm font-semibold text-slate-100">{short(value).replaceAll("_"," ")}</p>
              </div>)}
            </section>
            <section aria-labelledby="client360-appointments" className="rounded-2xl border border-white/10 bg-white/[.03] p-3 sm:p-4">
              <h3 id="client360-appointments" className="text-base font-semibold text-amber-100">Appointments & recorded interview outcomes</h3>
              {!data.appointments?.length ? <p className="mt-3 text-sm text-slate-300">No appointments recorded.</p> :
                <ol className="mt-4 space-y-2">{data.appointments.map((appointment) => (
                  <li key={appointment.id} className="rounded-2xl border border-white/10 bg-[#061125]/55 p-3 text-sm text-slate-100">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="font-semibold">{appointment.appointment_type}</strong>
                      <time className="text-xs text-slate-400">{when(appointment.scheduled_at)}</time>
                    </div>
                    <p className="mt-2 text-xs text-slate-300">
                      {appointment.status.replaceAll("_", " ")} · {appointment.location || "Location not recorded"} ·
                      {appointment.outcome ? ` Decision: ${appointment.outcome.replaceAll("_", " ")}` :
                        appointment.status === "attended" ? " Interview outcome pending" : " No decision recorded"}
                    </p>
                  </li>
                ))}</ol>}
            </section>
            <section aria-labelledby="client360-finance" className="rounded-2xl border border-white/10 bg-white/[.03] p-3 sm:p-4">
              <h3 id="client360-finance" className="text-base font-semibold text-amber-100">Payment & paperwork · verified ledger</h3>
              {!data.account ? <p className="mt-3 text-sm text-slate-300">No canonical account summary available.</p> :
                <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                  {[
                    ["Payment status", data.account.payment_status],
                    ["Balance due", data.account.amount_paid_visible ? data.account.balance.toFixed(2) : "Restricted"],
                    ["Confirmed paid", data.account.amount_paid_visible ? data.account.amount_paid.toFixed(2) : "Restricted"],
                    ["Application", data.account.application_status],
                    ["Completion date", data.account.application_completed_at ? when(data.account.application_completed_at) : "Not completed"],
                  ].map(([label, value]) => <div key={label} className="rounded-xl bg-white/[.04] p-3">
                    <dt className="text-xs text-slate-400">{label}</dt>
                    <dd className="mt-1 text-sm font-semibold text-slate-100">{value}</dd>
                  </div>)}
                </dl>}
            </section>
            <section aria-labelledby="client360-documents" className="rounded-2xl border border-white/10 bg-white/[.03] p-3 sm:p-4">
              <h3 id="client360-documents" className="text-base font-semibold text-amber-100">Documents & G2 OCR evidence</h3>
              <p className="mt-1 text-xs text-slate-400">Private originals open through the authenticated, audited document endpoint. Extraction results are shown only when recorded.</p>
              {data.documents.length === 0 && <p className="mt-4 text-sm text-slate-300">No documents on file.</p>}
              <div className="mt-4 space-y-3">{data.documents.map((doc) => {
                const extraction = latestExtractions.get(doc.id);
                const entries = Object.entries(extraction?.fields ?? {}).slice(0,35);
                return <article key={doc.id} className="min-w-0 rounded-2xl border border-white/10 bg-[#061125]/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-all text-sm font-semibold text-white">{doc.file_name ?? doc.doc_type ?? "Document"}</p>
                      <p className="mt-1 text-xs text-slate-400">{short(doc.status)} · {when(doc.uploaded_at)} · {short(extraction?.status)}</p>
                    </div>
                    <button type="button" disabled={loadingDocument} onClick={() => void showDocument(doc.id)}
                      className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:opacity-50">Inspect original</button>
                  </div>
                  {selectedDocument === doc.id && loadingDocument && <p role="status" className="mt-3 text-xs text-slate-300">Opening secured document…</p>}
                  {selectedDocument === doc.id && documentUrl && <iframe src={documentUrl} title={doc.file_name ?? "Private document"} className="mt-4 h-[350px] w-full rounded-xl border border-white/10 bg-white" referrerPolicy="no-referrer" />}
                  {extraction && <div className="mt-4 border-t border-white/10 pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-200">OCR extraction · {short(extraction.provider)} · {short(extraction.model)}</p>
                    {entries.length ? <dl className="mt-3 grid gap-2 sm:grid-cols-2">{entries.map(([key,value])=><div key={key} className="rounded-xl bg-white/[.04] px-3 py-2"><dt className="break-all text-[11px] text-slate-400">{key.replaceAll("_"," ")}</dt><dd className="mt-1 break-words text-xs text-slate-200">{short(value)}</dd></div>)}</dl> : <p className="mt-2 text-xs text-slate-400">No extracted fields recorded.</p>}
                  </div>}
                </article>;
              })}</div>
            </section>
            <section aria-labelledby="client360-audit" className="rounded-2xl border border-white/10 bg-white/[.03] p-3 sm:p-4">
              <h3 id="client360-audit" className="text-base font-semibold text-amber-100">Audit trail / سجل الإجراءات</h3>
              {data.activity.length === 0 ? <p className="mt-3 text-sm text-slate-300">No activity recorded.</p> :
                <ol className="mt-4 space-y-2">{data.activity.slice(0,40).map((entry) =>
                  <li key={entry.id} className="flex flex-wrap justify-between gap-2 rounded-xl border border-white/[.06] bg-white/[.03] px-3 py-2 text-xs text-slate-300">
                    <div className="min-w-0 flex-1">
                      <strong className="font-semibold text-slate-100">{entry.action.replaceAll("_"," ")}</strong> · {entry.staff_name ?? "System"}
                      {(entry.old_value || entry.new_value) && <details className="mt-2">
                        <summary className="cursor-pointer text-cyan-200">Recorded changes</summary>
                        {entry.old_value && <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] text-slate-400">{JSON.stringify(entry.old_value, null, 2)}</pre>}
                        {entry.new_value && <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] text-slate-200">{JSON.stringify(entry.new_value, null, 2)}</pre>}
                      </details>}
                    </div>
                    <time className="text-slate-400">{when(entry.created_at)}</time>
                  </li>)}</ol>}
            </section>
          </>}
        </div>
      </aside>
    </div>
  );
}
