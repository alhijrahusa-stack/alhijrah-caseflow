import { z } from "zod";
import { LANGUAGES, STATUSES } from "@/lib/domain";

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine(
  (v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)),
  "Invalid date",
);
const optionalDate = isoDate.nullable().optional().or(z.literal("")).transform((v) => (v ? v : null));

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return null;
}

export const Phone = z.string().transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p) {
    ctx.addIssue({ code: "custom", message: "Enter a 10-digit US phone number" });
    return z.NEVER;
  }
  return p;
});

export const SelectionSchema = z.object({
  site_code: z.string().min(1).max(100),
  job_id: z.string().min(1).max(100),
  shift_code: z.string().min(1).max(100),
});

export const EmploymentSchema = z
  .object({
    company: trimmed(200).min(1, "Company is required"),
    job_title: trimmed(200).min(1, "Job title is required"),
    from_date: optionalDate,
    to_date: optionalDate,
  })
  .refine((e) => !e.from_date || !e.to_date || e.to_date >= e.from_date, {
    message: "End date is before start date",
    path: ["to_date"],
  });

/** Personal, Amazon-history and availability fields shared by every entry point. */
export const ProfileSchema = z
  .object({
    full_name: trimmed(160).min(2, "Full name is required"),
    phone: Phone,
    email: z.email("Invalid email").max(200).nullable().optional().or(z.literal("")).transform((v) => (v ? v.toLowerCase() : null)),
    date_of_birth: optionalDate,
    preferred_language: z.enum(Object.keys(LANGUAGES) as [keyof typeof LANGUAGES]).default("en"),
    street: optionalText(200),
    city: optionalText(100),
    state: optionalText(40),
    zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "ZIP must be 5 digits").nullable().optional().or(z.literal("")).transform((v) => (v ? v : null)),
    appointment_availability: optionalText(1000),
    amazon_worked_before: z.boolean().nullable().optional().transform((v) => v ?? null),
    amazon_worked_from: optionalDate,
    amazon_worked_to: optionalDate,
    amazon_applied_before: z.boolean().nullable().optional().transform((v) => v ?? null),
    amazon_application_email: z.email("Invalid Amazon email").max(200).nullable().optional().or(z.literal("")).transform((v) => (v ? v.toLowerCase() : null)),
    employment_history: z.array(EmploymentSchema).max(10).default([]),
  })
  .transform((p) => ({
    ...p,
    // Conditional answers are dropped when their parent answer is not "Yes".
    amazon_worked_from: p.amazon_worked_before ? p.amazon_worked_from : null,
    amazon_worked_to: p.amazon_worked_before ? p.amazon_worked_to : null,
    amazon_application_email: p.amazon_applied_before ? p.amazon_application_email : null,
  }))
  .superRefine((p, ctx) => {
    if (p.date_of_birth && p.date_of_birth > new Date().toISOString().slice(0, 10)) {
      ctx.addIssue({ code: "custom", path: ["date_of_birth"], message: "Date of birth is in the future" });
    }
    if (p.amazon_worked_from && p.amazon_worked_to && p.amazon_worked_to < p.amazon_worked_from) {
      ctx.addIssue({ code: "custom", path: ["amazon_worked_to"], message: "Amazon end date is before start date" });
    }
  });
export type Profile = z.output<typeof ProfileSchema>;

export const StatusSchema = z.enum(STATUSES);

/** Formats zod issues as a single readable message. */
export function issuesMessage(error: z.ZodError) {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}
