import { catalog, catalogVersion, options } from "@/lib/catalog";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Production-safe Amazon job option feed.
 * An office-supplied facility or shift pattern is not an available Amazon job.
 * Only officially sourced, verified active openings are returned as selectable.
 */
export async function GET() {
  const openingOptions = options.map((item) => ({
    site_code: item.site_code,
    site_name: item.site_name,
    site_address: item.site_address,
    city: item.city,
    job_id: item.job_id,
    job_title: item.job_title,
    employment_type: item.employment_type,
    shift_code: item.shift_code,
    shift_name: item.shift_name,
    days: item.days,
    hours: item.hours,
    pay: item.pay,
    availability: item.availability,
    source_url: item.source_url,
    last_verified_at: item.last_verified_at,
  }));
  return NextResponse.json({
    ok: true,
    state: "MI",
    catalog_version: catalogVersion,
    verified_available_count: openingOptions.length,
    openings: openingOptions,
    facility_preferences: catalog.facilities.filter((site) => site.state === "MI").map((site) => ({
      site_code: site.site_code,
      city: site.city,
      facility_name: site.facility_name,
      verification_status: site.verification_status,
      availability: site.current_availability,
    })),
    note: openingOptions.length
      ? "Select a verified, sourced opening. Published availability may change."
      : "No verified Amazon openings are available in the current catalog. Locations and shifts on the intake form are preferences only, not offers.",
  }, {
    status: 200,
    headers: { "cache-control": "public, max-age=60, stale-while-revalidate=120" },
  });
}
