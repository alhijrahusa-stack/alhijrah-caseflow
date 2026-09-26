import { cities } from "@/lib/catalog";
import { OptionList } from "./OptionList";
import type { StepProps } from "./types";

export function CityStep({ data, update }: StepProps) {
  return (
    <OptionList
      name="City"
      value={data.city}
      options={cities.map((c) => ({ value: c.code, label: c.name, hint: `${c.sites.length} site(s)` }))}
      onSelect={(city) =>
        city !== data.city &&
        update({ city, site_code: "", job_code: "", primary_shift: "", backup_shift: null })
      }
    />
  );
}
