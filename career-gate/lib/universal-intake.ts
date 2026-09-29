import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { options, type Option, type Selection } from "@/lib/catalog";
import { withStaff, type StaffSession } from "@/lib/auth";
import { registry } from "@/lib/providers/config";
import { ProfileSchema, StatusSchema, issuesMessage } from "@/lib/schemas";
import { ActionError, insertClient } from "@/lib/service";
import type { IntakeRow } from "@/lib/intake-file";

const MAX_ROWS = 1000;

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
  status: "IMPORTED" | "DUPLICATE" | "REJECTED";
  ref?: string;
  client_id?: string;
  code?: string;
  message?: string;
};

export type IntakePreviewRow = {
  row: number;
  status: "VALID" | "DUPLICATE" | "REJECTED";
  full_name?: string;
  phone?: string;
  email?: string | null;
  site_code?: string | null;
  shift_code?: string | null;
  staff_code?: string | null;
  existing_ref?: string;
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

function normalizedEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function normalizedPhone(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
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

function previewProjection(prepared: PreparedRow): Omit<IntakePreviewRow, "status"> {
  const selected = prepared.primary[0];
  return {
    row: prepared.row,
    full_name: prepared.profile.full_name,
    phone: prepared.profile.phone,
    email: prepared.profile.email,
    site_code: selected?.site_code ?? null,
    shift_code: selected?.shift_code ?? null,
    staff_code: prepared.staffCode,
  };
}

export async function previewRows(session: StaffSession, rows: IntakeRow[]) {
  if (rows.length === 0) throw new ActionError("empty_import", "No data rows were found", 400);
  if (rows.length > MAX_ROWS) throw new ActionError("too_many_rows", `Import is limited to ${MAX_ROWS} rows`, 400);

  const preparedRows: PreparedRow[] = [];
  const results: IntakePreviewRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      preparedRows.push(prepareRow(rows[i], i));
    } catch (error) {
      results.push({
        row: i + 2,
        status: "REJECTED",
        code: "invalid_row",
        message: error instanceof Error ? error.message : "Invalid row",
      });
    }
  }

  const emailRows = new Map<string, number>();
  const phoneRows = new Map<string, number>();
  const fileDuplicates = new Map<number, string>();
  for (const prepared of preparedRows) {
    const email = normalizedEmail(prepared.profile.email);
    const phone = normalizedPhone(prepared.profile.phone);
    if (email) {
      const first = emailRows.get(email);
      if (first) fileDuplicates.set(prepared.row, `Duplicate email in source file; first appears on row ${first}`);
      else emailRows.set(email, prepared.row);
    }
    if (phone) {
      const first = phoneRows.get(phone);
      if (first) fileDuplicates.set(prepared.row, `Duplicate phone in source file; first appears on row ${first}`);
      else phoneRows.set(phone, prepared.row);
    }
  }

  const dbIdentity = await withStaff(session, async (tx) => {
    const emails = [...emailRows.keys()];
    const phones = [...phoneRows.keys()];
    const staffCodes = [...new Set(preparedRows.map((row) => row.staffCode?.toLowerCase()).filter((value): value is string => Boolean(value)))];
    const clients = emails.length || phones.length
      ? await tx`
          select ref,lower(trim(coalesce(email,''))) as email_norm,regexp_replace(coalesce(phone,''),'\D','','g') as phone_norm
          from clients
          where deleted_at is null
            and (
              lower(trim(coalesce(email,''))) = any(${tx.array(emails)}::text[])
              or regexp_replace(coalesce(phone,''),'\D','','g') = any(${tx.array(phones)}::text[])
            )`
      : [];
    const staff = staffCodes.length
      ? await tx`select lower(staff_code) as staff_code from staff where active and lower(staff_code)=any(${tx.array(staffCodes)}::text[])`
      : [];
    return {
      byEmail: new Map(clients.filter((row) => row.email_norm).map((row) => [String(row.email_norm), String(row.ref)])),
      byPhone: new Map(clients.filter((row) => row.phone_norm).map((row) => [String(row.phone_norm), String(row.ref)])),
      staffCodes: new Set(staff.map((row) => String(row.staff_code))),
    };
  });

  for (const prepared of preparedRows) {
    const base = previewProjection(prepared);
    const duplicateInFile = fileDuplicates.get(prepared.row);
    if (duplicateInFile) {
      results.push({ ...base, status: "DUPLICATE", code: "duplicate_source_row", message: duplicateInFile });
      continue;
    }
    if (prepared.staffCode && !dbIdentity.staffCodes.has(prepared.staffCode.toLowerCase())) {
      results.push({ ...base, status: "REJECTED", code: "invalid_staff_code", message: `Active staff code not found: ${prepared.staffCode}` });
      continue;
    }
    const email = normalizedEmail(prepared.profile.email);
    const phone = normalizedPhone(prepared.profile.phone);
    const existingRef = (email && dbIdentity.byEmail.get(email)) || dbIdentity.byPhone.get(phone);
    if (existingRef) {
      results.push({ ...base, status: "DUPLICATE", code: "duplicate_client", existing_ref: existingRef, message: `Existing client ${existingRef}` });
      continue;
    }
    results.push({ ...base, status: "VALID" });
  }

  results.sort((a, b) => a.row - b.row);
  return {
    total: rows.length,
    valid: results.filter((row) => row.status === "VALID").length,
    duplicates: results.filter((row) => row.status === "DUPLICATE").length,
    rejected: results.filter((row) => row.status === "REJECTED").length,
    results,
  };
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
      results.push({ row: i + 2, ok: false, status: "REJECTED", code: "invalid_row", message: error instanceof Error ? error.message : "Invalid row" });
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
      results.push({ row: prepared.row, ok: true, status: "IMPORTED", ref: created.ref, client_id: created.id });
    } catch (error) {
      if (error instanceof ActionError) {
        results.push({
          row: prepared.row,
          ok: false,
          status: error.code === "duplicate_client" ? "DUPLICATE" : "REJECTED",
          code: error.code,
          message: error.message,
        });
      } else {
        results.push({ row: prepared.row, ok: false, status: "REJECTED", code: "import_failed", message: error instanceof Error ? error.message : "Import failed" });
      }
    }
  }

  return {
    total: rows.length,
    created: results.filter((r) => r.ok).length,
    duplicates: results.filter((r) => r.status === "DUPLICATE").length,
    failed: results.filter((r) => r.status === "REJECTED").length,
    results,
  };
}

const OcrResult = z.object({
  clients: z.array(z.object({
    full_name: z.string().nullable(), phone: z.string().nullable(), email: z.string().nullable(), date_of_birth: z.string().nullable(),
    preferred_language: z.string().nullable(), street: z.string().nullable(), city: z.string().nullable(), state: z.string().nullable(),
    zip: z.string().nullable(), site_code: z.string().nullable(), job_id: z.string().nullable(), shift_code: z.string().nullable(),
  })).max(100),
});

const OCR_PROMPT = `Extract client application rows from this file. Return only values visibly present in the source. Do not infer, repair, guess, or complete missing data. One source row or application equals one clients item. Dates must be copied as YYYY-MM-DD only when the source supports that exact date. For Amazon assignment fields, return site_code, job_id, and shift_code only when those exact codes are visibly present. Otherwise return null.`;

export async function rowsFromImageOrPdf(bytes: Uint8Array, mimeType: string) {
  const cfg = registry.documentVision();
  if (!cfg.apiKey || !cfg.model) throw new ActionError("ocr_not_configured", "Document vision is NOT_CONFIGURED", 503);

  const openai = createOpenAI({ apiKey: cfg.apiKey });
  const binary = Buffer.from(bytes);
  const media = mimeType === "application/pdf"
    ? ({ type: "file", data: binary, mediaType: "application/pdf" } as const)
    : ({ type: "image", image: binary, mediaType: mimeType } as const);

  try {
    const result = await generateText({
      model: openai(cfg.model),
      output: Output.object({ schema: OcrResult }),
      temperature: 0,
      abortSignal: AbortSignal.timeout(45_000),
      messages: [{ role: "user", content: [{ type: "text", text: OCR_PROMPT }, media] }],
    });
    return result.output.clients.map((c) => ({
      full_name: c.full_name,
      phone: c.phone,
      email: c.email,
      date_of_birth: c.date_of_birth,
      preferred_language: c.preferred_language,
      street: c.street,
      city: c.city,
      state: c.state,
      zip: c.zip,
      site_code: c.site_code,
      job_id: c.job_id,
      shift_code: c.shift_code,
    })) satisfies IntakeRow[];
  } catch (error) {
    throw new ActionError("ocr_failed", error instanceof Error ? error.message : "Document extraction failed", 422);
  }
}
