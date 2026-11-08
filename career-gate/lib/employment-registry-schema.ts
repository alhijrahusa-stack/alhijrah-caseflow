import { z } from "zod";
import { findWorksite } from "@/lib/worksite-change-schema";

/** The actual day is independently recorded; clients.start_date stays planned. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const EmploymentConfirmationInput = z.object({
  client_id: z.uuid(),
  operation_id: z.uuid(),
  expected_updated_at: z.string().min(1).max(100),
  actual_start_date: z.string().refine(isCalendarDate, "Choose a valid actual start date"),
  site_code: z.string().refine(code => Boolean(findWorksite(code)), "Choose a worksite in the system directory"),
  confirmation: z.literal(true, { error: "Confirm that the client actually started work" }),
});

export type EmploymentConfirmationCommand = z.infer<typeof EmploymentConfirmationInput>;
export type EmploymentConfirmation = {
  id: string; client_id: string; actual_start_date: string;
  site_code: string; site_name: string; site_address: string | null;
  job_id: string | null; job_title: string | null;
  shift_code: string | null; shift_name: string | null; shift_days: string | null; shift_hours: string | null;
  worksite_change_id: string | null; worksite_recorded_at: string | null;
  confirmed_by: string; confirmed_by_name: string; confirmed_at: string; operation_id: string;
};
