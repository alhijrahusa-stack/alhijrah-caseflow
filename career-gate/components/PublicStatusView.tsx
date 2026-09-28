import { OfficeContact } from "@/components/OfficeContact";
import type { PublicStatus } from "@/lib/public-status";
import { dateOfInstant, dateTime, timeOnly } from "@/lib/format";

function InfoCard({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.045] p-4 backdrop-blur-xl">
      <dt className="text-[10px] font-semibold uppercase tracking-[.16em] text-cyan-300/75">{label}</dt>
      <dd className="mt-2 break-words text-sm font-semibold text-slate-100" data-testid={testId}>{value}</dd>
    </div>
  );
}

export function PublicStatusView({ s }: { s: PublicStatus }) {
  const location = s.location ? [s.location.site_name, s.location.address].filter(Boolean).join(" — ") : "—";
  const documentComplete = s.documents.status === "Complete";

  return (
    <section
      className="overflow-hidden rounded-[28px] border border-[#D4AF37]/25 bg-[#070F1E] text-slate-100 shadow-[0_30px_90px_rgba(2,8,23,.35)]"
      data-testid="status-page"
    >
      <div className="relative overflow-hidden border-b border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(212,175,55,.17),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(34,211,238,.12),transparent_42%),linear-gradient(135deg,#070F1E,#0B192C)] p-6 sm:p-8">
        <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-[#D4AF37]/5 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.24em] text-[#D4AF37]">CAREER GATE · FILE STATUS</p>
            <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">Application Status</h1>
            <p className="mt-2 text-sm text-slate-400">Live client file summary</p>
          </div>
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[.08] px-4 py-3 text-right">
            <p className="text-[9px] uppercase tracking-[.18em] text-emerald-300/70">Current Status</p>
            <p className="mt-1 text-sm font-bold text-emerald-300" data-testid="status-current-status">{s.status_label}</p>
          </div>
        </div>
        <div className="relative mt-6 flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-[#D4AF37]/25 bg-[#D4AF37]/[.08] px-3 py-1.5 font-mono text-xs text-[#F2D77D]" data-testid="status-reference">{s.ref}</span>
          <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${documentComplete ? "border-emerald-400/20 bg-emerald-400/[.07] text-emerald-300" : "border-amber-400/20 bg-amber-400/[.07] text-amber-300"}`}>Documents · {s.documents.status}</span>
        </div>
      </div>

      <div className="space-y-6 p-5 sm:p-7">
        <dl className="grid gap-3 sm:grid-cols-2">
          <InfoCard label="Client Name" value={s.full_name} />
          <InfoCard label="File Number" value={s.ref} />
          <InfoCard label="Date Filed" value={dateOfInstant(s.filed_at)} />
          <InfoCard label="Amazon Job Location" value={location} />
          <InfoCard label="Shift Days" value={s.shift?.days ?? "—"} />
          <InfoCard label="Shift Time" value={s.shift?.time ?? "—"} />
          <InfoCard label="Next Step" value={s.next_step} />
          <InfoCard label="Last Updated" value={dateTime(s.updated_at)} />
        </dl>

        {s.interview && (
          <section className="rounded-2xl border border-[#D4AF37]/20 bg-[#D4AF37]/[.045] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#D4AF37]">INTERVIEW</p>
                <h2 className="mt-1 text-lg font-semibold">Scheduled Interview</h2>
              </div>
              <span className="rounded-full border border-[#D4AF37]/25 px-3 py-1 text-[10px] font-semibold text-[#F2D77D]">Scheduled</span>
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <InfoCard label="Type" value={s.interview.type} />
              <InfoCard label="Date" value={dateOfInstant(s.interview.scheduled_at)} />
              <InfoCard label="Time" value={timeOnly(s.interview.scheduled_at)} />
              <InfoCard label="Location" value={s.interview.location ?? "—"} />
            </dl>
          </section>
        )}

        <section className="rounded-2xl border border-white/10 bg-white/[.025] p-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.18em] text-cyan-300/75">FILE UPDATES</p>
              <h2 className="mt-1 text-lg font-semibold">Status Timeline</h2>
            </div>
            <span className="font-mono text-[10px] text-slate-500">{s.history.length} update{s.history.length === 1 ? "" : "s"}</span>
          </div>
          <ol className="mt-5 space-y-0">
            {s.history.map((item, index) => (
              <li key={`${item.updated_at}-${item.status}-${index}`} className="relative grid grid-cols-[20px_1fr] gap-3 pb-5 last:pb-0">
                {index < s.history.length - 1 && <span className="absolute left-[9px] top-5 h-[calc(100%-8px)] w-px bg-gradient-to-b from-cyan-300/40 to-white/5" aria-hidden="true" />}
                <span className="relative mt-1 h-5 w-5 rounded-full border border-cyan-300/30 bg-cyan-300/[.08] shadow-[0_0_18px_rgba(34,211,238,.1)]" aria-hidden="true"><span className="absolute inset-[6px] rounded-full bg-cyan-300" /></span>
                <div>
                  <p className="text-sm font-semibold text-slate-100">{item.label}</p>
                  <p className="mt-1 text-xs text-slate-500">{dateTime(item.updated_at)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="rounded-2xl border border-white/10 bg-[#0B192C]/70 p-5">
          <p className="mb-2 text-sm font-semibold text-slate-200">Contact the office</p>
          <div className="text-slate-300"><OfficeContact /></div>
        </div>
      </div>
    </section>
  );
}
