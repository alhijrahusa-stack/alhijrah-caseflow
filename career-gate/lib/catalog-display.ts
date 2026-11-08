import raw from "@/data/job-catalog.json";
import { catalogDisplayOptions, type DisplayFacility } from "@/lib/catalog-option-model";

export { catalogDisplayOptions, jobKey, optionKey } from "@/lib/catalog-option-model";
export type { Option, Selection } from "@/lib/catalog";

/** Read-only projection of the tracked asset. Server writes continue to use
 * CatalogSchema and resolvePreferences from the validated catalog module. */
export const options = catalogDisplayOptions(raw);
const facilities: readonly DisplayFacility[] = raw.facilities;
export const catalogFacilities = facilities.map(site => ({
  site_code: site.site_code, facility_name: site.facility_name ?? null, address: site.address ?? null,
}));
