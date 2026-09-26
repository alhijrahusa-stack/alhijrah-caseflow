import { findSite } from "@/lib/catalog";
import { money } from "@/lib/format";
import { OptionList } from "./OptionList";
import type { StepProps } from "./types";

export function JobStep({ data, update }: StepProps) {
  const jobs = findSite(data.city, data.site_code)?.jobs ?? [];
  return (
    <OptionList
      name="Job"
      value={data.job_code}
      options={jobs.map((j) => ({
        value: j.code,
        label: j.title,
        hint: j.payCentsPerHour != null ? `${money(j.payCentsPerHour)}/hr posted` : "Pay to be confirmed",
      }))}
      onSelect={(job_code) =>
        job_code !== data.job_code && update({ job_code, primary_shift: "", backup_shift: null })
      }
    />
  );
}
