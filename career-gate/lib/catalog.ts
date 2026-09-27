import { z } from "zod";
import raw from "@/data/job-catalog.json";

// Canonical job catalog (data/job-catalog.json, schema v2).
//   facilities      FACILITY MASTER — a site can exist with no current opening.
//   shift_patterns  known operational patterns (reference only; never selectable).
//   openings        CURRENT AMAZON OPENINGS with shifts, pay and provenance.
// Only openings with status AVAILABLE from AMAZON_OFFICIAL sources at a known
// facility become selectable. Missing facts stay null; nothing is derived.

const Provenance = z.object({
  source_domain: z.enum(["amazon.jobs", "www.amazon.jobs", "hiring.amazon.com"]),
  source_url: z.url(),
  source_job_id: z.string().min(1),
  source_retrieved_at: z.string().min(1),
  last_verified_at: z.string().min(1),
});

const PaySchema = z
  .object({
    pay_status: z.enum(["PUBLISHED", "NOT_PUBLISHED"]),
    pay_type: z.string().nullable().default(null),
    base_pay_min: z.number().nullable().default(null),
    base_pay_max: z.number().nullable().default(null),
    shift_differential: z.string().nullable().default(null),
    surge_pay: z.string().nullable().default(null),
    sign_on_bonus: z.string().nullable().default(null),
    display_pay: z.string().nullable().default(null),
    currency: z.string().nullable().default(null),
    pay_source_url: z.url().nullable().default(null),
    pay_verified_at: z.string().nullable().default(null),
  })
  .refine((p) => p.pay_status === "NOT_PUBLISHED" || (p.display_pay && p.pay_source_url && p.pay_verified_at), {
    message: "Published pay needs display_pay, pay_source_url and pay_verified_at",
  });

const OpeningShiftSchema = z.object({
  shift_code: z.string().min(1),
  shift_name: z.string().nullable().default(null),
  days: z.string().nullable().default(null),
  start_time: z.string().nullable().default(null),
  end_time: z.string().nullable().default(null),
  hours_per_shift: z.number().nullable().default(null),
  hours_per_week: z.string().nullable().default(null),
  availability: z.string().nullable().default(null),
  pay: PaySchema,
});

const OpeningSchema = Provenance.extend({
  source: z.literal("AMAZON_OFFICIAL"),
  job_id: z.string().min(1),
  site_code: z.string().min(1),
  title: z.string().min(1),
  location: z.string().nullable().default(null),
  employment_type: z.string().nullable().default(null),
  schedule_type: z.string().nullable().default(null),
  seasonal_or_regular: z.string().nullable().default(null),
  start_date: z.string().nullable().default(null),
  appointment_information: z.string().nullable().default(null),
  requirements: z.array(z.string()).default([]),
  status: z.enum(["AVAILABLE", "CLOSED", "NOT_FOUND", "NOT_VERIFIED"]),
  shifts: z.array(OpeningShiftSchema).default([]),
});

const FacilitySchema = z.object({
  site_code: z.string().min(1),
  facility_type: z.string().nullable().default(null),
  facility_type_source: z.enum(["AMAZON_OFFICIAL", "OFFICE_PROVIDED"]).default("OFFICE_PROVIDED"),
  facility_name: z.string().nullable().default(null),
  city: z.string().nullable().default(null),
  address: z.string().nullable().default(null),
  state: z.string().default("MI"),
  zip: z.string().nullable().default(null),
  verification_status: z.enum(["VERIFIED", "NOT_VERIFIED"]),
  source_url: z.url().nullable().default(null),
  last_verified_at: z.string().nullable().default(null),
  current_availability: z.enum(["AVAILABLE", "NO_CURRENT_VERIFIED_OPENING", "NOT_VERIFIED"]),
});

const ShiftPatternSchema = z.object({
  pattern_code: z.string().min(1),
  facility_type: z.string().min(1),
  name: z.string().min(1),
  days: z.string().nullable().default(null),
  shift_length: z.string().nullable().default(null),
  source: z.literal("OFFICE_PROVIDED"),
  note: z.string().nullable().default(null),
});

const CatalogSchema = z.object({
  schema_version: z.literal(2),
  state: z.string().min(1),
  facilities: z.array(FacilitySchema).default([]),
  shift_patterns: z.array(ShiftPatternSchema).default([]),
  openings: z.array(OpeningSchema).default([]),
});

export type Catalog = z.infer<typeof CatalogSchema>;
export type Pay = z.infer<typeof PaySchema>;
export type Facility = z.infer<typeof FacilitySchema>;
export type Opening = z.infer<typeof OpeningSchema>;

/** One selectable site + current opening + shift combination. */
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
  shift_name: string | null;
  days: string | null;
  hours: string | null;
  /** Pay exactly as published, or null when Amazon did not publish it. */
  pay: string | null;
  pay_detail: Pay;
  availability: string | null;
  source: string;
  source_url: string;
  last_verified_at: string;
};

export type Selection = { site_code: string; job_id: string; shift_code: string };

export const optionKey = (s: Selection) => `${s.site_code}|${s.job_id}|${s.shift_code}`;
export const jobKey = (site_code: string, job_id: string) => `${site_code}|${job_id}`;

function hours(shift: { start_time: string | null; end_time: string | null }) {
  if (shift.start_time && shift.end_time) return `${shift.start_time} – ${shift.end_time}`;
  return shift.start_time ?? shift.end_time ?? null;
}

/** Selectable options: AVAILABLE official openings at a known facility with a city. */
export function activeOptions(catalog: Catalog): Option[] {
  const facilities = new Map(catalog.facilities.map((f) => [f.site_code, f]));
  const out: Option[] = [];
  const seen = new Set<string>();
  for (const o of catalog.openings) {
    if (o.status !== "AVAILABLE") continue;
    const f = facilities.get(o.site_code);
    if (!f || !f.city) continue;
    for (const sh of o.shifts) {
      const key = optionKey({ site_code: o.site_code, job_id: o.job_id, shift_code: sh.shift_code });
      if (seen.has(key)) throw new Error(`Duplicate catalog entry ${key}`);
      seen.add(key);
      out.push({
        key,
        city: f.city,
        site_code: o.site_code,
        site_name: f.facility_name ?? o.site_code,
        site_address: f.address,
        job_id: o.job_id,
        job_title: o.title,
        employment_type: o.employment_type,
        shift_code: sh.shift_code,
        shift_name: sh.shift_name,
        days: sh.days,
        hours: hours(sh),
        pay: sh.pay.pay_status === "PUBLISHED" ? sh.pay.display_pay : null,
        pay_detail: sh.pay,
        availability: sh.availability,
        source: o.source,
        source_url: o.source_url,
        last_verified_at: o.last_verified_at,
      });
    }
  }
  return out;
}

export const parseCatalog = (input: unknown) => CatalogSchema.safeParse(input);
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

/** Deterministic content version of the catalog (FNV-1a 64-bit over canonical JSON). */
export const catalogVersion: string = (() => {
  const text = JSON.stringify(catalog);
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `fnv1a64:${h.toString(16).padStart(16, "0")}`;
})();
