import type { Option, Pay, Selection } from "@/lib/catalog";

type DisplayPay = { pay_status: string } & Partial<Omit<Pay, "pay_status">>;
type DisplayShift = {
  shift_code: string; shift_name?: string | null; days?: string | null;
  start_time?: string | null; end_time?: string | null; availability?: string | null; pay: DisplayPay;
};
export type DisplayFacility = { site_code: string; facility_name?: string | null; city?: string | null; address?: string | null };
type DisplayOpening = {
  source: string; status: string; site_code: string; job_id: string; title: string;
  employment_type?: string | null; source_url: string; last_verified_at: string; shifts?: readonly DisplayShift[];
};
type DisplayCatalog = { facilities?: readonly DisplayFacility[]; openings?: readonly DisplayOpening[] };

export const optionKey = (selection: Selection) => `${selection.site_code}|${selection.job_id}|${selection.shift_code}`;
export const jobKey = (siteCode: string, jobId: string) => `${siteCode}|${jobId}`;

function displayedPay(pay: DisplayPay): Pay | null {
  if (pay.pay_status !== "PUBLISHED" && pay.pay_status !== "NOT_PUBLISHED") return null;
  return {
    pay_status: pay.pay_status, pay_type: pay.pay_type ?? null,
    base_pay_min: pay.base_pay_min ?? null, base_pay_max: pay.base_pay_max ?? null,
    shift_differential: pay.shift_differential ?? null, surge_pay: pay.surge_pay ?? null,
    sign_on_bonus: pay.sign_on_bonus ?? null, display_pay: pay.display_pay ?? null,
    currency: pay.currency ?? null, pay_source_url: pay.pay_source_url ?? null,
    pay_verified_at: pay.pay_verified_at ?? null,
  };
}

/** Display data from the tracked catalog asset; write paths still use the
 * independently validated catalog module. No validator runs in the browser. */
export function catalogDisplayOptions(input: DisplayCatalog): Option[] {
  const facilities = new Map((input.facilities ?? []).map(site => [site.site_code, site]));
  const result: Option[] = [];
  const seen = new Set<string>();
  for (const opening of input.openings ?? []) {
    if (opening.status !== "AVAILABLE" || opening.source !== "AMAZON_OFFICIAL") continue;
    const facility = facilities.get(opening.site_code);
    if (!facility?.city) continue;
    for (const shift of opening.shifts ?? []) {
      const key = optionKey({ site_code: opening.site_code, job_id: opening.job_id, shift_code: shift.shift_code });
      if (seen.has(key)) throw new Error(`Duplicate catalog entry ${key}`);
      seen.add(key);
      const pay = displayedPay(shift.pay);
      if (!pay) continue;
      result.push({
        key, city: facility.city, site_code: opening.site_code,
        site_name: facility.facility_name ?? opening.site_code, site_address: facility.address ?? null,
        job_id: opening.job_id, job_title: opening.title, employment_type: opening.employment_type ?? null,
        shift_code: shift.shift_code, shift_name: shift.shift_name ?? null, days: shift.days ?? null,
        hours: shift.start_time && shift.end_time ? `${shift.start_time} – ${shift.end_time}` : shift.start_time ?? shift.end_time ?? null,
        pay: pay.pay_status === "PUBLISHED" ? pay.display_pay : null, pay_detail: pay,
        availability: shift.availability ?? null, source: opening.source,
        source_url: opening.source_url, last_verified_at: opening.last_verified_at,
      });
    }
  }
  return result;
}

