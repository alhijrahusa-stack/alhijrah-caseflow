import { createHash } from "node:crypto";
import { z } from "zod";
import { options, type Option, type Selection } from "@/lib/catalog";
import type { IntakeRow } from "@/lib/intake-file";
import { ProfileSchema, StatusSchema, issuesMessage } from "@/lib/schemas";

export const IMPORT_STATUSES = ["PENDING", "UNDER_REVIEW", "MISSING_DOCUMENT", "APPROVED_FILE"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];
export const IMPORT_SOURCE_TYPES = ["csv", "xlsx", "google_sheets", "mobile", "legacy"] as const;
export type ImportSourceType = (typeof IMPORT_SOURCE_TYPES)[number];

export const SMART_IMPORT_LIMITS = Object.freeze({
  maxRows: 1000,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalUploadBytes: 25 * 1024 * 1024,
  maxFiles: 10,
  maxCellLength: 4000,
  maxRawTextLength: 10000,
  queuePageSize: 50,
});

type FieldDefinition = { key: string; label: string; aliases: readonly string[]; required?: boolean };

export const IMPORT_FIELD_REGISTRY = [
  { key: "full_name", label: "Full Name", required: true, aliases: ["full_name", "full name", "name", "client_name", "client name", "الاسم", "الاسم الكامل"] },
  { key: "phone", label: "Phone", required: true, aliases: ["phone", "phone_number", "phone number", "mobile", "telephone", "رقم الهاتف", "الهاتف"] },
  { key: "email", label: "Email", aliases: ["email", "email_address", "email address", "البريد", "البريد الالكتروني", "البريد الإلكتروني"] },
  { key: "date_of_birth", label: "Date of Birth", aliases: ["date_of_birth", "date of birth", "dob", "birth_date", "birth date", "تاريخ الميلاد"] },
  { key: "preferred_language", label: "Preferred Language", aliases: ["preferred_language", "preferred language", "language", "اللغة"] },
  { key: "street", label: "Street", aliases: ["street", "address", "street_address", "street address", "العنوان"] },
  { key: "city", label: "City", aliases: ["city", "المدينة"] },
  { key: "state", label: "State", aliases: ["state", "الولاية"] },
  { key: "zip", label: "ZIP", aliases: ["zip", "zipcode", "zip_code", "zip code", "postal code", "الرمز البريدي"] },
  { key: "appointment_availability", label: "Appointment Availability", aliases: ["appointment_availability", "appointment availability", "availability", "موعد", "المواعيد"] },
  { key: "amazon_worked_before", label: "Worked at Amazon Before", aliases: ["amazon_worked_before", "amazon worked before", "worked_at_amazon", "worked at amazon"] },
  { key: "amazon_worked_from", label: "Amazon Worked From", aliases: ["amazon_worked_from", "amazon worked from"] },
  { key: "amazon_worked_to", label: "Amazon Worked To", aliases: ["amazon_worked_to", "amazon worked to"] },
  { key: "amazon_applied_before", label: "Applied to Amazon Before", aliases: ["amazon_applied_before", "amazon applied before", "applied_before", "applied before"] },
  { key: "amazon_application_email", label: "Amazon Application Email", aliases: ["amazon_application_email", "amazon application email", "amazon_email", "amazon email"] },
  { key: "currently_amazon", label: "Currently at Amazon", aliases: ["currently_amazon", "currently amazon"] },
  { key: "via_agency", label: "Via Agency", aliases: ["via_agency", "via agency"] },
  { key: "employment_kind", label: "Employment Kind", aliases: ["employment_kind", "employment kind"] },
  { key: "company", label: "Company", aliases: ["company", "employer", "company_name", "company name"] },
  { key: "job_title", label: "Job Title", aliases: ["job_title", "job title", "title"] },
  { key: "employment_from", label: "Employment From", aliases: ["employment_from", "employment from", "job_from"] },
  { key: "employment_to", label: "Employment To", aliases: ["employment_to", "employment to", "job_to"] },
  { key: "site_code", label: "Site Code", aliases: ["site_code", "site code", "site", "location", "amazon_location", "amazon location", "work_location", "work location", "الموقع"] },
  { key: "job_id", label: "Job ID", aliases: ["job_id", "job id", "amazon_job_id", "amazon job id", "job"] },
  { key: "shift_code", label: "Shift Code", aliases: ["shift_code", "shift code", "shift", "shift_name", "shift name", "الشفت", "الوردية"] },
  { key: "staff_code", label: "Staff Code", aliases: ["staff_code", "staff code", "staff_id", "staff id", "employee_code", "employee code", "كود الموظف"] },
  { key: "status", label: "Client Status", aliases: ["status", "client_status", "client status", "الحالة"] },
  { key: "next_step", label: "Next Step", aliases: ["next_step", "next step", "next action", "الخطوة التالية"] },
  { key: "initial_note", label: "Initial Note", aliases: ["initial_note", "initial note", "note", "notes", "ملاحظات", "ملاحظة"] },
] as const satisfies readonly FieldDefinition[];

export const CANONICAL_IMPORT_HEADERS = IMPORT_FIELD_REGISTRY.map((field) => field.key);
export const IMPORT_SCHEMA_VERSION = "2026-10-04.1";
export const IMPORT_TEMPLATE_ID = "career-gate-client-import";
export const IMPORT_SCHEMA_HASH = createHash("sha256")
  .update(JSON.stringify(IMPORT_FIELD_REGISTRY.map((field) => ({ key: field.key, required: "required" in field && field.required === true }))))
  .digest("hex");

type RegistryKey = (typeof IMPORT_FIELD_REGISTRY)[number]["key"];

export type PreparedImportDraft = {
  profile: z.output<typeof ProfileSchema>;
  primary: Selection[];
  backup: Selection[];
  status: z.output<typeof StatusSchema>;
  next_step: string | null;
  staff_code: string | null;
  initial_note: string | null;
};

export type ImportPreviewRow = {
  row: number;
  result: "VALID" | "DUPLICATE" | "INVALID";
  identity: "NEW" | "POSSIBLE_DUPLICATE" | "EXISTING_CLIENT";
  full_name: string | null;
  phone: string | null;
  email: string | null;
  site: string | null;
  job: string | null;
  shift: string | null;
  message: string | null;
  existing_client_id: string | null;
  existing_client_ref: string | null;
  raw: IntakeRow;
  draft: PreparedImportDraft | null;
};

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[\s_\-./\\]+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim();
}

const ALIASES = Object.fromEntries(
  IMPORT_FIELD_REGISTRY.map((field) => [field.key, new Set(field.aliases.map(normalizeKey))]),
) as Record<RegistryKey, Set<string>>;

export function pickImportValue(row: IntakeRow, field: RegistryKey) {
  for (const [header, value] of Object.entries(row)) {
    if (value != null && ALIASES[field].has(normalizeKey(header))) return value.trim();
  }
  return null;
}

function optional(value: string | null) {
  const clean = value?.trim();
  return clean ? clean.slice(0, SMART_IMPORT_LIMITS.maxCellLength) : null;
}

function normalizeLanguage(value: string | null) {
  const v = value?.trim().toLowerCase();
  if (!v) return "en";
  if (["arabic", "العربية", "عربي", "ar"].includes(v)) return "ar";
  if (["english", "الانجليزية", "الإنجليزية", "en"].includes(v)) return "en";
  return v;
}

function parseBoolean(value: string | null) {
  const v = value?.trim().toLowerCase();
  if (!v) return null;
  if (["yes", "y", "true", "1", "نعم"].includes(v)) return true;
  if (["no", "n", "false", "0", "لا"].includes(v)) return false;
  return null;
}

function optionMatchesToken(option: Option, token: string, field: "site" | "job" | "shift") {
  const t = token.trim().toLowerCase();
  if (field === "site") {
    return [option.site_code, option.site_name, option.site_address, option.city]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.trim().toLowerCase() === t);
  }
  if (field === "job") return option.job_id.trim().toLowerCase() === t;
  return [option.shift_code, option.shift_name]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.trim().toLowerCase() === t);
}

function resolveSelection(row: IntakeRow): Selection[] {
  const site = optional(pickImportValue(row, "site_code"));
  const job = optional(pickImportValue(row, "job_id"));
  const shift = optional(pickImportValue(row, "shift_code"));
  if (!site && !job && !shift) return [];

  let candidates = options;
  if (site) candidates = candidates.filter((option) => optionMatchesToken(option, site, "site"));
  if (job) candidates = candidates.filter((option) => optionMatchesToken(option, job, "job"));
  if (shift) candidates = candidates.filter((option) => optionMatchesToken(option, shift, "shift"));
  const matches = [...new Map(candidates.map((option) => [option.key, option])).values()];
  if (matches.length === 0) throw new Error("No active Amazon catalog option matches the imported location/job/shift fields");
  if (matches.length > 1) throw new Error("Imported location/job/shift is ambiguous; include exact site_code, job_id and shift_code");
  return [{ site_code: matches[0].site_code, job_id: matches[0].job_id, shift_code: matches[0].shift_code }];
}

export function prepareImportDraft(row: IntakeRow): PreparedImportDraft {
  const employmentTitle = optional(pickImportValue(row, "job_title"));
  const employmentCompany = optional(pickImportValue(row, "company"));
  const employmentKindRaw = optional(pickImportValue(row, "employment_kind"));
  const employmentKind = employmentKindRaw?.toLowerCase().replace(/[ -]/g, "_") === "self_employed" ? "self_employed" : "company";
  const employment = employmentTitle || employmentCompany
    ? [{
        employment_kind: employmentKind,
        company: employmentKind === "self_employed" ? null : employmentCompany,
        job_title: employmentTitle ?? "",
        from_date: optional(pickImportValue(row, "employment_from")),
        to_date: optional(pickImportValue(row, "employment_to")),
      }]
    : [];

  const profile = ProfileSchema.safeParse({
    full_name: pickImportValue(row, "full_name") ?? "",
    phone: pickImportValue(row, "phone") ?? "",
    email: optional(pickImportValue(row, "email")),
    date_of_birth: optional(pickImportValue(row, "date_of_birth")),
    preferred_language: normalizeLanguage(pickImportValue(row, "preferred_language")),
    street: optional(pickImportValue(row, "street")),
    city: optional(pickImportValue(row, "city")),
    state: optional(pickImportValue(row, "state")),
    zip: optional(pickImportValue(row, "zip")),
    appointment_availability: optional(pickImportValue(row, "appointment_availability")),
    amazon_worked_before: parseBoolean(pickImportValue(row, "amazon_worked_before")),
    amazon_worked_from: optional(pickImportValue(row, "amazon_worked_from")),
    amazon_worked_to: optional(pickImportValue(row, "amazon_worked_to")),
    amazon_applied_before: parseBoolean(pickImportValue(row, "amazon_applied_before")),
    amazon_application_email: optional(pickImportValue(row, "amazon_application_email")),
    currently_amazon: parseBoolean(pickImportValue(row, "currently_amazon")),
    via_agency: parseBoolean(pickImportValue(row, "via_agency")),
    employment_history: employment,
  });
  if (!profile.success) throw new Error(issuesMessage(profile.error));

  const rawStatus = optional(pickImportValue(row, "status")) ?? "new_intake";
  const status = StatusSchema.safeParse(rawStatus);
  if (!status.success) throw new Error(`status: ${status.error.issues[0]?.message ?? "invalid status"}`);

  return {
    profile: profile.data,
    primary: resolveSelection(row),
    backup: [],
    status: status.data,
    next_step: optional(pickImportValue(row, "next_step")),
    staff_code: optional(pickImportValue(row, "staff_code")),
    initial_note: optional(pickImportValue(row, "initial_note")),
  };
}

export function importRowSummary(row: IntakeRow) {
  return {
    full_name: optional(pickImportValue(row, "full_name")),
    phone: optional(pickImportValue(row, "phone")),
    email: optional(pickImportValue(row, "email")),
    site: optional(pickImportValue(row, "site_code")),
    job: optional(pickImportValue(row, "job_id")),
    shift: optional(pickImportValue(row, "shift_code")),
  };
}

export function sourceHash(input: unknown) {
  return createHash("sha256").update(typeof input === "string" ? input : JSON.stringify(input)).digest("hex");
}

export function requiredMissingFromDraft(value: unknown) {
  const parsed = z.object({ profile: z.unknown() }).safeParse(value);
  if (!parsed.success) return ["profile"];
  const profile = ProfileSchema.safeParse(parsed.data.profile);
  return profile.success ? [] : [...new Set(profile.error.issues.map((issue) => String(issue.path[0] ?? "profile")))];
}
