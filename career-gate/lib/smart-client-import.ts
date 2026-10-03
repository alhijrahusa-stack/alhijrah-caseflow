import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { options, type Option, type Selection } from "@/lib/catalog";
import { withStaff, type StaffSession } from "@/lib/auth";
import { sha256Hex } from "@/lib/crypto";
import { DOC_TYPES } from "@/lib/domain";
import { readUpload, safeFileName } from "@/lib/files";
import { enqueue } from "@/lib/jobs";
import { ProfileSchema, SelectionSchema, StatusSchema, issuesMessage } from "@/lib/schemas";
import { ActionError, findClientIdentityMatches, insertClient, logActivity } from "@/lib/service";
import { removeObject, uploadObject } from "@/lib/storage";
import { rowsFromImageOrPdf } from "@/lib/universal-intake";
import type { IntakeRow } from "@/lib/intake-file";

export const IMPORT_STATUSES = ["PENDING", "UNDER_REVIEW", "MISSING_DOCUMENT", "APPROVED_FILE"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];
export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_MOBILE_FILES = 10;
export const MAX_RAW_TEXT = 12_000;

const IMPORT_ALIASES = {
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

type AliasKey = keyof typeof IMPORT_ALIASES;

function key(value: string) {
  return value.trim().toLowerCase().replace(/[\s_\-./\\]+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim();
}

const normalizedAliases = Object.fromEntries(
  Object.entries(IMPORT_ALIASES).map(([name, values]) => [name, new Set(values.map(key))]),
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
  if (field === "site") return [option.site_code, option.site_name, option.site_address, option.city].filter(Boolean).some((v) => String(v).trim().toLowerCase() === t);
  if (field === "job") return option.job_id.trim().toLowerCase() === t;
  return [option.shift_code, option.shift_name].filter(Boolean).some((v) => String(v).trim().toLowerCase() === t);
}

function resolveSelection(row: IntakeRow): { primary: Selection[]; issue: string | null } {
  const site = optional(pick(row, "site"));
  const job = optional(pick(row, "job_id"));
  const shift = optional(pick(row, "shift"));
  if (!site && !job && !shift) return { primary: [], issue: null };
  let candidates = options;
  if (site) candidates = candidates.filter((o) => optionMatchesToken(o, site, "site"));
  if (job) candidates = candidates.filter((o) => optionMatchesToken(o, job, "job"));
  if (shift) candidates = candidates.filter((o) => optionMatchesToken(o, shift, "shift"));
  const matches = [...new Map(candidates.map((o) => [o.key, o])).values()];
  if (matches.length === 0) return { primary: [], issue: "No active catalog option matches the imported site/job/shift" };
  if (matches.length > 1) return { primary: [], issue: "Imported site/job/shift is ambiguous" };
  return { primary: [{ site_code: matches[0].site_code, job_id: matches[0].job_id, shift_code: matches[0].shift_code }], issue: null };
}

export const CanonicalImportDraftSchema = z.object({
  profile: ProfileSchema,
  primary: z.array(SelectionSchema).max(20).default([]),
  backup: z.array(SelectionSchema).max(20).default([]),
  status: StatusSchema.default("new_intake"),
  nextStep: z.string().trim().max(500).nullable().default(null),
  staffCode: z.string().trim().max(100).nullable().default(null),
});

export type CanonicalImportDraft = z.output<typeof CanonicalImportDraftSchema>;

function mappedFromRow(row: IntakeRow) {
  const selection = resolveSelection(row);
  const rawProfile = {
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
  };
  const raw = {
    profile: rawProfile,
    primary: selection.primary,
    backup: [],
    status: optional(pick(row, "status")) ?? "new_intake",
    nextStep: optional(pick(row, "next_step")),
    staffCode: optional(pick(row, "staff_code")),
  };
  const parsed = CanonicalImportDraftSchema.safeParse(raw);
  const missing = new Set<string>();
  const conflicts: string[] = [];
  if (selection.issue) conflicts.push(selection.issue);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path.join(".") || "record";
      if (issue.message.toLowerCase().includes("required") || issue.code === "invalid_type") missing.add(field);
      else conflicts.push(`${field}: ${issue.message}`);
    }
  }
  return {
    mapped: parsed.success ? parsed.data : raw,
    valid: parsed.success && conflicts.length === 0,
    missing_fields: [...missing],
    conflicts,
    profile: parsed.success ? parsed.data.profile : null,
  };
}

function sourceType(value: string) {
  const v = value.toLowerCase();
  if (v.includes("google")) return "GOOGLE_SHEETS" as const;
  if (v.includes("xlsx")) return "XLSX" as const;
  if (v.includes("mobile")) return "MOBILE" as const;
  return "CSV" as const;
}

async function existingIdentitySet(session: StaffSession, prepared: ReturnType<typeof mappedFromRow>[]) {
  const emails = [...new Set(prepared.map((p) => p.profile?.email).filter((v): v is string => Boolean(v)))];
  const phones = [...new Set(prepared.map((p) => p.profile?.phone).filter((v): v is string => Boolean(v)))];
  if (!emails.length && !phones.length) return new Set<string>();
  return withStaff(session, async (tx) => {
    const rows = await tx`
      select lower(trim(coalesce(email,''))) as email,
             regexp_replace(coalesce(phone,''),'\D','','g') as phone
      from clients
      where deleted_at is null
        and (lower(trim(coalesce(email,''))) = any(${emails}) or regexp_replace(coalesce(phone,''),'\D','','g') = any(${phones}))`;
    const out = new Set<string>();
    for (const row of rows) {
      if (row.email) out.add(`e:${String(row.email)}`);
      if (row.phone) out.add(`p:${String(row.phone)}`);
    }
    return out;
  });
}

export async function stageRows(session: StaffSession, rows: IntakeRow[], source: string, traceId: string, metadata: Record<string, unknown> = {}) {
  if (!rows.length) throw new ActionError("empty_import", "No data rows were found", 400);
  if (rows.length > MAX_IMPORT_ROWS) throw new ActionError("too_many_rows", `Import is limited to ${MAX_IMPORT_ROWS} rows`, 400);
  const prepared = rows.map(mappedFromRow);
  const existing = await existingIdentitySet(session, prepared);
  const kind = sourceType(source);
  const batchId = randomUUID();
  const sourceHash = typeof metadata.source_hash === "string" ? metadata.source_hash : null;
  const results = await withStaff(session, async (tx) => {
    await tx`insert into client_import_batches(id,source_type,source_file_hash,created_by,metadata)
             values(${batchId},${kind},${sourceHash},${session.staff.id},${tx.json(metadata as never)})`;
    const staged: { row:number; case_id:string; status:"VALID"|"DUPLICATE"|"INVALID"; message:string|null }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const p = prepared[i];
      const duplicate = Boolean(p.profile && ((p.profile.email && existing.has(`e:${p.profile.email}`)) || existing.has(`p:${p.profile.phone}`)));
      const rowStatus = duplicate ? "DUPLICATE" : p.valid ? "VALID" : "INVALID";
      const conflicts = duplicate ? [...p.conflicts, "Existing active client matches this phone or email"] : p.conflicts;
      const id = randomUUID();
      await tx`
        insert into client_import_cases(
          id,batch_id,source_type,source_row,status,raw_input,mapped_draft,missing_fields,conflicts,field_evidence,
          verification_result,created_by
        ) values (
          ${id},${batchId},${kind},${i + 2},'PENDING',${tx.json(rows[i] as never)},${tx.json(p.mapped as never)},
          ${tx.json(p.missing_fields as never)},${tx.json(conflicts as never)},'[]'::jsonb,
          ${tx.json({ stage_result: rowStatus, trace_id: traceId } as never)},${session.staff.id}
        )`;
      staged.push({ row: i + 2, case_id: id, status: rowStatus, message: duplicate ? "Existing client match" : p.valid ? null : [...p.missing_fields, ...conflicts].join("; ") });
    }
    return staged;
  });
  return {
    batch_id: batchId,
    total: results.length,
    valid: results.filter((r) => r.status === "VALID").length,
    duplicate: results.filter((r) => r.status === "DUPLICATE").length,
    invalid: results.filter((r) => r.status === "INVALID").length,
    results,
  };
}

function mergeRows(rows: IntakeRow[]) {
  const merged: IntakeRow = {};
  const conflicts: string[] = [];
  const keys = new Set(rows.flatMap((row) => Object.keys(row)));
  for (const k of keys) {
    const values = [...new Set(rows.map((r) => r[k]?.trim()).filter((v): v is string => Boolean(v)))];
    if (values.length === 1) merged[k] = values[0];
    else if (values.length > 1) conflicts.push(`${k}: conflicting source values`);
  }
  return { merged, conflicts };
}

async function extractRawText(text: string) {
  if (!text.trim()) return [] as IntakeRow[];
  try {
    return await rowsFromImageOrPdf(new TextEncoder().encode(text.slice(0, MAX_RAW_TEXT)), "text/plain");
  } catch {
    return [] as IntakeRow[];
  }
}

export async function stageMobileImport(session: StaffSession, notes: string, files: File[], traceId: string) {
  if (!notes.trim() && files.length === 0) throw new ActionError("invalid_input", "Add notes or at least one file", 400);
  if (notes.length > MAX_RAW_TEXT) throw new ActionError("invalid_input", `Notes are limited to ${MAX_RAW_TEXT} characters`, 400);
  if (files.length > MAX_MOBILE_FILES) throw new ActionError("too_many_files", `Maximum ${MAX_MOBILE_FILES} files`, 400);

  const batchId = randomUUID();
  const caseId = randomUUID();
  const uploaded: { id:string; path:string; file_name:string; mime:string; size:number; sha256:string; extraction:unknown }[] = [];
  const sourceRows: IntakeRow[] = [];
  const rawRows = await extractRawText(notes);
  sourceRows.push(...rawRows.slice(0, 1));

  try {
    for (const file of files) {
      const read = await readUpload(file);
      if ("error" in read) throw new ActionError("invalid_file", `${file.name}: ${read.error}`, 400);
      const id = randomUUID();
      const ext = read.mime === "application/pdf" ? "pdf" : read.mime.split("/")[1];
      const path = `imports/${caseId}/${id}/original.${ext}`;
      await uploadObject(path, read.bytes, read.mime);
      let extraction: unknown = { status: "REVIEW_REQUIRED" };
      try {
        const rows = await rowsFromImageOrPdf(read.bytes, read.mime);
        extraction = { status: "EXTRACTED", rows };
        if (rows[0]) sourceRows.push(rows[0]);
      } catch (error) {
        extraction = { status: "REVIEW_REQUIRED", error: error instanceof Error ? error.message.slice(0, 200) : "Extraction unavailable" };
      }
      uploaded.push({ id, path, file_name: safeFileName(file.name), mime: read.mime, size: read.bytes.byteLength, sha256: sha256Hex(read.bytes), extraction });
    }

    const merged = mergeRows(sourceRows);
    const prepared = mappedFromRow(merged.merged);
    const conflicts = [...prepared.conflicts, ...merged.conflicts];
    await withStaff(session, async (tx) => {
      await tx`insert into client_import_batches(id,source_type,created_by,metadata)
               values(${batchId},'MOBILE',${session.staff.id},${tx.json({ file_count: files.length, has_notes: Boolean(notes.trim()) } as never)})`;
      await tx`
        insert into client_import_cases(
          id,batch_id,source_type,source_row,status,raw_input,mapped_draft,missing_fields,conflicts,field_evidence,
          verification_result,created_by
        ) values (
          ${caseId},${batchId},'MOBILE',1,'PENDING',${tx.json({ notes: notes.trim() || null } as never)},
          ${tx.json(prepared.mapped as never)},${tx.json(prepared.missing_fields as never)},${tx.json(conflicts as never)},
          ${tx.json(sourceRows.map((row, index) => ({ source: index === 0 && notes.trim() ? "raw_text" : "document", values: row })) as never)},
          ${tx.json({ stage_result: prepared.valid && conflicts.length === 0 ? "VALID" : "REVIEW_REQUIRED", trace_id: traceId } as never)},${session.staff.id}
        )`;
      for (const doc of uploaded) {
        await tx`insert into client_import_documents(id,import_case_id,storage_reference,original_filename,mime_type,size_bytes,sha256,detected_document_type,extraction_metadata,uploaded_by)
                 values(${doc.id},${caseId},${doc.path},${doc.file_name},${doc.mime},${doc.size},${doc.sha256},'other',${tx.json(doc.extraction as never)},${session.staff.id})`;
      }
    });
    return { case_id: caseId, status: "PENDING" as const };
  } catch (error) {
    await Promise.all(uploaded.map((doc) => removeObject(doc.path).catch(() => undefined)));
    throw error;
  }
}

export async function importQueue(session: StaffSession, filter: string | null, search: string | null, caseId: string | null = null) {
  return withStaff(session, async (tx) => {
    const statuses = IMPORT_STATUSES as readonly string[];
    const normalizedFilter = filter && statuses.includes(filter) ? filter : null;
    const q = search?.trim().slice(0, 120) || null;
    const counters = await tx`select status,count(*)::int as count from client_import_cases group by status`;
    const staff = await tx`select id,display_name,staff_code from staff where active order by display_name`;
    const cases = await tx`
      select c.id,c.batch_id,c.source_type,c.source_row,c.status,c.mapped_draft,c.missing_fields,c.conflicts,
             c.verification_result,c.reviewer_id,c.review_started_at,c.reviewed_at,c.document_match_confirmed,
             c.information_match_confirmed,c.approved_at,c.created_client_id,c.created_at,c.updated_at,
             s.display_name as reviewer_name,
             (select count(*)::int from client_import_documents d where d.import_case_id=c.id) as document_count
      from client_import_cases c
      left join staff s on s.id=c.reviewer_id
      where (${caseId}::uuid is null or c.id=${caseId}::uuid)
        and (${normalizedFilter}::text is null or c.status=${normalizedFilter})
        and (${q}::text is null or
          coalesce(c.mapped_draft->'profile'->>'full_name','') ilike '%'||${q}||'%' or
          coalesce(c.mapped_draft->'profile'->>'phone','') ilike '%'||${q}||'%' or
          coalesce(c.mapped_draft->'profile'->>'email','') ilike '%'||${q}||'%' or
          c.id::text ilike '%'||${q}||'%')
      order by case when c.status='PENDING' then 0 when c.status='UNDER_REVIEW' then 1 when c.status='MISSING_DOCUMENT' then 2 else 3 end,
               c.created_at desc
      limit ${caseId ? 1 : 100}`;
    return {
      counters: Object.fromEntries(IMPORT_STATUSES.map((status) => [status, Number(counters.find((r) => r.status === status)?.count ?? 0)])),
      staff,
      cases,
    };
  });
}

const CaseActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review"), case_id: z.uuid(), reviewer_id: z.uuid() }),
  z.object({ action: z.literal("save"), case_id: z.uuid(), mapped_draft: z.unknown() }),
  z.object({ action: z.literal("verify"), case_id: z.uuid() }),
  z.object({ action: z.literal("confirm"), case_id: z.uuid(), document_match_confirmed: z.boolean(), information_match_confirmed: z.boolean() }),
  z.object({ action: z.literal("approve"), case_id: z.uuid() }),
]);

async function resolveAssignedStaff(tx: Parameters<Parameters<typeof withStaff>[1]>[0], code: string | null) {
  if (!code) return null;
  const [staff] = await tx`select id from staff where active and lower(coalesce(staff_code,''))=lower(${code}) limit 1`;
  if (!staff) throw new ActionError("invalid_staff_code", `Active staff code not found: ${code}`, 400);
  return staff.id as string;
}

export async function mutateImportCase(session: StaffSession, input: unknown, traceId: string) {
  if (session.staff.role === "staff") throw new ActionError("forbidden", "Import review requires manager or admin access", 403);
  const parsed = CaseActionSchema.safeParse(input);
  if (!parsed.success) throw new ActionError("invalid_input", issuesMessage(parsed.error), 400);
  const action = parsed.data;

  if (action.action === "review") {
    return withStaff(session, async (tx) => {
      const [reviewer] = await tx`select id from staff where id=${action.reviewer_id} and active`;
      if (!reviewer) throw new ActionError("invalid_reviewer", "Reviewer is not active", 400);
      const [row] = await tx`select id,status from client_import_cases where id=${action.case_id} for update`;
      if (!row) throw new ActionError("not_found", "Import case not found", 404);
      if (row.status === "APPROVED_FILE") throw new ActionError("already_approved", "Import case is already approved", 409);
      await tx`update client_import_cases set reviewer_id=${action.reviewer_id},review_started_at=coalesce(review_started_at,now()),status='UNDER_REVIEW' where id=${action.case_id}`;
      return { ok: true };
    });
  }

  if (action.action === "save") {
    const draft = CanonicalImportDraftSchema.safeParse(action.mapped_draft);
    if (!draft.success) throw new ActionError("invalid_draft", issuesMessage(draft.error), 400);
    return withStaff(session, async (tx) => {
      const [row] = await tx`select id,status from client_import_cases where id=${action.case_id} for update`;
      if (!row) throw new ActionError("not_found", "Import case not found", 404);
      if (row.status === "APPROVED_FILE") throw new ActionError("already_approved", "Approved case cannot be edited", 409);
      await tx`update client_import_cases set mapped_draft=${tx.json(draft.data as never)},verification_result='{}'::jsonb,reviewed_at=null where id=${action.case_id}`;
      return { ok: true };
    });
  }

  if (action.action === "verify") {
    return withStaff(session, async (tx) => {
      const [row] = await tx`select * from client_import_cases where id=${action.case_id} for update`;
      if (!row) throw new ActionError("not_found", "Import case not found", 404);
      if (!row.reviewer_id) throw new ActionError("reviewer_required", "Select a reviewer first", 400);
      const draft = CanonicalImportDraftSchema.safeParse(row.mapped_draft);
      const documents = await tx`select count(*)::int as n from client_import_documents where import_case_id=${action.case_id}`;
      let duplicate: unknown[] = [];
      if (draft.success) duplicate = await findClientIdentityMatches(tx, draft.data.profile.email, draft.data.profile.phone);
      const blocking = !draft.success || duplicate.length > 0 || (Array.isArray(row.conflicts) && row.conflicts.length > 0);
      const missingDocument = Number(documents[0]?.n ?? 0) === 0;
      const result = {
        ready: !blocking,
        state: blocking ? "REVIEW_REQUIRED" : missingDocument ? "MISSING_DOCUMENT" : "READY",
        profile_valid: draft.success,
        duplicate_client: duplicate[0] ? { id: duplicate[0].id, ref: duplicate[0].ref } : null,
        missing_document: missingDocument,
        blocking_conflicts: Array.isArray(row.conflicts) ? row.conflicts : [],
      };
      await tx`update client_import_cases set verification_result=${tx.json(result as never)},reviewed_at=now(),status=${missingDocument && !blocking ? "MISSING_DOCUMENT" : "UNDER_REVIEW"} where id=${action.case_id}`;
      return result;
    });
  }

  if (action.action === "confirm") {
    return withStaff(session, async (tx) => {
      const [row] = await tx`select id,status from client_import_cases where id=${action.case_id} for update`;
      if (!row) throw new ActionError("not_found", "Import case not found", 404);
      if (row.status === "APPROVED_FILE") throw new ActionError("already_approved", "Import case is already approved", 409);
      await tx`update client_import_cases set document_match_confirmed=${action.document_match_confirmed},information_match_confirmed=${action.information_match_confirmed} where id=${action.case_id}`;
      return { ok: true };
    });
  }

  return withStaff(session, async (tx) => {
    const [row] = await tx`select * from client_import_cases where id=${action.case_id} for update`;
    if (!row) throw new ActionError("not_found", "Import case not found", 404);
    if (row.status === "APPROVED_FILE" || row.created_client_id) throw new ActionError("already_approved", "Import case is already approved", 409);
    if (!row.reviewer_id || !row.review_started_at || !row.reviewed_at) throw new ActionError("review_required", "Review and verification are required before approval", 400);
    if (!row.document_match_confirmed || !row.information_match_confirmed) throw new ActionError("confirmation_required", "Both reviewer confirmations are required", 400);
    const verification = row.verification_result as { ready?: boolean } | null;
    if (!verification?.ready) throw new ActionError("not_ready", "Blocking verification findings must be resolved before approval", 409);
    const draft = CanonicalImportDraftSchema.parse(row.mapped_draft);
    const assignedStaff = await resolveAssignedStaff(tx, draft.staffCode);
    const client = await insertClient(tx, {
      source: "staff_manual",
      profile: draft.profile,
      primary: draft.primary,
      backup: draft.backup,
      status: draft.status,
      nextStep: draft.nextStep,
      assignedStaff,
      createdBy: session.staff.id,
      communicationConsent: false,
    }, { staffId: session.staff.id, traceId });

    const docs = await tx`select * from client_import_documents where import_case_id=${action.case_id} order by created_at`;
    for (const doc of docs) {
      const [created] = await tx`
        insert into documents(client_id,doc_type,storage_path,file_name,mime_type,size_bytes,status,uploaded_by,sha256)
        values(${client.id},${(DOC_TYPES as readonly string[]).includes(String(doc.detected_document_type)) ? doc.detected_document_type : "other"},
               ${doc.storage_reference},${doc.original_filename},${doc.mime_type},${doc.size_bytes},'pending',${doc.uploaded_by},${doc.sha256})
        returning id`;
      await logActivity(tx, { clientId: client.id, action: "document_uploaded", actor: { staffId: session.staff.id, traceId }, entityType: "document", entityId: created.id, newValue: { source: "smart_import", file_name: doc.original_filename, sha256: doc.sha256 } });
      await enqueue(tx, { type: "document_extraction", entityId: String(created.id), dedupeKey: `extract:${created.id}:1`, traceId, maxAttempts: 3 });
    }

    if ((row.verification_result as { missing_document?: boolean } | null)?.missing_document) {
      await tx`insert into followups(client_id,due_date,reason,status,created_by)
               values(${client.id},(now() at time zone 'America/Detroit')::date + 3,'Provide missing import documents','open',${session.staff.id})`;
    }

    await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,new_value,trace_id)
             values(${client.id},'smart_import_approved',${session.staff.id},'client_import_case',${action.case_id},${tx.json({ source_type: row.source_type } as never)},${traceId})`;
    await tx`update client_import_cases set status='APPROVED_FILE',approved_by=${session.staff.id},approved_at=now(),created_client_id=${client.id} where id=${action.case_id}`;
    return { ok: true, client_id: client.id, ref: client.ref };
  });
}
