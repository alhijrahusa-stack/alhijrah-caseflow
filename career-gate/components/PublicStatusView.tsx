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
  ];

  return (
    <section
      className="cg-lux-card space-y-4 overflow-hidden rounded-[26px] p-4 text-slate-100 sm:space-y-5 sm:p-6 lg:p-7"
      data-testid="status-page"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.19em] text-[#F0CA85]">Career Gate · Client Portal</p>
          <h1 className="mt-1.5 text-[clamp(1.6rem,4.6vw,2.2rem)] font-bold leading-tight tracking-[-.035em] text-white">Application Status</h1>
          <p lang="ar" className="mt-1 text-sm font-medium text-[#CEDFF7]">حالة ملف العميل</p>
        </div>
      </header>

      <div className={s.interview ? "grid items-start gap-4 lg:grid-cols-[minmax(0,1.07fr)_minmax(0,1fr)]" : "grid items-start gap-4"}>
      <div className="rounded-2xl border border-white/15 bg-[#071A3E]/55 p-4 sm:p-5">
        <dl className="grid gap-0 text-sm">
          <div className="grid grid-cols-[minmax(95px,1fr)_minmax(0,1.65fr)] items-baseline gap-3 border-b border-white/[.09] py-3 first:pt-0">
            <dt className="text-slate-300">Client Name</dt>
            <dd className="min-w-0 break-words font-semibold tracking-[-.012em] text-white">{s.full_name}</dd>
          </div>
          <div className="grid grid-cols-[minmax(95px,1fr)_minmax(0,1.65fr)] items-baseline gap-3 border-b border-white/[.09] py-3 first:pt-0">
            <dt className="text-slate-300">File Number</dt>
            <dd className="cg-lux-numeral min-w-0 break-all font-semibold text-white">{s.ref}</dd>
          </div>
          <div className="grid grid-cols-[minmax(95px,1fr)_minmax(0,1.65fr)] items-baseline gap-3 border-b border-white/[.09] py-3 first:pt-0">
            <dt className="text-slate-300">Current Status</dt>
            <dd className="min-w-0 font-semibold text-white" data-testid="status-current-status"><span className="inline-flex max-w-full rounded-full border border-amber-300/35 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100">{s.status_label}</span></dd>
          </div>
          {s.start_date && (
            <div className="grid grid-cols-[minmax(95px,1fr)_minmax(0,1.65fr)] items-baseline gap-3 py-3">
              <dt className="text-slate-300">Start Date</dt>
              <dd className="cg-lux-numeral min-w-0 font-semibold text-white" data-testid="status-start-date">{dateOnly(s.start_date)}</dd>
            </div>
          )}
        </dl>
        <div className="mt-3 rounded-xl border border-sky-300/15 bg-sky-300/[.07] p-3">
          <p className="text-xs font-bold uppercase tracking-[.045em] text-[#F3D69A]">Next Step <span lang="ar" className="font-semibold normal-case">/ الخطوة التالية</span></p>
          <p className="mt-1 text-sm leading-6 text-white" data-testid="status-next-step">{s.next_step}</p>
        </div>
        <p className="mt-3 text-xs text-slate-200">
          Documents / المستندات: <span className={s.documents.status === "Complete" ? "font-semibold text-emerald-200" : "font-semibold text-amber-200"}>{s.documents.status}</span>
        </p>
      </div>

      {s.interview && (
        <section className="rounded-2xl border border-[#C5A059]/30 bg-[#071B3D]/60 p-4 sm:p-5" aria-label="Appointment details">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold tracking-[-.025em] text-[#F3D69A]">Appointment <span lang="ar" className="text-base font-semibold">/ الموعد</span></h2>
            {s.interview.client_acknowledged && <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2.5 py-1 text-xs font-semibold text-emerald-200">Acknowledged / تم التأكيد</span>}
          </div>
          <p className="mt-2 text-sm font-semibold leading-6 text-white">{s.interview.type}</p>
          <dl className="mt-4 grid grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-2 sm:gap-3">
            <div className="rounded-xl bg-white/[.05] p-3">
              <dt className="text-xs font-medium text-slate-300">Date / التاريخ</dt>
              <dd className="cg-lux-numeral mt-1 text-sm font-semibold leading-6 text-white">{dateOfInstant(s.interview.scheduled_at)}</dd>
            </div>
            <div className="rounded-xl bg-white/[.05] p-3">
              <dt className="text-xs font-medium text-slate-300">Time / الوقت</dt>
              <dd className="cg-lux-numeral mt-1 text-sm font-semibold text-white">{timeOnly(s.interview.scheduled_at)}</dd>
            </div>
            <div className="col-span-2 rounded-xl bg-white/[.05] p-3">
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
      </div>

      <details className="group rounded-2xl border border-white/15 bg-[#071A3E]/55 p-4">
        <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 [&::-webkit-details-marker]:hidden">
          <span>File Details / تفاصيل الملف</span><span aria-hidden="true" className="text-[#E6C585] transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <dl className="mt-3 grid gap-3 border-t border-white/10 pt-4 text-sm">
          {detailRows.map(([name, value]) => (
            <div className="grid grid-cols-[minmax(100px,1fr)_minmax(0,2fr)] gap-3" key={name}>
              <dt className="text-slate-300">{name}</dt>
              <dd className="cg-lux-numeral min-w-0 break-words font-medium text-white">{value}</dd>
            </div>
          ))}
        </dl>
      </details>

      <details className="group rounded-2xl border border-white/15 bg-[#071A3E]/55 p-4">
        <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 [&::-webkit-details-marker]:hidden">
          <span>File Updates / تحديثات الملف</span>
          <span className="flex shrink-0 items-center gap-2 text-xs text-[#F3D69A]">{s.history.length} <span aria-hidden="true" className="transition-transform group-open:rotate-180">⌄</span></span>
        </summary>
        {s.history.length > 0 && (
          <p className="mt-2 text-xs font-medium text-slate-300">{s.history[s.history.length - 1]?.label} · {dateTime(s.history[s.history.length - 1]?.updated_at ?? s.updated_at)}</p>
        )}
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
