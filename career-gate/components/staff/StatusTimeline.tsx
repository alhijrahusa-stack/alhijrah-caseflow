import { MAIN_PATH, STATUS_LABELS, TRANSITIONS, type Status } from "@/lib/domain";
import { dateTime } from "@/lib/format";

/**
 * Past steps come only from recorded status-change events (plus creation).
 * Expected next states come from the transition table; they carry no dates.
 */
export function StatusTimeline({ created, events, current }: {
  created: { at: string; status: Status };
  events: { at: string; from: Status; to: Status; by: string | null; override?: boolean }[];
  current: Status;
}) {
  const past = [{ status: created.status, at: created.at, by: null as string | null, override: false }, ...events.map((e) => ({ status: e.to, at: e.at, by: e.by, override: Boolean(e.override) }))];
  const history = past.slice(0, -1);
  const expected = TRANSITIONS[current].filter((s) => s !== "cancelled").sort((a, b) => MAIN_PATH.indexOf(a) - MAIN_PATH.indexOf(b));
  return (
    <ol className="living-timeline relative ml-2 border-l-2 border-cyan-300/25 pl-1 text-sm" data-testid="status-timeline">
      {history.map((p, i) => (
        <li key={i} className="living-timeline-event mb-4 ml-4 rounded-xl border border-white/10 bg-gradient-to-r from-cyan-300/[.07] to-transparent px-3 py-3 shadow-[0_8px_24px_rgba(0,0,0,.12)]">
          <span className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full bg-cyan-300 shadow-[0_0_15px_rgba(103,232,249,.65)]" aria-hidden="true" />
          <p>{STATUS_LABELS[p.status]}{p.override && <span className="ml-1 text-xs text-amber-700">(override)</span>}</p>
          <p className="text-xs text-slate-500">{dateTime(p.at)}{p.by ? ` · ${p.by}` : ""}</p>
        </li>
      ))}
      <li className="mb-3 ml-4" aria-current="step">
        <span className="living-timeline-current absolute -left-[9px] mt-0.5 h-4 w-4 rounded-full border-[3px] border-cyan-200 bg-sky-500 shadow-[0_0_22px_rgba(56,189,248,.75)]" aria-hidden="true" />
        <p className="font-semibold text-cyan-100">{STATUS_LABELS[current]}</p>
        <p className="text-xs text-slate-500">Current · since {dateTime(past[past.length - 1].at)}</p>
      </li>
      {expected.map((s) => (
        <li key={s} className="mb-2 ml-4 text-slate-400">
          <span className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 border-slate-300 bg-white" aria-hidden="true" />
          <p>{STATUS_LABELS[s]} <span className="text-xs">(possible next)</span></p>
        </li>
      ))}
    </ol>
  );
}
