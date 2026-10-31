"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GlassReviewDialog } from "@/components/staff/smart/GlassReviewDialog";
import { SecureDocumentDrawer } from "@/components/staff/SecureDocumentDrawer";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { subscribeResources } from "@/components/staff/realtime/update-bus";

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

const RECORD_LABELS: Record<string,string> = {"Canonical status": "الحالة المعتمدة", "Pipeline stage": "مرحلة المسار", "Assigned employee": "الموظف المختص", "Received on": "تاريخ الاستقبال", "Documents": "الوثائق", "Preferred site": "الموقع المفضل", "Shift": "الوردية", "Next step": "الخطوة التالية", "Payment status": "حالة السداد", "Balance due": "الرصيد المستحق", "Confirmed paid": "المدفوع المؤكد", "Application": "الطلب", "Completion date": "تاريخ الإكمال"};

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
  const { t } = useStaffLanguage();
  const [selectedDocument, setSelectedDocument] = useState<DocumentRow | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ client_id: client.id, payloads: "client,appointments,account,documents,extractions,activity,nextAction" });
    let sequence = 0;
    const load = () => { const request = ++sequence; return fetch(`/api/staff/client-resource?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result?.ok) throw new Error(result?.error?.message ?? "Client data is unavailable");
        if (controller.signal.aborted || request !== sequence) return;
        setError("");
        setData(result.payloads as Data);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Failed to open client record");
      }); };
    void load();
    const unsubscribe = subscribeResources({ clientId: client.id, resources: ["client_identity", "documents", "appointments", "account", "finance", "activity", "next_action"], onUpdate: () => { void load(); } });
    return () => { controller.abort(); unsubscribe(); };
  }, [client.id]);

  const latestExtractions = useMemo(() => {
    const result = new Map<string, Extraction>();
    for (const extraction of data?.extractions ?? []) {
      if (!result.has(extraction.document_id)) result.set(extraction.document_id, extraction);
    }
    return result;
  }, [data?.extractions]);

  return (
    <GlassReviewDialog title={`Client 360: ${client.full_name}`} drawer closeLabel={t("Close Client 360", "إغلاق ملف العميل")} onClose={onClose}>
      <div className="flex h-full min-h-0 flex-col text-slate-100">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-amber-200/20 pb-4">
          <p className="font-mono text-sm text-cyan-200" dir="ltr">{client.ref}</p>
          <Link href={`/staff/client/${client.id}`} className="cg-mini-glass-button">{t("Full record", "الملف الكامل")}</Link>
        </div>
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain p-3 sm:p-4">
          {error && <p role="alert" className="rounded-xl border border-red-300/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
          {!data && !error && <p role="status" className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-slate-200">{t("Loading authorized client record…", "جارٍ تحميل الملف المسموح به…")}</p>}
          {data && <>
            <section className="grid min-w-0 grid-cols-2 gap-2" aria-label="Client summary">
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
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t(String(label),RECORD_LABELS[String(label)] ?? String(label))}</p>
                <p className="mt-1 break-words text-sm font-semibold text-slate-100">{short(value).replaceAll("_"," ")}</p>
              </div>)}
            </section>
            <section aria-labelledby="client360-appointments" className="rounded-2xl border border-white/10 bg-white/[.03] p-3 sm:p-4">
              <h3 id="client360-appointments" className="text-base font-semibold text-amber-100">{t("Appointments & recorded interview outcomes", "المواعيد ونتائج المقابلات المسجلة")}</h3>
              {!data.appointments?.length ? <p className="mt-3 text-sm text-slate-300">{t("No appointments recorded.", "لا توجد مواعيد مسجلة.")}</p> :
                <ol className="mt-4 space-y-2">{data.appointments.map((appointment) => (
                  <li key={appointment.id} className="rounded-2xl border border-white/10 bg-[#061125]/55 p-3 text-sm text-slate-100">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="font-semibold">{appointment.appointment_type}</strong>
                      <time className="text-xs text-slate-400">{when(appointment.scheduled_at)}</time>
                    </div>
                    <p className="mt-2 text-xs text-slate-300">
                      {appointment.status.replaceAll("_", " ")} · {appointment.location || t("Location not recorded", "الموقع غير مسجل")} ·
                      {appointment.outcome ? `${t("Decision", "النتيجة")}: ${appointment.outcome.replaceAll("_", " ")}` :
                        appointment.status === "attended" ? t(" Interview outcome pending", "نتيجة المقابلة بانتظار التسجيل") : t(" No decision recorded", "لا توجد نتيجة مسجلة")}
                    </p>
                  </li>
                ))}</ol>}
            </section>
            <section aria-labelledby="client360-finance" className="rounded-2xl border border-white/10 bg-white/[.03] p-3 sm:p-4">
              <h3 id="client360-finance" className="text-base font-semibold text-amber-100">{t("Payment & paperwork · verified ledger", "الدفع والوثائق · السجل المالي المعتمد")}</h3>
              {!data.account ? <p className="mt-3 text-sm text-slate-300">{t("No canonical account summary available.", "لا يتوفر ملخص حساب معتمد.")}</p> :
                <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                  {[
                    ["Payment status", data.account.payment_status],
                    ["Balance due", data.account.amount_paid_visible ? data.account.balance.toFixed(2) : "Restricted"],
                    ["Confirmed paid", data.account.amount_paid_visible ? data.account.amount_paid.toFixed(2) : "Restricted"],
                    ["Application", data.account.application_status],
                    ["Completion date", data.account.application_completed_at ? when(data.account.application_completed_at) : "Not completed"],
                  ].map(([label, value]) => <div key={label} className="rounded-xl bg-white/[.04] p-3">
                    <dt className="text-xs text-slate-400">{t(label,RECORD_LABELS[label] ?? label)}</dt>
                    <dd className="mt-1 text-sm font-semibold text-slate-100">{value}</dd>
                  </div>)}
                </dl>}
            </section>
            <section aria-labelledby="client360-documents" className="rounded-2xl border border-white/10 bg-white/[.03] p-3 sm:p-4">
              <h3 id="client360-documents" className="text-base font-semibold text-amber-100">{t("Documents & G2 OCR evidence", "الوثائق وأدلة الاستخراج المسجلة")}</h3>
              <p className="mt-1 text-xs text-slate-400">{t("Private originals open through the authenticated, audited document endpoint. Extraction results are shown only when recorded.", "تُفتح الوثائق الأصلية بصلاحية مسجلة، وتظهر نتائج الاستخراج المحفوظة فقط.")}</p>
              {data.documents.length === 0 && <p className="mt-4 text-sm text-slate-300">{t("No documents on file.", "لا توجد وثائق في الملف.")}</p>}
              <div className="mt-4 space-y-3">{data.documents.map((doc) => {
                const extraction = latestExtractions.get(doc.id);
                const entries = Object.entries(extraction?.fields ?? {}).slice(0,35);
                return <article key={doc.id} className="min-w-0 rounded-2xl border border-white/10 bg-[#061125]/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-all text-sm font-semibold text-white">{doc.file_name ?? doc.doc_type ?? "Document"}</p>
                      <p className="mt-1 text-xs text-slate-400">{short(doc.status)} · {when(doc.uploaded_at)} · {short(extraction?.status)}</p>
                    </div>
                    <button type="button" onClick={() => setSelectedDocument(doc)}
                      className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:opacity-50">{t("Inspect original", "معاينة الأصل")}</button>
                  </div>
                  {extraction && <div className="mt-4 border-t border-white/10 pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-200">{t("OCR extraction", "استخراج بيانات الوثيقة")} · {short(extraction.provider)} · {short(extraction.model)}</p>
                    {entries.length ? <dl className="mt-3 grid gap-2 sm:grid-cols-2">{entries.map(([key,value])=><div key={key} className="rounded-xl bg-white/[.04] px-3 py-2"><dt className="break-all text-[11px] text-slate-400">{key.replaceAll("_"," ")}</dt><dd className="mt-1 break-words text-xs text-slate-200">{short(value)}</dd></div>)}</dl> : <p className="mt-2 text-xs text-slate-400">{t("No extracted fields recorded.", "لا توجد حقول مستخرجة مسجلة.")}</p>}
                  </div>}
                </article>;
              })}</div>
            </section>
            <section aria-labelledby="client360-audit" className="rounded-2xl border border-white/10 bg-white/[.03] p-3 sm:p-4">
              <h3 id="client360-audit" className="text-base font-semibold text-amber-100">{t("Audit trail / سجل الإجراءات", "سجل الإجراءات")}</h3>
              {data.activity.length === 0 ? <p className="mt-3 text-sm text-slate-300">{t("No activity recorded.", "لا توجد إجراءات مسجلة.")}</p> :
                <ol className="mt-4 space-y-2">{data.activity.slice(0,40).map((entry) =>
                  <li key={entry.id} className="flex flex-wrap justify-between gap-2 rounded-xl border border-white/[.06] bg-white/[.03] px-3 py-2 text-xs text-slate-300">
                    <div className="min-w-0 flex-1">
                      <strong className="font-semibold text-slate-100">{entry.action.replaceAll("_"," ")}</strong> · {entry.staff_name ?? "System"}
                      {(entry.old_value || entry.new_value) && <details className="mt-2">
                        <summary className="cursor-pointer text-cyan-200">{t("Recorded changes", "التغييرات المسجلة")}</summary>
                        {entry.old_value && <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] text-slate-400">{JSON.stringify(entry.old_value, null, 2)}</pre>}
                        {entry.new_value && <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] text-slate-200">{JSON.stringify(entry.new_value, null, 2)}</pre>}
                      </details>}
                    </div>
                    <time className="text-slate-400">{when(entry.created_at)}</time>
                  </li>)}</ol>}
            </section>
          </>}
        </div>
      </div>
      {selectedDocument && <SecureDocumentDrawer key={selectedDocument.id} documentId={selectedDocument.id} name={selectedDocument.file_name ?? selectedDocument.doc_type ?? "Document"} onClose={() => setSelectedDocument(null)} />}
    </GlassReviewDialog>
  );
}
