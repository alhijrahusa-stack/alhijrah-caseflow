import { OfficeContact } from "@/components/OfficeContact";
import type { PublicStatus } from "@/lib/public-status";
import { dateOfInstant, dateOnly, dateTime, timeOnly } from "@/lib/format";

export function PublicStatusView({ s }: { s: PublicStatus }) {
  const location = s.location ? [s.location.site_name, s.location.address].filter(Boolean).join(" — ") : "—";
  const rows: { label: string; value: string; testId?: string }[] = [
    { label: "Client Name", value: s.full_name },
    { label: "File Number", value: s.ref },
    { label: "Date Filed", value: dateOfInstant(s.filed_at) },
    { label: "Location", value: location },
    { label: "Shift Days", value: s.shift?.days ?? "—" },
    { label: "Shift Time", value: s.shift?.time ?? "—" },
    { label: "Current Status", value: s.status_label, testId: "status-current-status" },
    { label: "Next Step", value: s.next_step, testId: "status-next-step" },
    { label: "Start Date", value: dateOnly(s.start_date), testId: "status-start-date" },
    { label: "Documents", value: s.documents.status },
    { label: "Last Updated", value: dateTime(s.updated_at) },
  ];

  return (
    <section className="space-y-6 rounded-lg border border-slate-200 bg-white p-6" data-testid="status-page">
      <div>
        <h1 className="text-xl font-semibold">Application Status</h1>
        <p className="mt-1 text-sm text-slate-500">Career Gate file status</p>
      </div>
      <dl className="grid grid-cols-3 gap-y-3 text-sm">
        {rows.map(({ label, value, testId }) => (
          <div key={label} className="contents">
            <dt className="text-slate-500">{label}</dt>
            <dd className="col-span-2 font-medium" data-testid={testId}>{value}</dd>
          </div>
        ))}
      </dl>
      {s.appointment && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4" data-testid="status-appointment">
          <h2 className="text-sm font-semibold">Appointment</h2>
          <dl className="mt-3 grid grid-cols-3 gap-y-2 text-sm">
            <dt className="text-slate-500">Type</dt><dd className="col-span-2 font-medium">{s.appointment.type}</dd>
            <dt className="text-slate-500">Date</dt><dd className="col-span-2 font-medium">{dateOfInstant(s.appointment.scheduled_at)}</dd>
            <dt className="text-slate-500">Time</dt><dd className="col-span-2 font-medium">{timeOnly(s.appointment.scheduled_at)}</dd>
            <dt className="text-slate-500">Location</dt><dd className="col-span-2 font-medium" data-testid="status-appointment-location">{s.appointment.location ?? "—"}</dd>
          </dl>
        </div>
      )}
      {s.interview && s.interview.scheduled_at !== s.appointment?.scheduled_at && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-sm font-semibold">Interview</h2>
          <dl className="mt-3 grid grid-cols-3 gap-y-2 text-sm">
            <dt className="text-slate-500">Type</dt><dd className="col-span-2 font-medium">{s.interview.type}</dd>
            <dt className="text-slate-500">Date</dt><dd className="col-span-2 font-medium">{dateOfInstant(s.interview.scheduled_at)}</dd>
            <dt className="text-slate-500">Time</dt><dd className="col-span-2 font-medium">{timeOnly(s.interview.scheduled_at)}</dd>
            <dt className="text-slate-500">Location</dt><dd className="col-span-2 font-medium">{s.interview.location ?? "—"}</dd>
          </dl>
        </div>
      )}
      <div>
        <h2 className="text-sm font-semibold">File Updates</h2>
        <ol className="mt-3 space-y-3 border-l border-slate-200 pl-4">
          {s.history.map((item, index) => (
            <li key={`${item.updated_at}-${item.status}-${index}`}>
              <p className="text-sm font-medium">{item.label}</p>
              <p className="text-xs text-slate-500">{dateTime(item.updated_at)}</p>
            </li>
          ))}
        </ol>
      </div>
      <div className="border-t border-slate-100 pt-3"><p className="text-sm font-medium">Contact the office</p><OfficeContact /></div>
    </section>
  );
}
