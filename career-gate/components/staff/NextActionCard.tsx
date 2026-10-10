import Link from "next/link";
import type { ClientNextAction } from "@/lib/next-action";

const tone = {
  critical: "border-red-400/30 bg-red-400/5 text-red-200",
  high: "border-amber-300/30 bg-amber-300/5 text-amber-100",
  normal: "border-sky-300/20 bg-sky-300/5 text-sky-100",
  none: "border-emerald-300/20 bg-emerald-300/5 text-emerald-100",
} as const;

export function NextActionCard({ action }: { action: ClientNextAction }) {
  return (
    <section className={`rounded-2xl border p-5 ${tone[action.urgency]}`} aria-labelledby="next-action-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[.2em] opacity-70">Deterministic Next Action</p>
          <h2 id="next-action-heading" className="mt-2 text-xl font-semibold text-slate-50">{action.next_safe_action}</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">{action.supporting_reason}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/10 bg-black/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide">Owner · {action.action_owner}</span>
          <span className="rounded-full border border-white/10 bg-black/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide">{action.urgency}</span>
          {action.target && (
            <Link
              href={`?tab=${action.target.tab}#${action.target.anchor}`}
              className="rounded-xl border border-white/15 bg-white/[.06] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[.11] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              {action.target.label}
            </Link>
          )}
        </div>
      </div>
      {(action.due_at || action.blockers.length > 0) && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {action.due_at && (
            <div className="rounded-xl border border-white/10 bg-black/10 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Due</p>
              <p className="mt-1 text-sm text-slate-100">{new Date(action.due_at).toLocaleString("en-US", { timeZone: "America/Detroit" })}</p>
            </div>
          )}
          {action.blockers.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-black/10 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Blocker</p>
              <p className="mt-1 text-sm text-slate-100">{action.blockers[0].label}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
