import { jobKey, options, type Option, type Selection } from "@/lib/catalog";

export type PrefState = {
  cities: string[];
  sites: string[];
  jobs: string[]; // site_code|job_id
  primary: string[]; // option keys, in selection order
  backup: string[];
};

export const emptyPrefs: PrefState = { cities: [], sites: [], jobs: [], primary: [], backup: [] };

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

export const allCities = () => uniq(options.map((o) => o.city)).sort();
export const sitesFor = (s: PrefState) =>
  uniq(options.filter((o) => s.cities.includes(o.city)).map((o) => o.site_code)).map(
    (code) => options.find((o) => o.site_code === code)!,
  );
export const jobsFor = (s: PrefState) =>
  uniq(options.filter((o) => s.sites.includes(o.site_code)).map((o) => jobKey(o.site_code, o.job_id))).map(
    (k) => options.find((o) => jobKey(o.site_code, o.job_id) === k)!,
  );
export const shiftsFor = (s: PrefState): Option[] => options.filter((o) => s.jobs.includes(jobKey(o.site_code, o.job_id)));

/** Drops any child selection whose parent is no longer selected. */
export function prune(s: PrefState): PrefState {
  const sites = s.sites.filter((code) => options.some((o) => o.site_code === code && s.cities.includes(o.city)));
  const jobs = s.jobs.filter((k) => options.some((o) => jobKey(o.site_code, o.job_id) === k && sites.includes(o.site_code)));
  const valid = new Set(options.filter((o) => jobs.includes(jobKey(o.site_code, o.job_id))).map((o) => o.key));
  const primary = s.primary.filter((k) => valid.has(k));
  const backup = s.backup.filter((k) => valid.has(k) && !primary.includes(k));
  return { cities: s.cities, sites, jobs, primary, backup };
}

export function toSelections(keys: string[]): Selection[] {
  return keys.map((k) => {
    const [site_code, job_id, shift_code] = k.split("|");
    return { site_code, job_id, shift_code };
  });
}

export const optionByKey = (k: string) => options.find((o) => o.key === k);
