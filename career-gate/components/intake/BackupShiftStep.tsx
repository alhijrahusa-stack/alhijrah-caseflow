import { findJob, shifts } from "@/lib/catalog";
import { OptionList } from "./OptionList";
import type { StepProps } from "./types";

const NONE = "__none__";

export function BackupShiftStep({ data, update }: StepProps) {
  const offered = findJob(data.city, data.site_code, data.job_code)?.shifts ?? [];
  const options = shifts
    .filter((s) => offered.includes(s.code) && s.code !== data.primary_shift)
    .map((s) => ({ value: s.code, label: s.label, hint: s.hours }));
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        If your first choice fills up, which shift would you accept instead?
      </p>
      <OptionList
        name="Backup shift"
        value={data.backup_shift ?? NONE}
        options={[...options, { value: NONE, label: "No backup — first choice only" }]}
        onSelect={(v) => update({ backup_shift: v === NONE ? null : v })}
      />
    </div>
  );
}
