import { STATUS_LABELS, type Status } from "@/lib/domain";

export function StatusBadge({ status }: { status: string }) {
  const s = status as Status;
  return (
    <span className="cg-status-pill" data-status={status}>
      {STATUS_LABELS[s] ?? status}
    </span>
  );
}
