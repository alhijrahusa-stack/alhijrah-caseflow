import { ClientAppointmentActions } from "@/components/ClientAppointmentActions";
import { OfficeContact } from "@/components/OfficeContact";
import type { PublicStatus } from "@/lib/public-status";
import { dateOfInstant, dateOnly, dateTime, timeOnly } from "@/lib/format";

export function PublicStatusView({ s, verifiedRef, appointmentAction, readOnly = false }: { s: PublicStatus; verifiedRef?: string; appointmentAction?: string; readOnly?: boolean }) {
  const location = s.location ? [s.location.site_name, s.location.address].filter(Boolean).join(" — ") : "—";
  const rows: [string, string, string?][] = [
    ["Client Name", s.full_name],
    ["File Number", s.ref],
    ["Date Filed", dateOfInstant(s.filed_at)],
    ["Location", location],
    ["Shift Days", s.shift?.days ?? "—"],
    ["Shift Time", s.shift?.time ?? "—"],
    ["Current Status", s.status_label, "status-current-status"],
    ["Next Step", s.next_step, "status-next-step"],
    ["Documents", s.documents.status],
    ["Last Updated", dateTime(s.updated_at)],
  ];
  if (s.start_date) rows.splice(rows.length - 1, 0, ["Start Date", dateOnly(s.start_date), "status-start-date"]);

  return (
    <section className="space-y-6 overflow-hidden rounded-[26px] border border-[#C5A059]/35 bg-white/[.09] p-4 text-slate-100 shadow-[0_25px_60px_rgba(0,0,0,.25)] backdrop-blur-xl sm:p-7" data-testid="status-page">
      <div>
        <h1 className="text-2xl font-bold text-white">Application Status</h1>
        <p className="mt-1 text-sm text-slate-300">Career Gate · حالة ملف العميل</p>
      </div>
      <dl className="grid grid-cols-[minmax(95px,1fr)_minmax(0,2fr)] gap-x-3 gap-y-4 text-sm">
        {rows.map(([k, v, testId]) => (
          <div key={k} className="contents">
            <dt className="text-slate-300">{k}</dt>
            <dd className="min-w-0 break-words font-semibold text-white" data-testid={testId}>{v}</dd>
          </div>
        ))}
      </dl>
      {s.interview && (
        <div className="rounded-2xl border border-[#C5A059]/35 bg-[#09234b]/70 p-4">
          <h2 className="text-base font-bold text-[#E6C585]">Appointment / الموعد</h2>
          <dl className="mt-3 grid grid-cols-[minmax(70px,1fr)_minmax(0,2fr)] gap-x-3 gap-y-3 text-sm">
            <dt className="text-slate-500">Type</dt><dd className="min-w-0 break-words font-semibold text-white">{s.interview.type}</dd>
            <dt className="text-slate-500">Date</dt><dd className="col-span-2 font-medium">{dateOfInstant(s.interview.scheduled_at)}</dd>
            <dt className="text-slate-500">Time</dt><dd className="col-span-2 font-medium">{timeOnly(s.interview.scheduled_at)}</dd>
            <dt className="text-slate-500">Location</dt><dd className="col-span-2 font-medium" data-testid="status-appointment-location">{s.interview.location ?? "—"}</dd>
          </dl>
        </div>
      )}
      {!readOnly && verifiedRef && s.interview?.id && <ClientAppointmentActions refCode={verifiedRef??s.ref} appointmentId={s.interview.id} initialAction={appointmentAction}/>} 
      <div>
        <h2 className="text-base font-bold text-[#E6C585]">File Updates / تحديثات الملف</h2>
        <ol className="mt-3 space-y-3 border-l border-[#C5A059]/40 pl-4">
          {s.history.map((item, index) => (
            <li key={`${item.updated_at}-${item.status}-${index}`}>
              <p className="text-sm font-medium text-white">{item.label}</p>
              <p className="text-xs text-slate-300">{dateTime(item.updated_at)}</p>
            </li>
          ))}
        </ol>
      </div>
      <div className="border-t border-white/20 pt-4"><p className="text-sm font-bold text-[#E6C585]">Contact the office / تواصل معنا</p><OfficeContact /></div>
    </section>
  );
}
