import { STATUS_LABELS, type Status } from "@/lib/domain";
import { StaffLabel } from "@/components/staff/StaffLabel";

export function StatusBadge({ status }: { status: string }) {
  const s = status as Status;
  return (
    <span className="cg-status-pill" data-status={status}>
      <StaffLabel en={STATUS_LABELS[s] ?? status}/>
    </span>
  );
}
