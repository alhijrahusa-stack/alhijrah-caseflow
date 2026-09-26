import { findCity } from "@/lib/catalog";
import { OptionList } from "./OptionList";
import type { StepProps } from "./types";

export function SiteStep({ data, update }: StepProps) {
  const sites = findCity(data.city)?.sites ?? [];
  return (
    <OptionList
      name="Site"
      value={data.site_code}
      options={sites.map((s) => ({ value: s.code, label: s.name, hint: s.address ?? s.code }))}
      onSelect={(site_code) =>
        site_code !== data.site_code &&
        update({ site_code, job_code: "", primary_shift: "", backup_shift: null })
      }
    />
  );
}
