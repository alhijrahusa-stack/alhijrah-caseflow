"use client";

import { jobKey, type Option } from "@/lib/catalog";
import { MultiSelect } from "./MultiSelect";
import { allCities, jobsFor, optionByKey, prune, shiftsFor, sitesFor, type PrefState } from "./preferences";

type P = { value: PrefState; onChange: (v: PrefState) => void };

const set = (p: P, patch: Partial<PrefState>) => p.onChange(prune({ ...p.value, ...patch }));

export const shiftLabel = (o: Option) =>
  `${o.shift_name ? `${o.shift_name} (${o.shift_code})` : o.shift_code}${o.days ? ` · ${o.days}` : ""}${o.hours ? ` · ${o.hours}` : ""}`;

export function CityStep(p: P) {
  return (
    <MultiSelect name="City" value={p.value.cities} onChange={(cities) => set(p, { cities })}
      choices={allCities().map((c) => ({ value: c, label: c }))} />
  );
}

export function SiteStep(p: P) {
  return (
    <MultiSelect name="Site" value={p.value.sites} onChange={(sites) => set(p, { sites })}
      choices={sitesFor(p.value).map((o) => ({
        value: o.site_code,
        label: `${o.site_name} (${o.site_code})`,
        hint: [o.city, o.site_address].filter(Boolean).join(" · "),
      }))} />
  );
}

export function JobStep(p: P) {
  return (
    <MultiSelect name="Job" value={p.value.jobs} onChange={(jobs) => set(p, { jobs })}
      choices={jobsFor(p.value).map((o) => ({
        value: jobKey(o.site_code, o.job_id),
        label: o.job_title,
        hint: [o.site_name, o.employment_type].filter(Boolean).join(" · "),
      }))} />
  );
}

export function ShiftStep(p: P & { rank: "primary" | "backup" }) {
  const other = p.rank === "primary" ? p.value.backup : p.value.primary;
  return (
    <MultiSelect
      name={p.rank === "primary" ? "Primary shift" : "Backup shift"}
      numbered
      value={p.value[p.rank]}
      onChange={(v) => set(p, { [p.rank]: v })}
      disabled={(k) => (p.rank === "backup" && other.includes(k) ? "Already a primary choice" : null)}
      choices={shiftsFor(p.value).map((o) => ({
        value: o.key,
        label: `${o.job_title} — ${shiftLabel(o)}`,
        hint: `${o.site_name} · Amazon job ${o.job_id}${o.pay ? ` · Pay: ${o.pay}` : " · Pay: NOT_PUBLISHED"}${o.pay_detail.shift_differential ? ` · Differential: ${o.pay_detail.shift_differential}` : ""}`,
      }))}
    />
  );
}

/** Ordered list of primary then backup selections with catalog pay. */
export function PreferenceSummary({ value }: { value: PrefState }) {
  const rows = [
    ...value.primary.map((k) => ({ k, rank: "Primary" })),
    ...value.backup.map((k) => ({ k, rank: "Backup" })),
  ];
  if (!rows.length) return <p className="text-sm text-slate-500">No shifts selected.</p>;
  return (
    <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
      {rows.map(({ k, rank }, i) => {
        const o = optionByKey(k)!;
        return (
          <li key={k} className="flex items-start gap-3 px-4 py-3">
            <span className="w-6 text-right font-semibold text-slate-400">{i + 1}</span>
            <span className="flex-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{rank}</span>
              <span className="block font-medium">{o.job_title} — {shiftLabel(o)}</span>
              <span className="block text-slate-500">{o.site_name} ({o.site_code}), {o.city}</span>
            </span>
            <span className="whitespace-nowrap font-medium">{o.pay ?? "Pay not published"}</span>
          </li>
        );
      })}
    </ol>
  );
}
