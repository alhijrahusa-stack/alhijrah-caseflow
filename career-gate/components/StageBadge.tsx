import { STAGE_LABELS, type Stage } from "@/lib/workflow/engine";

const COLORS: Partial<Record<Stage, string>> = {
  new: "bg-sky-100 text-sky-800",
  hired: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  withdrawn: "bg-slate-200 text-slate-700",
};

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${COLORS[stage] ?? "bg-amber-100 text-amber-800"}`}>
      {STAGE_LABELS[stage] ?? stage}
    </span>
  );
}
