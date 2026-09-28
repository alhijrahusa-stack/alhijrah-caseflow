import "server-only";
import { z } from "zod";
import { options, type Option, type Selection } from "@/lib/catalog";
import { withStaff, type StaffSession } from "@/lib/auth";
import { geminiExtract } from "@/lib/providers/gemini";
import { ProfileSchema, StatusSchema, issuesMessage } from "@/lib/schemas";
import { ActionError, insertClient } from "@/lib/service";
import type { IntakeRow } from "@/lib/intake-file";

const MAX_ROWS = 1000;
const MAX_GOOGLE_SHEET_BYTES = 10 * 1024 * 1024;

const aliases = {
  full_name: ["full_name", "full name", "name", "client_name", "client name", "الاسم", "الاسم الكامل"],
  phone: ["phone", "phone_number", "phone number", "mobile", "telephone", "رقم الهاتف", "الهاتف"],
  email: ["email", "email_address", "email address", "البريد", "البريد الالكتروني", "البريد الإلكتروني"],
  date_of_birth: ["date_of_birth", "date of birth", "dob", "birth_date", "birth date", "تاريخ الميلاد"],
  preferred_language: ["preferred_language", "preferred language", "language", "اللغة"],
  street: ["street", "address", "street_address", "street address", "العنوان"],
  city: ["city", "المدينة"],
  state: ["state", "الولاية"],
  zip: ["zip", "zipcode", "zip_code", "zip code", "postal code", "الرمز البريدي"],
  appointment_availability: ["appointment_availability", "appointment availability", "availability", "موعد", "المواعيد"],
  site: ["site_code", "site code", "site", "location", "amazon_location", "amazon location", "work_location", "work location", "الموقع"],
  job_id: ["job_id", "job id", "amazon_job_id", "amazon job id", "job"],
  shift: ["shift_code", "shift code", "shift", "shift_name", "shift name", "الشفت", "الوردية"],
  staff_code: ["staff_code", "staff code", "staff_id", "staff id", "employee_code", "employee code", "كود الموظف"],
  status: ["status", "client_status", "client status", "الحالة"],
  next_step: ["next_step", "next step", "next action", "الخطوة التالية"],
} as const;

type AliasKey = keyof typeof aliases;

type PreparedRow = {
  row: number;
  source: IntakeRow;
  profile: z.output<typeof ProfileSchema>;
  primary: Selection[];
  status: z.output<typeof StatusSchema>;
  nextStep: string | null;
  staffCode: string | null;
};

export type IntakeResult = {
  row: number;
  ok: boolean;
  ref?: string;
  client_id?: string;
  code?: string;
  message?: string;
};

function key(value: string) {
  return value.trim().toLowerCase().replace(/[\s_\-./\\]+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim();
}

const normalizedAliases = Object.fromEntries(
  Object.entries(aliases).map(([name, values]) => [name, new Set(values.map(key))]),
) as Record<AliasKey, Set<string>>;

function pick(row: IntakeRow, name: AliasKey) {
  for (const [header, value] of Object.entries(row)) {
    if (value != null && normalizedAliases[name].has(key(header))) return value.trim();
  }
  return null;
}

function optional(value: string | null) {
  const v = value?.trim();
  return v ? v : null;
}

function normalizeLanguage(value: string | null) {
  const v = value?.trim().toLowerCase();
  if (!v) return "en";
  if (["arabic", "العربية", "عربي"].includes(v)) return "ar";
  if (["english", "الانجليزية", "الإنجليزية"].includes(v)) return "en";
  return v;
}

function optionMatchesToken(option: Option, token: string, field: "site" | "job" | "shift") {
  const t = token.trim().toLowerCase();
  if (field === "site") {
    return [option.site_code, option.site_name, option.site_address, option.city]
      .filter((v): v is string => Boolean(v))
      .some((v) => v.trim().toLowerCase() === t);
  }
  if (field === "job") return option.job_id.trim().toLowerCase() === t;
  return [option.shift_code, option.shift_name]
    .filter((v): v is string => Boolean(v))
    .some((v) => v.trim().toLowerCase() === t);
}

function resolveSelection(row: IntakeRow): Selection[] {
  const site = optional(pick(row, "site"));
  const job = optional(pick(row, "job_id"));
  const shift = optional(pick(row, "shift"));
  if (!site && !job && !shift) return [];

  let candidates = options;
  if (site) candidates = candidates.filter((o) => optionMatchesToken(o, site, "site"));
  if (job) candidates = candidates.filter((o) => optionMatchesToken(o, job, "job"));
  if (shift) candidates = candidates.filter((o) => optionMatchesToken(o, shift, "shift"));

  const unique = new Map(candidates.map((o) => [o.key, o]));
  const matches = [...unique.values()];
  if (matches.length === 0) throw new Error("No active Amazon catalog option matches the imported location/job/shift fields");
  if (matches.length > 1) throw new Error("Imported location/job/shift is ambiguous; include exact site_code, job_id and shift_code");
  const match = matches[0];
  return [{ site_code: match.site_code, job_id: match.job_id, shift_code: match.shift_code }];
}

function prepareRow(row: IntakeRow, index: number): PreparedRow {
  const rawStatus = optional(pick(row, "status")) ?? "new_intake";
  const status = StatusSchema.safeParse(rawStatus);
  if (!status.success) throw new Error(`status: ${status.error.issues[0]?.message ?? "invalid status"}`);

  const profile = ProfileSchema.safeParse({
    full_name: pick(row, "full_name") ?? "",
    phone: pick(row, "phone") ?? "",
    email: optional(pick(row, "email")),
    date_of_birth: optional(pick(row, "date_of_birth")),
    preferred_language: normalizeLanguage(pick(row, "preferred_language")),
    street: optional(pick(row, "street")),
    city: optional(pick(row, "city")),
    state: optional(pick(row, "state")),
    zip: optional(pick(row, "zip")),
    appointment_availability: optional(pick(row, "appointment_availability")),
    employment_history: [],
  });
  if (!profile.success) throw new Error(issuesMessage(profile.error));

  return {
    row: index + 2,
    source: row,
    profile: profile.data,
    primary: resolveSelection(row),
    status: status.data,
    nextStep: optional(pick(row, "next_step")),
    staffCode: optional(pick(row, "staff_code")),
  };
}

async function resolveStaff(tx: Parameters<Parameters<typeof withStaff>[1]>[0], code: string | null) {
  if (!code) return null;
  const [staff] = await tx`select id from staff where active and lower(coalesce(staff_code,''))=lower(${code}) limit 1`;
  if (!staff) throw new ActionError("invalid_staff_code", `Active staff code not found: ${code}`, 400);
  return staff.id as string;
}

export async function importRows(session: StaffSession, rows: IntakeRow[], source: string, traceId: string) {
  if (rows.length === 0) throw new ActionError("empty_import", "No data rows were found", 400);
  if (rows.length > MAX_ROWS) throw new ActionError("too_many_rows", `Import is limited to ${MAX_ROWS} rows`, 400);

  const results: IntakeResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    let prepared: PreparedRow;
    try {
      prepared = prepareRow(rows[i], i);
    } catch (error) {
      results.push({ row: i + 2, ok: false, code: "invalid_row", message: error instanceof Error ? error.message : "Invalid row" });
      continue;
    }

    try {
      const created = await withStaff(session, async (tx) => {
        const assignedStaff = await resolveStaff(tx, prepared.staffCode);
        const client = await insertClient(tx, {
          source: "staff_manual",
          profile: prepared.profile,
          primary: prepared.primary,
          backup: [],
          status: prepared.status,
          nextStep: prepared.nextStep,
          assignedStaff,
          createdBy: session.staff.id,
          communicationConsent: false,
        }, { staffId: session.staff.id, traceId });
        await tx`
          insert into activity_log(client_id,action,staff_id,entity_type,entity_id,new_value,trace_id)
          values(${client.id},'client_imported',${session.staff.id},'client',${client.id},
                 ${tx.json({ import_source: source, source_row: prepared.row, auto_dispatched: prepared.primary.length === 1 })},${traceId})`;
        return client;
      });
      results.push({ row: prepared.row, ok: true, ref: created.ref, client_id: created.id });
    } catch (error) {
      if (error instanceof ActionError) {
        results.push({ row: prepared.row, ok: false, code: error.code, message: error.message });
      } else {
        results.push({ row: prepared.row, ok: false, code: "import_failed", message: error instanceof Error ? error.message : "Import failed" });
      }
    }
  }

  return {
    total: rows.length,
    created: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

const OCR_SCHEMA = {
  type: "OBJECT",
  properties: {
    clients: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          full_name: { type: "STRING", nullable: true },
          phone: { type: "STRING", nullable: true },
          email: { type: "STRING", nullable: true },
          date_of_birth: { type: "STRING", nullable: true },
          preferred_language: { type: "STRING", nullable: true },
          street: { type: "STRING", nullable: true },
          city: { type: "STRING", nullable: true },
          state: { type: "STRING", nullable: true },
          zip: { type: "STRING", nullable: true },
          site_code: { type: "STRING", nullable: true },
          job_id: { type: "STRING", nullable: true },
          shift_code: { type: "STRING", nullable: true },
        },
        required: ["full_name", "phone", "email", "date_of_birth", "preferred_language", "street", "city", "state", "zip", "site_code", "job_id", "shift_code"],
      },
    },
  },
  required: ["clients"],
};

const OcrResult = z.object({
  clients: z.array(z.object({
    full_name: z.string().nullable(), phone: z.string().nullable(), email: z.string().nullable(), date_of_birth: z.string().nullable(),
    preferred_language: z.string().nullable(), street: z.string().nullable(), city: z.string().nullable(), state: z.string().nullable(),
    zip: z.string().nullable(), site_code: z.string().nullable(), job_id: z.string().nullable(), shift_code: z.string().nullable(),
  })).max(100),
});

const OCR_PROMPT = `Extract client application rows from this file. Return only values visibly present in the source. Do not infer, repair, guess, or complete missing data. One source row or application equals one clients item. Dates must be copied as YYYY-MM-DD only when the source supports that exact date. For Amazon assignment fields, return site_code, job_id, and shift_code only when those exact codes are visibly present. Otherwise return null.`;

export async function rowsFromImageOrPdf(bytes: Uint8Array, mimeType: string) {
  let lastMessage = "Document extraction failed";
  for (const model of ["fast", "escalation"] as const) {
    const result = await geminiExtract({ model, mimeType, data: bytes, prompt: OCR_PROMPT, responseSchema: OCR_SCHEMA });
    if (!result.ok) {
      lastMessage = result.message;
      if (result.code === "NOT_CONFIGURED") throw new ActionError("ocr_not_configured", result.message, 503);
      continue;
    }
    let json: unknown;
    try { json = JSON.parse(result.text); } catch { lastMessage = "OCR provider returned invalid JSON"; continue; }
    const parsed = OcrResult.safeParse(json);
    if (!parsed.success) { lastMessage = parsed.error.issues[0]?.message ?? "OCR output failed validation"; continue; }
    return parsed.data.clients.map((c) => ({
      "full_name": c.full_name,
      "phone": c.phone,
      "email": c.email,
      "date_of_birth": c.date_of_birth,
      "preferred_language": c.preferred_language,
      "street": c.street,
      "city": c.city,
      "state": c.state,
      "zip": c.zip,
      "site_code": c.site_code,
      "job_id": c.job_id,
      "shift_code": c.shift_code,
    })) satisfies IntakeRow[];
  }
  throw new ActionError("ocr_failed", lastMessage, 422);
}

export function googleSheetCsvUrl(input: string) {
  let url: URL;
  try { url = new URL(input); } catch { throw new ActionError("invalid_sheet_url", "Invalid Google Sheets URL", 400); }
  if (url.hostname !== "docs.google.com") throw new ActionError("invalid_sheet_url", "Only docs.google.com Google Sheets URLs are accepted", 400);
  const match = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (!match) throw new ActionError("invalid_sheet_url", "Google Sheets document ID is missing", 400);
  const gid = url.searchParams.get("gid") ?? url.hash.match(/gid=(\d+)/)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${encodeURIComponent(gid)}`;
}

export async function fetchGoogleSheet(input: string) {
  const url = googleSheetCsvUrl(input);
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) throw new ActionError("sheet_unavailable", "Google Sheet must be accessible with the provided link", 422);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_GOOGLE_SHEET_BYTES) throw new ActionError("sheet_too_large", "Google Sheet exceeds the 10 MB import limit", 413);
  const text = await res.text();
  if (Buffer.byteLength(text, "utf8") > MAX_GOOGLE_SHEET_BYTES) throw new ActionError("sheet_too_large", "Google Sheet exceeds the 10 MB import limit", 413);
  return text;
}
