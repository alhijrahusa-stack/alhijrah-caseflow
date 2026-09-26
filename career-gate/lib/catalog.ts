import { z } from "zod";
import raw from "@/data/job-catalog.json";

// Every fact below comes from data/job-catalog.json. Missing facts stay null;
// nothing is derived or defaulted.
const ShiftSchema = z.object({
  shift_code: z.string().min(1),
  days: z.string().nullable().optional(),
  start_time: z.string().nullable().optional(),
  end_time: z.string().nullable().optional(),
  pay: z.string().nullable().optional(),
  active: z.boolean().default(true),
  source: z.string().nullable().optional(),
  last_verified_at: z.string().nullable().optional(),
});

const JobSchema = z.object({
  job_id: z.string().min(1),
  job_title: z.string().min(1),
  employment_type: z.string().nullable().optional(),
  active: z.boolean().default(true),
  shifts: z.array(ShiftSchema).default([]),
});

const SiteSchema = z.object({
  city: z.string().min(1),
  site_code: z.string().min(1),
  site_name: z.string().min(1),
  address: z.string().nullable().optional(),
  active: z.boolean().default(true),
  source: z.string().nullable().optional(),
  last_verified_at: z.string().nullable().optional(),
  jobs: z.array(JobSchema).default([]),
});

const CatalogSchema = z.object({
  state: z.string().min(1),
  source: z.string().nullable().optional(),
  sites: z.array(SiteSchema).default([]),
});

export type CatalogShift = z.infer<typeof ShiftSchema>;
export type CatalogJob = z.infer<typeof JobSchema>;
export type CatalogSite = z.infer<typeof SiteSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;

/** One selectable site + job + shift combination. */
export type Option = {
  key: string;
  city: string;
  site_code: string;
  site_name: string;
  site_address: string | null;
  job_id: string;
  job_title: string;
  employment_type: string | null;
  shift_code: string;
  days: string | null;
  hours: string | null;
  pay: string | null;
  source: string | null;
  last_verified_at: string | null;
};

export type Selection = { site_code: string; job_id: string; shift_code: string };

export const optionKey = (s: Selection) => `${s.site_code}|${s.job_id}|${s.shift_code}`;
export const jobKey = (site_code: string, job_id: string) => `${site_code}|${job_id}`;

function hours(shift: CatalogShift) {
  if (shift.start_time && shift.end_time) return `${shift.start_time} – ${shift.end_time}`;
  return shift.start_time ?? shift.end_time ?? null;
}

/** Flattens active site → job → shift triples. Duplicate keys are rejected. */
export function activeOptions(catalog: Catalog): Option[] {
  const out: Option[] = [];
  const seen = new Set<string>();
  for (const site of catalog.sites) {
    if (!site.active) continue;
    for (const job of site.jobs) {
      if (!job.active) continue;
      for (const shift of job.shifts) {
        if (!shift.active) continue;
        const key = optionKey({ site_code: site.site_code, job_id: job.job_id, shift_code: shift.shift_code });
        if (seen.has(key)) throw new Error(`Duplicate catalog entry ${key}`);
        seen.add(key);
        out.push({
          key,
          city: site.city,
          site_code: site.site_code,
          site_name: site.site_name,
          site_address: site.address ?? null,
          job_id: job.job_id,
          job_title: job.job_title,
          employment_type: job.employment_type ?? null,
          shift_code: shift.shift_code,
          days: shift.days ?? null,
          hours: hours(shift),
          pay: shift.pay ?? null,
          source: shift.source ?? site.source ?? catalog.source ?? null,
          last_verified_at: shift.last_verified_at ?? site.last_verified_at ?? null,
        });
      }
    }
  }
  return out;
}

export const catalog: Catalog = CatalogSchema.parse(raw);
export const options: Option[] = activeOptions(catalog);
const byKey = new Map(options.map((o) => [o.key, o]));

export function findOption(sel: Selection): Option | undefined {
  return byKey.get(optionKey(sel));
}

/**
 * Resolves primary and backup selections against the active catalog.
 * Returns ordered rows (primary first) or an error message.
 */
export function resolvePreferences(
  primary: Selection[],
  backup: Selection[],
  source: Option[] = options,
): { ok: true; rows: (Option & { rank: "primary" | "backup"; preference_order: number })[] } | { ok: false; error: string } {
  const index = new Map(source.map((o) => [o.key, o]));
  const seen = new Set<string>();
  const rows: (Option & { rank: "primary" | "backup"; preference_order: number })[] = [];
  for (const [rank, list] of [["primary", primary], ["backup", backup]] as const) {
    for (const sel of list) {
      const opt = index.get(optionKey(sel));
      if (!opt) return { ok: false, error: `Not an active catalog option: ${optionKey(sel)}` };
      if (seen.has(opt.key)) {
        return { ok: false, error: `${opt.site_name} · ${opt.job_title} · ${opt.shift_code} is selected more than once` };
      }
      seen.add(opt.key);
      rows.push({ ...opt, rank, preference_order: rows.length + 1 });
    }
  }
  return { ok: true, rows };
}
