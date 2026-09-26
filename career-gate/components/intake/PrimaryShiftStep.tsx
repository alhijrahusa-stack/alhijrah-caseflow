import { findJob, shifts } from "@/lib/catalog";
import { OptionList } from "./OptionList";
import type { StepProps } from "./types";

export function PrimaryShiftStep({ data, update }: StepProps) {
  const offered = findJob(data.city, data.site_code, data.job_code)?.shifts ?? [];
  return (
    <OptionList
      name="Primary shift"
      value={data.primary_shift}
      options={shifts
        .filter((s) => offered.includes(s.code))
        .map((s) => ({ value: s.code, label: s.label, hint: s.hours }))}
      onSelect={(primary_shift) =>
        update({
          primary_shift,
          backup_shift: data.backup_shift === primary_shift ? null : data.backup_shift,
        })
      }
    />
  );
}
