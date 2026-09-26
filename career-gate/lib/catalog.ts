import catalog from "@/data/amazon-michigan.json";

export type Shift = { code: string; label: string; hours: string };
export type Job = { code: string; title: string; payCentsPerHour: number | null; shifts: string[] };
export type Site = { code: string; name: string; address: string | null; jobs: Job[] };
export type City = { code: string; name: string; sites: Site[] };

export const shifts: Shift[] = catalog.shifts;
export const cities: City[] = catalog.cities;

export function findCity(code: string) {
  return cities.find((c) => c.code === code);
}

export function findSite(cityCode: string, siteCode: string) {
  return findCity(cityCode)?.sites.find((s) => s.code === siteCode);
}

export function findJob(cityCode: string, siteCode: string, jobCode: string) {
  return findSite(cityCode, siteCode)?.jobs.find((j) => j.code === jobCode);
}

export function shiftLabel(code: string | null | undefined) {
  if (!code) return "—";
  return shifts.find((s) => s.code === code)?.label ?? code;
}

/** Confirms the city → site → job → shift chain exists in the catalog. */
export function validateSelection(sel: {
  city: string;
  site_code: string;
  job_code: string;
  primary_shift: string;
  backup_shift?: string | null;
}): string | null {
  const job = findJob(sel.city, sel.site_code, sel.job_code);
  if (!job) return "Unknown city, site or job";
  if (!job.shifts.includes(sel.primary_shift)) return "Primary shift not offered for this job";
  if (sel.backup_shift) {
    if (sel.backup_shift === sel.primary_shift) return "Backup shift must differ from primary shift";
    if (!job.shifts.includes(sel.backup_shift)) return "Backup shift not offered for this job";
  }
  return null;
}
