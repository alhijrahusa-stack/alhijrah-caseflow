import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { sql } from "@/lib/db";
import type { StaffSession } from "@/lib/auth";
import type { IntakeRow } from "@/lib/intake-file";
import { ProfileSchema, StatusSchema, issuesMessage } from "@/lib/schemas";
import {
  ActionError,
  findClientIdentityMatches,
  insertClient,
  logActivity,
  normalizeClientEmail,
  normalizeClientPhone,
  type Tx,
} from "@/lib/service";
import { uploadObject, removeObject } from "@/lib/storage";
import { rowsFromImageOrPdf } from "@/lib/universal-intake";
import {
  IMPORT_SOURCE_TYPES,
  IMPORT_STATUSES,
  SMART_IMPORT_LIMITS,
  importRowSummary,
  pickImportValue,
  prepareImportDraft,
  requiredMissingFromDraft,
  sourceHash,
  type ImportPreviewRow,
  type ImportSourceType,
  type ImportStatus,
  type PreparedImportDraft,
} from "@/lib/smart-client-import-core";

const JsonObject = z.record(z.string(), z.unknown());
const DraftSchema = z.object({
  profile: z.unknown(),
  primary: z.array(z.object({ site_code: z.string(), job_id: z.string(), shift_code: z.string() })).default([]),
  backup: z.array(z.object({ site_code: z.string(), job_id: z.string(), shift_code: z.string() })).default([]),
  status: z.string().default("new_intake"),
  next_step: z.string().nullable().default(null),
  staff_code: z.string().nullable().default(null),
  initial_note: z.string().nullable().default(null),
});

export type QueueRow = {
  id: string;
  source_type: ImportSourceType;
  source_row: number | null;
  status: ImportStatus;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
  document_count: number;
  issue_count: number;
  created_at: string;
  created_client_id: string | null;
};

function assertManager(session: StaffSession) {
  if (session.staff.role === "staff") throw new ActionError("forbidden", "Smart client import requires manager or admin access", 403);
}

function parseSource(value: string): ImportSourceType {
  if (!(IMPORT_SOURCE_TYPES as readonly string[]).includes(value)) throw new ActionError("invalid_source", "Unsupported import source", 400);
  return value as ImportSourceType;
}

function parseStatus(value: string | null): ImportStatus | "ALL" {
  if (!value || value === "ALL") return "ALL";
  if (!(IMPORT_STATUSES as readonly string[]).includes(value)) throw new ActionError("invalid_status", "Invalid import status", 400);
  return value as ImportStatus;
}

function jsonArray(value: unknown[]) {
  return value;
}

function identityKey(email: string | null | undefined, phone: string | null | undefined) {
  return { email: normalizeClientEmail(email), phone: normalizeClientPhone(phone) };
}

async function identityIndex(rows: { email: string | null; phone: string | null }[]) {
  const emails = [...new Set(rows.map((row) => normalizeClientEmail(row.email)).filter((value): value is string => Boolean(value)))];
  const phones = [...new Set(rows.map((row) => normalizeClientPhone(row.phone)).filter((value): value is string => Boolean(value)))];
  if (!emails.length && !phones.length) return [] as { id: string; ref: string; email: string | null; phone: string | null }[];
  return sql()`
    select id,ref,email,phone
    from clients
    where deleted_at is null
      and (
        (${emails.length > 0} and lower(trim(coalesce(email,''))) = any(${emails}::text[]))
        or (${phones.length > 0} and regexp_replace(coalesce(phone,''),'\\D','','g') = any(${phones}::text[]))
      )
    order by created_at` as unknown as { id: string; ref: string; email: string | null; phone: string | null }[];
}

export async function previewImportRows(session: StaffSession, rows: IntakeRow[]): Promise<ImportPreviewRow[]> {
  assertManager(session);
  if (!rows.length) throw new ActionError("empty_import", "No data rows were found", 400);
  if (rows.length > SMART_IMPORT_LIMITS.maxRows) throw new ActionError("too_many_rows", `Import is limited to ${SMART_IMPORT_LIMITS.maxRows} rows`, 400);

  const prepared = rows.map((raw, index) => {
    const summary = importRowSummary(raw);
    try {
      return { index, raw, summary, draft: prepareImportDraft(raw), error: null as string | null };
    } catch (error) {
      return { index, raw, summary, draft: null, error: error instanceof Error ? error.message : "Invalid row" };
    }
  });
  const matches = await identityIndex(prepared.map((item) => ({ email: item.summary.email, phone: item.summary.phone })));

  return prepared.map((item) => {
    const identity = identityKey(item.summary.email, item.summary.phone);
    const rowMatches = matches.filter((match) => {
      const m = identityKey(match.email, match.phone);
      return Boolean((identity.email && m.email === identity.email) || (identity.phone && m.phone === identity.phone));
    });
    const exact = rowMatches.find((match) => {
      const m = identityKey(match.email, match.phone);
      return Boolean(identity.email && identity.phone && m.email === identity.email && m.phone === identity.phone);
    });
    const identityState = exact ? "EXISTING_CLIENT" : rowMatches.length ? "POSSIBLE_DUPLICATE" : "NEW";
    const result = item.error ? "INVALID" : rowMatches.length ? "DUPLICATE" : "VALID";
    const first = exact ?? rowMatches[0] ?? null;
    return {
      row: item.index + 2,
      result,
      identity: identityState,
      ...item.summary,
      message: item.error ?? (first ? `Existing client ${first.ref} matches imported identity` : null),
      existing_client_id: first?.id ?? null,
      existing_client_ref: first?.ref ?? null,
      raw: item.raw,
      draft: item.draft,
    } satisfies ImportPreviewRow;
  });
}

export async function stageSheetRows(args: {
  session: StaffSession;
  rows: IntakeRow[];
  source: string;
  selectedRows?: number[];
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}) {
  assertManager(args.session);
  const source = parseSource(args.source);
  if (source === "mobile") throw new ActionError("invalid_source", "Mobile submissions use the mobile intake endpoint", 400);
  const key = args.idempotencyKey.trim();
  if (key.length < 8 || key.length > 200) throw new ActionError("invalid_idempotency_key", "A valid idempotency key is required", 400);
  const preview = await previewImportRows(args.session, args.rows);
  const selected = new Set(args.selectedRows?.length ? args.selectedRows : preview.filter((row) => row.result === "VALID").map((row) => row.row));
  const candidates = preview.filter((row) => selected.has(row.row) && row.result !== "INVALID" && row.draft);
  if (!candidates.length) throw new ActionError("nothing_to_stage", "Select at least one valid or duplicate row", 400);

  return sql().begin(async (tx) => {
    const [existing] = await tx`
      select id from client_import_batches where created_by=${args.session.staff.id} and idempotency_key=${key}`;
    if (existing) {
      const cases = await tx`select id,status,source_row,created_at from client_import_cases where batch_id=${existing.id} order by source_row nulls last`;
      return { batch_id: String(existing.id), staged: cases.length, cases, idempotent: true };
    }
    const [batch] = await tx`
      insert into client_import_batches(source_type,source_file_hash,idempotency_key,created_by,metadata)
      values(${source},${sourceHash(args.rows)},${key},${args.session.staff.id},${tx.json((args.metadata ?? {}) as never)})
      returning id`;
    const cases = [] as { id: string; status: string; source_row: number; created_at: Date }[];
    for (const row of candidates) {
      const conflicts = row.existing_client_id
        ? [{ type: "IDENTITY", client_id: row.existing_client_id, client_ref: row.existing_client_ref, message: row.message }]
        : [];
      const [created] = await tx`
        insert into client_import_cases(
          batch_id,source_type,source_row,status,raw_input,mapped_draft,missing_fields,conflicts,field_evidence,verification_result,created_by
        ) values(
          ${batch.id},${source},${row.row},'PENDING',${tx.json(row.raw as never)},${tx.json(row.draft as never)},'[]'::jsonb,
          ${tx.json(conflicts as never)},'[]'::jsonb,
          ${tx.json({ identity: row.identity, preview_result: row.result } as never)},${args.session.staff.id}
        ) returning id,status,source_row,created_at`;
      cases.push(created as never);
    }
    return { batch_id: String(batch.id), staged: cases.length, cases, idempotent: false };
  });
}

function safeFilename(value: string) {
  const name = value.replace(/[\\/\0\r\n]/g, "_").replace(/[^\p{L}\p{N}._ -]/gu, "_").trim();
  return (name || "upload").slice(0, 180);
}

function supportedMobileMime(file: File) {
  const mime = file.type || "application/octet-stream";
  return ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(mime);
}

function canonicalEvidence(rows: { row: IntakeRow; source: string }[]) {
  const fields = ["full_name","phone","email","date_of_birth","preferred_language","street","city","state","zip","site_code","job_id","shift_code"] as const;
  const merged: IntakeRow = {};
  const evidence: Record<string, unknown>[] = [];
  const conflicts: Record<string, unknown>[] = [];
  for (const field of fields) {
    const values = rows
      .map((source) => ({ value: pickImportValue(source.row, field), source: source.source }))
      .filter((item): item is { value: string; source: string } => Boolean(item.value));
    const unique = [...new Map(values.map((item) => [item.value.trim().toLowerCase(), item])).values()];
    if (unique.length === 1) {
      merged[field] = unique[0].value;
      evidence.push({ field_key: field, value: unique[0].value, source_type: unique[0].source, verification_state: "MATCHED" });
    } else if (unique.length > 1) {
      conflicts.push({ field_key: field, values: unique, type: "SOURCE_CONFLICT" });
      for (const item of unique) evidence.push({ field_key: field, value: item.value, source_type: item.source, verification_state: "CONFLICT" });
    }
  }
  return { merged, evidence, conflicts };
}

function partialDraft(row: IntakeRow, notes: string) {
  try { return prepareImportDraft({ ...row, initial_note: notes || row.initial_note || null }); }
  catch {
    return {
      profile: {
        full_name: pickImportValue(row, "full_name") ?? "",
        phone: pickImportValue(row, "phone") ?? "",
        email: pickImportValue(row, "email"),
        date_of_birth: pickImportValue(row, "date_of_birth"),
        preferred_language: pickImportValue(row, "preferred_language") ?? "en",
        street: pickImportValue(row, "street"), city: pickImportValue(row, "city"), state: pickImportValue(row, "state"), zip: pickImportValue(row, "zip"),
        appointment_availability: null, amazon_worked_before: null, amazon_worked_from: null, amazon_worked_to: null,
        amazon_applied_before: null, currently_amazon: null, via_agency: null, amazon_application_email: null, employment_history: [],
      },
      primary: [], backup: [], status: "new_intake", next_step: null, staff_code: null, initial_note: notes || null,
    };
  }
}

export async function stageMobileImport(args: {
  session: StaffSession;
  notes: string;
  files: File[];
  idempotencyKey: string;
}) {
  assertManager(args.session);
  const notes = args.notes.trim().slice(0, SMART_IMPORT_LIMITS.maxRawTextLength);
  if (!notes && !args.files.length) throw new ActionError("empty_submission", "Add client information or at least one document", 400);
  if (args.files.length > SMART_IMPORT_LIMITS.maxFiles) throw new ActionError("too_many_files", `Maximum ${SMART_IMPORT_LIMITS.maxFiles} files`, 413);
  const totalBytes = args.files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > SMART_IMPORT_LIMITS.maxTotalUploadBytes) throw new ActionError("upload_too_large", "Total upload exceeds the safe limit", 413);
  for (const file of args.files) {
    if (!file.size || file.size > SMART_IMPORT_LIMITS.maxFileBytes) throw new ActionError("file_too_large", `${file.name || "File"} exceeds the safe file limit`, 413);
    if (!supportedMobileMime(file)) throw new ActionError("unsupported_file", "Mobile intake supports PDF, JPG, PNG and WebP", 415);
  }

  const extracted: { row: IntakeRow; source: string; error?: string }[] = [];
  const fileData: { file: File; bytes: Uint8Array; sha256: string; extractedRows: IntakeRow[]; extractionError: string | null }[] = [];
  if (notes) {
    try {
      const rows = await rowsFromImageOrPdf(new TextEncoder().encode(notes), "text/plain");
      if (rows[0]) extracted.push({ row: rows[0], source: "staff_text" });
    } catch (error) {
      extracted.push({ row: {}, source: "staff_text", error: error instanceof Error ? error.message : "Text extraction unavailable" });
    }
  }
  for (const file of args.files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    let rows: IntakeRow[] = [];
    let extractionError: string | null = null;
    try { rows = await rowsFromImageOrPdf(bytes, file.type); }
    catch (error) { extractionError = error instanceof Error ? error.message : "Extraction failed"; }
    if (rows[0]) extracted.push({ row: rows[0], source: file.name || file.type });
    fileData.push({ file, bytes, sha256, extractedRows: rows, extractionError });
  }

  const merged = canonicalEvidence(extracted);
  const draft = partialDraft(merged.merged, notes);
  const missing = requiredMissingFromDraft(draft);
  const key = args.idempotencyKey.trim();
  if (key.length < 8 || key.length > 200) throw new ActionError("invalid_idempotency_key", "A valid idempotency key is required", 400);

  const created = await sql().begin(async (tx) => {
    const [existing] = await tx`select id from client_import_batches where created_by=${args.session.staff.id} and idempotency_key=${key}`;
    if (existing) {
      const [caseRow] = await tx`select id,status from client_import_cases where batch_id=${existing.id} order by created_at limit 1`;
      return { batchId: String(existing.id), caseId: String(caseRow.id), idempotent: true };
    }
    const [batch] = await tx`
      insert into client_import_batches(source_type,source_file_hash,idempotency_key,created_by,metadata)
      values('mobile',${sourceHash({ notes, files: fileData.map((entry) => ({ name: entry.file.name, sha256: entry.sha256 })) })},${key},${args.session.staff.id},
             ${tx.json({ file_count: args.files.length, raw_text_present: Boolean(notes) } as never)}) returning id`;
    const extractionErrors = extracted.filter((entry) => entry.error).map((entry) => ({ source: entry.source, error: entry.error }));
    for (const entry of fileData) if (entry.extractionError) extractionErrors.push({ source: entry.file.name, error: entry.extractionError });
    const [caseRow] = await tx`
      insert into client_import_cases(
        batch_id,source_type,status,raw_input,mapped_draft,missing_fields,conflicts,field_evidence,verification_result,created_by
      ) values(
        ${batch.id},'mobile','PENDING',${tx.json({ notes } as never)},${tx.json(draft as never)},${tx.json(missing as never)},
        ${tx.json(merged.conflicts as never)},${tx.json(merged.evidence as never)},
        ${tx.json({ extraction_errors: extractionErrors } as never)},${args.session.staff.id}
      ) returning id`;
    return { batchId: String(batch.id), caseId: String(caseRow.id), idempotent: false };
  });
  if (created.idempotent) return { batch_id: created.batchId, case_id: created.caseId, idempotent: true };

  const uploadedPaths: string[] = [];
  try {
    for (const entry of fileData) {
      const path = `smart-import/${created.caseId}/${randomUUID()}-${safeFilename(entry.file.name || "upload")}`;
      await uploadObject(path, entry.bytes, entry.file.type);
      uploadedPaths.push(path);
      await sql()`
        insert into client_import_documents(import_case_id,storage_reference,original_filename,mime_type,size_bytes,sha256,detected_document_type,extraction_metadata,uploaded_by)
        values(${created.caseId},${path},${safeFilename(entry.file.name || "upload")},${entry.file.type},${entry.file.size},${entry.sha256},'other',
          ${sql().json({ extracted_rows: entry.extractedRows.length, extraction_error: entry.extractionError } as never)},${args.session.staff.id})`;
    }
  } catch (error) {
    for (const path of uploadedPaths) await removeObject(path).catch(() => undefined);
    await sql().begin(async (tx) => {
      await tx`delete from client_import_documents where import_case_id=${created.caseId}`;
      await tx`delete from client_import_cases where id=${created.caseId}`;
      await tx`delete from client_import_batches where id=${created.batchId}`;
    });
    throw error;
  }
  return { batch_id: created.batchId, case_id: created.caseId, idempotent: false };
}

function decodeCursor(value: string | null) {
  if (!value) return null;
  try {
    const raw = Buffer.from(value, "base64url").toString("utf8");
    const [createdAt, id] = raw.split("|");
    if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, id };
  } catch { return null; }
}

function encodeCursor(createdAt: string, id: string) {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");
}

export async function listImportQueue(session: StaffSession, args: { status?: string | null; q?: string | null; cursor?: string | null }) {
  assertManager(session);
  const status = parseStatus(args.status ?? null);
  const q = (args.q ?? "").trim().slice(0, 160);
  const cursor = decodeCursor(args.cursor ?? null);
  const limit = SMART_IMPORT_LIMITS.queuePageSize;
  const rows = await sql()`
    select c.id,c.source_type,c.source_row,c.status,c.reviewer_id,s.display_name as reviewer_name,
           c.mapped_draft #>> '{profile,full_name}' as full_name,
           c.mapped_draft #>> '{profile,phone}' as phone,
           c.mapped_draft #>> '{profile,email}' as email,
           c.created_at,c.created_client_id,
           (select count(*)::int from client_import_documents d where d.import_case_id=c.id) as document_count,
           (coalesce(jsonb_array_length(c.missing_fields),0)+coalesce(jsonb_array_length(c.conflicts),0))::int as issue_count
    from client_import_cases c
    left join staff s on s.id=c.reviewer_id
    where (${status === "ALL"} or c.status=${status === "ALL" ? "PENDING" : status})
      and (${q === ""} or c.id::text ilike ${`%${q}%`}
           or coalesce(c.mapped_draft #>> '{profile,full_name}','') ilike ${`%${q}%`}
           or coalesce(c.mapped_draft #>> '{profile,phone}','') ilike ${`%${q}%`}
           or coalesce(c.mapped_draft #>> '{profile,email}','') ilike ${`%${q}%`})
      and (${cursor == null} or (c.created_at,c.id) < (${cursor?.createdAt ?? "9999-12-31T23:59:59.999Z"}::timestamptz,${cursor?.id ?? "ffffffff-ffff-ffff-ffff-ffffffffffff"}::uuid))
    order by c.created_at desc,c.id desc
    limit ${limit + 1}`;
  const visible = rows.slice(0, limit) as unknown as QueueRow[];
  const next = rows.length > limit ? visible[visible.length - 1] : null;
  const counters = await sql()`
    select status,count(*)::int as count from client_import_cases group by status`;
  const counts = Object.fromEntries(IMPORT_STATUSES.map((key) => [key, 0])) as Record<ImportStatus, number>;
  for (const row of counters) if ((IMPORT_STATUSES as readonly string[]).includes(String(row.status))) counts[row.status as ImportStatus] = Number(row.count);
  return { rows: visible, counters: counts, next_cursor: next ? encodeCursor(String(next.created_at), String(next.id)) : null };
}

export async function getImportCase(session: StaffSession, id: string) {
  assertManager(session);
  const [row] = await sql()`
    select c.*,s.display_name as reviewer_name,a.display_name as approved_by_name
    from client_import_cases c
    left join staff s on s.id=c.reviewer_id
    left join staff a on a.id=c.approved_by
    where c.id=${id}`;
  if (!row) throw new ActionError("not_found", "Import case not found", 404);
  const docs = await sql()`
    select id,original_filename,mime_type,size_bytes,detected_document_type,extraction_metadata,created_at
    from client_import_documents where import_case_id=${id} order by created_at,id`;
  return { case: row, documents: docs };
}

async function requireActiveReviewer(tx: Tx, id: string) {
  const [reviewer] = await tx`select id from staff where id=${id} and active`;
  if (!reviewer) throw new ActionError("invalid_reviewer", "Reviewer is not an active staff member", 400);
  return String(reviewer.id);
}

export async function startImportReview(session: StaffSession, id: string, reviewerId: string) {
  assertManager(session);
  return sql().begin(async (tx) => {
    await requireActiveReviewer(tx, reviewerId);
    const [row] = await tx`select id,status,review_started_at from client_import_cases where id=${id} for update`;
    if (!row) throw new ActionError("not_found", "Import case not found", 404);
    if (row.status === "APPROVED_FILE") throw new ActionError("already_approved", "Approved imports cannot be reopened", 409);
    const [updated] = await tx`
      update client_import_cases
      set reviewer_id=${reviewerId},review_started_at=coalesce(review_started_at,now()),status='UNDER_REVIEW'
      where id=${id}
      returning id,status,reviewer_id,review_started_at`;
    return updated;
  });
}

export async function saveImportReview(session: StaffSession, args: {
  id: string;
  reviewerId: string;
  draft: unknown;
  documentConfirmed: boolean;
  informationConfirmed: boolean;
}) {
  assertManager(session);
  if (!JsonObject.safeParse(args.draft).success) throw new ActionError("invalid_draft", "Mapped draft must be an object", 400);
  return sql().begin(async (tx) => {
    await requireActiveReviewer(tx, args.reviewerId);
    const [row] = await tx`select id,status,review_started_at from client_import_cases where id=${args.id} for update`;
    if (!row) throw new ActionError("not_found", "Import case not found", 404);
    if (row.status === "APPROVED_FILE") throw new ActionError("already_approved", "Approved imports cannot be changed", 409);
    const missing = requiredMissingFromDraft(args.draft);
    const [updated] = await tx`
      update client_import_cases set
        reviewer_id=${args.reviewerId},review_started_at=coalesce(review_started_at,now()),reviewed_at=now(),
        mapped_draft=${tx.json(args.draft as never)},missing_fields=${tx.json(missing as never)},
        document_match_confirmed=${args.documentConfirmed},information_match_confirmed=${args.informationConfirmed},
        status=case when status='PENDING' then 'UNDER_REVIEW' else status end
      where id=${args.id}
      returning id,status,updated_at`;
    return updated;
  });
}

function parseApprovedDraft(value: unknown): PreparedImportDraft {
  const parsed = DraftSchema.safeParse(value);
  if (!parsed.success) throw new ActionError("invalid_draft", parsed.error.issues[0]?.message ?? "Invalid mapped draft", 422);
  const profile = ProfileSchema.safeParse(parsed.data.profile);
  if (!profile.success) throw new ActionError("invalid_client", issuesMessage(profile.error), 422);
  const status = StatusSchema.safeParse(parsed.data.status);
  if (!status.success) throw new ActionError("invalid_status", "Invalid client status", 422);
  return {
    profile: profile.data,
    primary: parsed.data.primary,
    backup: parsed.data.backup,
    status: status.data,
    next_step: parsed.data.next_step?.trim() || null,
    staff_code: parsed.data.staff_code?.trim() || null,
    initial_note: parsed.data.initial_note?.trim() || null,
  };
}

async function resolveImportedStaff(tx: Tx, code: string | null) {
  if (!code) return null;
  const [staff] = await tx`select id from staff where active and lower(coalesce(staff_code,''))=lower(${code}) limit 1`;
  if (!staff) throw new ActionError("invalid_staff_code", `Active staff code not found: ${code}`, 400);
  return String(staff.id);
}

async function verifyLockedCase(tx: Tx, row: Record<string, unknown>) {
  const missing = requiredMissingFromDraft(row.mapped_draft);
  let draft: PreparedImportDraft | null = null;
  let validationError: string | null = null;
  try { draft = parseApprovedDraft(row.mapped_draft); } catch (error) { validationError = error instanceof Error ? error.message : "Invalid client data"; }
  const docs = await tx`select count(*)::int as count from client_import_documents where import_case_id=${String(row.id)}`;
  const documentCount = Number(docs[0]?.count ?? 0);
  const conflicts = Array.isArray(row.conflicts) ? row.conflicts as unknown[] : [];
  const blockingConflicts = [...conflicts];
  let identityMatches: Awaited<ReturnType<typeof findClientIdentityMatches>> = [];
  if (draft) {
    identityMatches = await findClientIdentityMatches(tx, draft.profile.email, draft.profile.phone, { lock: true });
    if (identityMatches.length) blockingConflicts.push({ type: "IDENTITY", client_id: identityMatches[0].id, client_ref: identityMatches[0].ref });
  }
  const approvalReady = Boolean(draft && missing.length === 0 && blockingConflicts.length === 0);
  return {
    draft,
    missing,
    documentCount,
    blockingConflicts,
    result: {
      state: approvalReady ? (documentCount > 0 ? "READY" : "MISSING_DOCUMENT") : "REVIEW_REQUIRED",
      approval_ready: approvalReady,
      client_schema_valid: Boolean(draft),
      document_count: documentCount,
      blocking_conflicts: blockingConflicts.length,
      identity: identityMatches.length ? "POSSIBLE_DUPLICATE" : "NEW",
      validation_error: validationError,
      checked_at: new Date().toISOString(),
    },
  };
}

export async function verifyImportCase(session: StaffSession, id: string) {
  assertManager(session);
  return sql().begin(async (tx) => {
    const [row] = await tx`select * from client_import_cases where id=${id} for update`;
    if (!row) throw new ActionError("not_found", "Import case not found", 404);
    if (row.status === "APPROVED_FILE") throw new ActionError("already_approved", "Import is already approved", 409);
    if (!row.reviewer_id || !row.review_started_at) throw new ActionError("review_required", "Select a reviewer and start review first", 409);
    const verification = await verifyLockedCase(tx, row as Record<string, unknown>);
    const nextStatus = verification.result.approval_ready && verification.documentCount === 0 ? "MISSING_DOCUMENT" : "UNDER_REVIEW";
    await tx`
      update client_import_cases set missing_fields=${tx.json(verification.missing as never)},conflicts=${tx.json(verification.blockingConflicts as never)},
        verification_result=${tx.json(verification.result as never)},reviewed_at=now(),status=${nextStatus}
      where id=${id}`;
    return verification.result;
  });
}

export async function approveImportCase(session: StaffSession, args: {
  id: string;
  reviewerId: string;
  draft: unknown;
  documentConfirmed: boolean;
  informationConfirmed: boolean;
  traceId: string;
}) {
  assertManager(session);
  return sql().begin(async (tx) => {
    await requireActiveReviewer(tx, args.reviewerId);
    const [row] = await tx`select * from client_import_cases where id=${args.id} for update`;
    if (!row) throw new ActionError("not_found", "Import case not found", 404);
    if (row.status === "APPROVED_FILE") {
      if (row.created_client_id) return { client_id: String(row.created_client_id), idempotent: true };
      throw new ActionError("invalid_approved_state", "Approved import is missing its client reference", 500);
    }
    if (!row.review_started_at) throw new ActionError("review_required", "Start review before approval", 409);
    if (!args.documentConfirmed || !args.informationConfirmed) throw new ActionError("confirmation_required", "Confirm document status and information match before approval", 409);

    const draft = parseApprovedDraft(args.draft);
    const verificationRow = { ...row, mapped_draft: args.draft, reviewer_id: args.reviewerId } as Record<string, unknown>;
    const verification = await verifyLockedCase(tx, verificationRow);
    if (!verification.result.approval_ready) {
      throw new ActionError("approval_blocked", verification.result.validation_error || "Resolve blocking conflicts before approval", 409);
    }

    const assignedStaff = await resolveImportedStaff(tx, draft.staff_code);
    const client = await insertClient(tx, {
      source: "staff_manual",
      profile: draft.profile,
      primary: draft.primary,
      backup: draft.backup,
      status: draft.status,
      nextStep: draft.next_step,
      assignedStaff,
      createdBy: session.staff.id,
      communicationConsent: false,
    }, { staffId: session.staff.id, traceId: args.traceId });

    if (draft.initial_note) {
      const [note] = await tx`insert into notes(client_id,note,staff_id) values(${client.id},${draft.initial_note},${session.staff.id}) returning id`;
      await logActivity(tx, { clientId: client.id, action: "note_added", actor: { staffId: session.staff.id, traceId: args.traceId }, entityType: "note", entityId: String(note.id) });
    }

    const documents = await tx`select * from client_import_documents where import_case_id=${args.id} order by created_at,id`;
    for (const document of documents) {
      const docType = ["photo_id","work_authorization","social_security_card","resume","other"].includes(String(document.detected_document_type))
        ? String(document.detected_document_type) : "other";
      const [createdDoc] = await tx`
        insert into documents(client_id,doc_type,storage_path,file_name,mime_type,size_bytes,status,uploaded_by,sha256,review_note)
        values(${client.id},${docType},${document.storage_reference},${document.original_filename},${document.mime_type},${document.size_bytes},'needs_review',${document.uploaded_by},${document.sha256},'Imported through Smart Career Collect Client')
        returning id`;
      await logActivity(tx, { clientId: client.id, action: "document_uploaded", actor: { staffId: session.staff.id, traceId: args.traceId }, entityType: "document", entityId: String(createdDoc.id), newValue: { import_case_id: args.id } });
    }

    if (verification.documentCount === 0) {
      const [task] = await tx`
        insert into tasks(client_id,title,description,assigned_to,created_by)
        values(${client.id},'Collect missing client documents','Smart Career Collect Client approved the file with documents still outstanding.',${args.reviewerId},${session.staff.id}) returning id`;
      await logActivity(tx, { clientId: client.id, action: "task_added", actor: { staffId: session.staff.id, traceId: args.traceId }, entityType: "task", entityId: String(task.id), newValue: { source: "smart_client_import" } });
    }

    await logActivity(tx, {
      clientId: client.id,
      action: "client_updated",
      actor: { staffId: session.staff.id, traceId: args.traceId },
      entityType: "client_import_case",
      entityId: args.id,
      newValue: { approved_from_import: true, source_type: row.source_type, document_count: verification.documentCount },
    });

    await tx`
      update client_import_cases set
        reviewer_id=${args.reviewerId},reviewed_at=now(),mapped_draft=${tx.json(args.draft as never)},
        missing_fields=${tx.json(verification.missing as never)},conflicts=${tx.json([] as never)},verification_result=${tx.json(verification.result as never)},
        document_match_confirmed=true,information_match_confirmed=true,approved_by=${session.staff.id},approved_at=now(),created_client_id=${client.id},status='APPROVED_FILE'
      where id=${args.id}`;
    return { client_id: client.id, ref: client.ref, idempotent: false };
  });
}

export async function getImportDocument(session: StaffSession, id: string) {
  assertManager(session);
  const [row] = await sql()`
    select d.id,d.storage_reference,d.original_filename,d.mime_type,d.import_case_id
    from client_import_documents d join client_import_cases c on c.id=d.import_case_id
    where d.id=${id}`;
  if (!row) throw new ActionError("not_found", "Import document not found", 404);
  return row as { id: string; storage_reference: string; original_filename: string; mime_type: string; import_case_id: string };
}
