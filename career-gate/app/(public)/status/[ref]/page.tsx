import type { Metadata } from "next";
import { STATUS_LABELS, type Status } from "@/lib/domain";
import { dateOfInstant, dateOnly, dateTime, timeOnly } from "@/lib/format";
import { publicStatus } from "@/lib/public-status";

export const metadata: Metadata = { title: "Application status", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function StatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { ref } = await params;
  const { t } = await searchParams;
  const s = await publicStatus(decodeURIComponent(ref).toUpperCase(), t);

  if (!s) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h1 className="mb-2 text-xl font-semibold">Status not available</h1>
        <p className="text-sm text-slate-600">
          Open the Track Status link you received after submitting. If you no longer have it, contact the office.
        </p>
      </section>
    );
  }

  const rows: [string, string][] = [
    ["Reference", s.ref],
    ["Current Status", STATUS_LABELS[s.status as Status] ?? s.status],
    ["Next Step", s.next_step],
    ["Appointment Date", s.appointment ? dateOfInstant(s.appointment.scheduled_at) : "None scheduled"],
    ["Appointment Time", s.appointment ? timeOnly(s.appointment.scheduled_at) : "—"],
    ["Appointment Location", s.appointment?.location ?? "—"],
    ["Start Date", dateOnly(s.start_date)],
    ["Last Updated", dateTime(s.updated_at)],
  ];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6" data-testid="status-page">
      <h1 className="mb-4 text-xl font-semibold">Application status</h1>
      <dl className="grid grid-cols-3 gap-y-3 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="col-span-2 font-medium" data-testid={`status-${k.toLowerCase().replace(/ /g, "-")}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
