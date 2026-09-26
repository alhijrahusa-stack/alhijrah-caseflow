import { STATUS_LABELS, type Status } from "@/lib/domain";

const TONE: Partial<Record<Status, string>> = {
  new_intake: "bg-sky-100 text-sky-800",
  needs_review: "bg-amber-100 text-amber-800",
  ready_for_first_day: "bg-emerald-100 text-emerald-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-slate-200 text-slate-600",
};

export function StatusBadge({ status }: { status: string }) {
  const s = status as Status;
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE[s] ?? "bg-indigo-100 text-indigo-800"}`}>
      {STATUS_LABELS[s] ?? status}
    </span>
  );
}
