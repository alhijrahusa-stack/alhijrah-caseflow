import { ClientAppointmentActions } from "@/components/ClientAppointmentActions";
import type { PublicStatus } from "@/lib/public-status";
import { dateOfInstant, dateOnly, dateTime, timeOnly } from "@/lib/format";

export function PublicStatusView({ s, verifiedRef, appointmentAction, readOnly = false }: { s: PublicStatus; verifiedRef?: string; appointmentAction?: string; readOnly?: boolean }) {
  const location = s.location ? [s.location.site_name, s.location.address].filter(Boolean).join(" — ") : "—";
  const detailRows: [string, string][] = [
    ["Date Filed", dateOfInstant(s.filed_at)],
    ["Last Updated", dateTime(s.updated_at)],
    ...(s.location ? [["Location", location] as [string, string]] : []),
    ...(s.shift?.days ? [["Shift Days", s.shift.days] as [string, string]] : []),
    ...(s.shift?.time ? [["Shift Time", s.shift.time] as [string, string]] : []),
    ...(s.start_date ? [["Start Date", dateOnly(s.start_date)] as [string, string]] : []),
  ];

  return (
    <section
      className="space-y-5 overflow-hidden rounded-[26px] border border-[#C5A059]/35 bg-white/[.09] p-4 text-slate-100 shadow-[0_25px_60px_rgba(0,0,0,.25)] backdrop-blur-xl sm:space-y-6 sm:p-7"
      data-testid="status-page"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[.15em] text-[#E6C585]">Career Gate · بوابة التوظيف</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">Application Status</h1>
          <p className="mt-1 text-sm text-slate-300">حالة ملف العميل</p>
        </div>
      </header>

      <div className="rounded-2xl border border-white/15 bg-[#0E244B]/65 p-4 sm:p-5">
        <dl className="grid gap-3 text-sm">
          <div className="grid grid-cols-[minmax(90px,1fr)_minmax(0,2fr)] items-baseline gap-3">
            <dt className="text-slate-300">Client Name</dt>
            <dd className="min-w-0 break-words font-semibold text-white">{s.full_name}</dd>
          </div>
          <div className="grid grid-cols-[minmax(90px,1fr)_minmax(0,2fr)] items-baseline gap-3">
            <dt className="text-slate-300">File Number</dt>
            <dd className="min-w-0 break-all font-semibold tracking-wide text-white">{s.ref}</dd>
          </div>
          <div className="grid grid-cols-[minmax(90px,1fr)_minmax(0,2fr)] items-baseline gap-3">
            <dt className="text-slate-300">Current Status</dt>
            <dd className="min-w-0 font-semibold text-white" data-testid="status-current-status"><span className="inline-flex max-w-full rounded-full border border-amber-300/35 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100">{s.status_label}</span></dd>
          </div>
        </dl>
        <div className="mt-4 rounded-xl border border-sky-300/15 bg-sky-300/[.07] p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-[#E6C585]">Next Step / الخطوة التالية</p>
          <p className="mt-1 text-sm leading-6 text-white" data-testid="status-next-step">{s.next_step}</p>
        </div>
        <p className="mt-3 text-xs text-slate-200">
          Documents / المستندات: <span className={s.documents.status === "Complete" ? "font-semibold text-emerald-200" : "font-semibold text-amber-200"}>{s.documents.status}</span>
        </p>
      </div>

      {s.interview && (
        <section className="rounded-2xl border border-[#C5A059]/35 bg-[#10244C]/90 p-4 sm:p-5" aria-label="Appointment details">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-[#E6C585]">Appointment / الموعد</h2>
            {s.interview.client_acknowledged && <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2.5 py-1 text-xs font-semibold text-emerald-200">Acknowledged / تم التأكيد</span>}
          </div>
          <p className="mt-2 text-sm font-semibold text-white">{s.interview.type}</p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-white/[.05] p-3">
              <dt className="text-xs font-medium text-slate-300">Date / التاريخ</dt>
              <dd className="mt-1 text-sm font-semibold leading-6 text-white">{dateOfInstant(s.interview.scheduled_at)}</dd>
            </div>
            <div className="rounded-xl bg-white/[.05] p-3">
              <dt className="text-xs font-medium text-slate-300">Time / الوقت</dt>
              <dd className="mt-1 text-sm font-semibold text-white">{timeOnly(s.interview.scheduled_at)}</dd>
            </div>
            <div className="rounded-xl bg-white/[.05] p-3 sm:col-span-2">
              <dt className="text-xs font-medium text-slate-300">Location / المكان</dt>
              <dd className="mt-1 break-words text-sm font-semibold text-white" data-testid="status-appointment-location">{s.interview.location ?? "—"}</dd>
            </div>
          </dl>
          {!readOnly && verifiedRef && s.interview.id && (
            <ClientAppointmentActions
              refCode={verifiedRef}
              appointmentId={s.interview.id}
              initialAction={appointmentAction}
              initialAcknowledged={Boolean(s.interview.client_acknowledged)}
              embedded
            />
          )}
        </section>
      )}

      <details className="group rounded-2xl border border-white/15 bg-[#0E244B]/55 p-4">
        <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 [&::-webkit-details-marker]:hidden">
          <span>File Details / تفاصيل الملف</span><span aria-hidden="true" className="text-[#E6C585] transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <dl className="mt-3 grid gap-3 border-t border-white/10 pt-4 text-sm">
          {detailRows.map(([name, value]) => (
            <div className="grid grid-cols-[minmax(100px,1fr)_minmax(0,2fr)] gap-3" key={name}>
              <dt className="text-slate-300">{name}</dt>
              <dd className="min-w-0 break-words font-medium text-white" data-testid={name === "Start Date" ? "status-start-date" : undefined}>{value}</dd>
            </div>
          ))}
        </dl>
      </details>

      <details className="group rounded-2xl border border-white/15 bg-[#0E244B]/55 p-4">
        <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 [&::-webkit-details-marker]:hidden">
          <span>File Updates / تحديثات الملف</span>
          <span className="flex items-center gap-2 text-xs text-[#E6C585]">{s.history.length} <span aria-hidden="true" className="transition-transform group-open:rotate-180">⌄</span></span>
        </summary>
        <ol className="mt-4 space-y-3 border-l border-[#C5A059]/40 pl-4">
          {s.history.map((item, index) => (
            <li key={`${item.updated_at}-${item.status}-${index}`}>
              <p className="text-sm font-semibold text-white">{item.label}</p>
              <p className="mt-1 text-xs text-slate-300">{dateTime(item.updated_at)}</p>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
