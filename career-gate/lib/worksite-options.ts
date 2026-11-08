import { catalogFacilities } from "@/lib/catalog-display";
import { LOCATION_DIRECTORY } from "@/lib/location-shift-options";

type FacilityLocation = { site_code: string; facility_name?: string | null; address?: string | null };

/** Shared display projection. Server callers pass validated catalog facilities. */
export function buildWorksiteOptions(facilities: readonly FacilityLocation[]) {
  return [
    ...LOCATION_DIRECTORY.map(site => ({ code: site.code, name: site.name, address: site.address as string | null })),
    ...facilities.filter(site => !LOCATION_DIRECTORY.some(item => item.code === site.site_code))
      .map(site => ({ code: site.site_code, name: site.facility_name ?? site.site_code, address: site.address ?? null })),
  ];
}

export const WORKSITE_OPTIONS = buildWorksiteOptions(catalogFacilities);
export const WORKSITE_TIMEZONE = "America/Detroit" as const;
export const findWorksite = (code: string) => WORKSITE_OPTIONS.find(site => site.code === code);
