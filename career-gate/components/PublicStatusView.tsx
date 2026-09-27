import { OfficeContact } from "@/components/OfficeContact";
import type { PublicStatus } from "@/lib/public-status";
import { dateOfInstant, dateOnly, dateTime, timeOnly } from "@/lib/format";

/** The only client-facing projection of a file. Shared by /status and the staff preview. */
export function PublicStatusView({ s }: { s: PublicStatus }) {
  const rows: [string, string][] = [
    ["Reference", s.ref],
    ["Name", s.first_name],
    ["Current Status", s.status_label],
    ["Next Step", s.next_step],
    ["Appointment Date", s.appointment ? dateOfInstant(s.appointment.scheduled_at) : "None scheduled"],
    ["Appointment Time", s.appointment ? timeOnly(s.appointment.scheduled_at) : "—"],
    ["Appointment Location", s.appointment?.location ?? "—"],
    ["Start Date", dateOnly(s.start_date)],
    ["Last Updated", dateTime(s.updated_at)],
  ];
  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6" data-testid="status-page">
      <h1 className="text-xl font-semibold">Application status</h1>
      <dl className="grid grid-cols-3 gap-y-3 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="col-span-2 font-medium" data-testid={`status-${k.toLowerCase().replace(/ /g, "-")}`}>{v}</dd>
          </div>
        ))}
      </dl>
      {s.pending_actions.length > 0 && (
        <div>
          <p className="text-sm font-medium">Actions needed from you</p>
          <ul className="list-disc pl-5 text-sm" data-testid="status-pending-actions">{s.pending_actions.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      <div className="border-t border-slate-100 pt-3"><p className="text-sm font-medium">Contact the office</p><OfficeContact /></div>
    </section>
  );
}
