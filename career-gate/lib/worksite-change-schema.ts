import { z } from "zod";
import { catalog } from "@/lib/catalog";
import { LOCATION_DIRECTORY } from "@/lib/location-shift-options";

export const WORKSITE_OPTIONS: { code: string; name: string; address: string | null }[] = [
  ...LOCATION_DIRECTORY.map(site => ({ code: site.code, name: site.name, address: site.address })),
  ...catalog.facilities.filter(site => !LOCATION_DIRECTORY.some(item => item.code === site.site_code))
    .map(site => ({ code: site.site_code, name: site.facility_name ?? site.site_code, address: site.address })),
];
export const WORKSITE_TIMEZONE = "America/Detroit" as const;
export const findWorksite = (code: string) => WORKSITE_OPTIONS.find(site => site.code === code);
const weekdays = [
  ['SUN','Sunday','الأحد','الاحد'],['MON','Monday','الاثنين','الإثنين'],['TUE','Tuesday','الثلاثاء'],
  ['WED','Wednesday','الأربعاء','الاربعاء'],['THU','Thursday','الخميس'],['FRI','Friday','الجمعة'],['SAT','Saturday','السبت'],
] as const;
/** Explicit named days or an inclusive named range; never infer an unknown pattern. */
export function parseWorksiteDays(value: string): string[] | null {
  const day = (name: string) => weekdays.findIndex(aliases => aliases.some(alias => alias.toLowerCase() === name.trim().toLowerCase()));
  const range = value.trim().split(/\s*(?:–|—|-|\bto\b|إلى|الى)\s*/iu);
  if(range.length===2) {
    const first=day(range[0]),last=day(range[1]);if(first<0||last<0)return null;
    const out:string[]=[];for(let offset=0;offset<7;offset++){const index=(first+offset)%7;out.push(weekdays[index][0]);if(index===last)return out;}
    return null;
  }
  const tokens=value.trim().split(/[,،/+\s]+/u).filter(Boolean);
  const indices=tokens.map(day);if(!indices.length||indices.some(index=>index<0))return null;
  return [...new Set(indices)].map(index=>weekdays[index][0]);
}
const site = z.string().refine(code => Boolean(findWorksite(code)), "Choose a location in the system directory");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Choose a valid start date");
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use a valid local shift time");
const identity = { client_id: z.uuid(), operation_id: z.uuid(), expected_updated_at: z.string().min(1).max(100) };
const locations = { current_site_code: site, requested_site_code: site };
export const WorksiteChangeInput = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("save_request"), ...identity, ...locations }),
  z.object({ operation: z.literal("confirm"), ...identity, ...locations,
    final_site_code: site, shift_days: z.string().trim().min(1).max(200).refine(value=>parseWorksiteDays(value)!==null,'Use named shift days, for example Wednesday – Saturday'),
    shift_start: time, shift_end: time, new_start_date: date,
    confirmed_at: z.iso.datetime({ offset: true }),
  }),
  z.object({ operation: z.literal("retry_email"), ...identity, change_id: z.uuid() }),
]);
export type WorksiteChangeCommand = z.infer<typeof WorksiteChangeInput>;
export type WorksiteChangeRow = {
  id: string | null; client_id: string; ref: string; full_name: string; email: string | null;
  current_site_code: string | null; current_site_name: string | null; current_site_address: string | null;
  requested_site_code: string | null; requested_site_name: string | null; requested_site_address: string | null;
  final_site_code: string | null; final_site_name: string | null; final_site_address: string | null;
  status: "pending" | "confirmed"; shift_days: string | null; shift_start: string | null; shift_end: string | null;
  new_start_date: string | null; confirmed_at: string | null; recorded_at: string | null; confirmed_by_name: string | null;
  notification_id: string | null; notification_status: string | null; notification_recipient: string | null; sent_at: string | null; notification_error: string | null;
  operational_location: string; current_status: string; client_version: string;
};
export type WorksiteChangeData = {
  rows: WorksiteChangeRow[]; counts: { pending: number; confirmed: number }; total: number; page: number; page_size: number;
};
