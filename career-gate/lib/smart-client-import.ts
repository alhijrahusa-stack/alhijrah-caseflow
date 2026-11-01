import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sql } from "@/lib/db";
import type { StaffSession } from "@/lib/auth";
import { permissionAllows } from "@/lib/authz";
import { assertCaptureLease } from "@/lib/smart-capture";
import type { IntakeRow } from "@/lib/intake-file";
import {
  ActionError,
  findClientIdentityMatches,
  insertClient,
  logActivity,
  normalizeClientEmail,
  normalizeClientPhone,
  type Tx,
} from "@/lib/service";
import { applicantIdentity, sameApplicant } from "@/lib/applicant-identity";
import { assessApproval, isSourceReviewConflict } from "@/lib/smart-approval-readiness";
import { uploadObject, removeObject } from "@/lib/storage";
import { rowsFromImageOrPdf, rowsFromImageOrPdfDetailed } from "@/lib/universal-intake";
import {
  IMPORT_SOURCE_TYPES,
  IMPORT_STATUSES,
  SMART_IMPORT_LIMITS,
  importRowSummary,
  normalizePreparedDraft,
  pickImportValue,
  prepareImportDraft,
  requiredMissingFromDraft,
  sourceHash,
  type ImportPreviewRow,
  type ImportSourceType,
  type ImportStatus,
  type PreparedImportDraft,
} from "@/lib/smart-client-import-core";
import {
  canonicalSmartFieldKey,
  normalizeEnglishProficiency,
  normalizeImportLanguage,
  normalizeShiftDays,
  normalizeShiftTime,
} from "@/lib/smart-client-fields";

const JsonObject = z.record(z.string(), z.unknown());

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

export const REVIEW_FIELD_SOURCE_KEYS = {
  full_name: "full_name",
  phone: "phone",
  email: "email",
  date_of_birth: "date_of_birth",
  first_name: "first_name",
  middle_name: "middle_name",
  last_name: "last_name",
  preferred_language: "preferred_language",
  english_proficiency: "english_proficiency",
  street: "street",
  city: "city",
  state: "state",
  zip: "zip",
  preferred_location: "site_code",
  location_option_1: "alt_site_code",
  location_option_2: "backup_site_code",
  work_location_candidates: "work_location_candidates",
  preferred_shift: "shift_code",
  shift_days: "shift_days",
  shift_start_time: "shift_start_time",
  shift_end_time: "shift_end_time",
  additional_notes: "additional_notes",
} as const;

type ReviewFieldKey = keyof typeof REVIEW_FIELD_SOURCE_KEYS;
const PROFILE_REVIEW_KEYS = new Set<ReviewFieldKey>([
  "full_name", "phone", "email", "date_of_birth", "preferred_language", "english_proficiency",
  "street", "city", "state", "zip",
]);

function assertManager(session: StaffSession) {
  if (session.staff.role === "staff") throw new ActionError("forbidden", "Smart client import requires manager or admin access", 403);
}

export async function assertImportReviewPermission(session: StaffSession) {
  if (!(await permissionAllows(session, "review_smart_import"))) throw new ActionError("forbidden", "Smart import review is not permitted", 403);
}

async function assertAssignedReviewer(tx: Tx, session: StaffSession, reviewer: unknown, requestedReviewer?: string) {
  if (session.staff.role !== "staff") return;
  const [actor] = await tx`select permission_mode,custom_permissions from staff
    where id=${session.staff.id} and active and role='staff' for share`;
  if (!actor || (actor.permission_mode !== "full" &&
      !(actor.permission_mode === "custom" && Array.isArray(actor.custom_permissions) && actor.custom_permissions.includes("review_smart_import")))) {
    throw new ActionError("forbidden", "Smart import review is not permitted", 403);
  }
  if (String(reviewer ?? "") !== session.staff.id || (requestedReviewer && requestedReviewer !== session.staff.id)) {
    throw new ActionError("not_found", "Import case not found", 404);
  }
}

function requireReviewVersion(expected: string | undefined) {
  if (!expected) throw new ActionError("client_upgrade_required", "Reload Career Gate before saving. Your local draft remains available for comparison.", 409);
}

function hasPendingOverride(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const state = (value as Record<string, unknown>).workflow_override;
  return !!state && typeof state === "object" && (state as Record<string, unknown>).state === "PENDING_OVERRIDE";
}

function assertCaptureFinished(value: unknown) {
  if (value && typeof value === "object" && (value as Record<string, unknown>).processing_state === "CAPTURING") {
    throw new ActionError("capture_in_progress", "Wait for source upload to finish before reviewing", 409);
  }
}

function incompleteCapture(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return result.source_capture_incomplete === true || ["CAPTURE_FAILED", "CAPTURE_INTERRUPTED"].includes(String(result.processing_state ?? ""));
}

function preserveCaptureStatus(value: unknown) {
  if (!incompleteCapture(value)) return {};
  const result = value as Record<string, unknown>;
  return { source_capture_incomplete: true, processing_state: result.processing_state, capture_error: result.capture_error,
    capture_generation: result.capture_generation, document_count: result.document_count };
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

function draftFieldValue(draft: unknown, key: ReviewFieldKey) {
  const record = (draft && typeof draft === "object" ? draft : {}) as Record<string, unknown>;
  const profile = (record.profile && typeof record.profile === "object" ? record.profile : {}) as Record<string, unknown>;
  const reviewFields = (record.review_fields && typeof record.review_fields === "object" ? record.review_fields : {}) as Record<string, unknown>;
  return PROFILE_REVIEW_KEYS.has(key) ? profile[key] ?? null : reviewFields[key] ?? null;
}

function comparable(value: unknown) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value == null) return "";
  return String(value).trim();
}

export function sheetEvidence(row: IntakeRow, draft: PreparedImportDraft, source: ImportSourceType, sourceRow: number) {
  return (Object.keys(REVIEW_FIELD_SOURCE_KEYS) as ReviewFieldKey[]).flatMap((fieldKey) => {
    const sourceKey = REVIEW_FIELD_SOURCE_KEYS[fieldKey];
    const sourceValue = pickImportValue(row, sourceKey);
    const stagedValue = draftFieldValue(draft, fieldKey);
    if (sourceValue == null && stagedValue == null) return [];
    return [{
      field_key: fieldKey,
      value: sourceValue ?? stagedValue,
      normalized_value: stagedValue,
      source_type: source,
      source_row: sourceRow,
      verification_state: "MATCHED",
      authority: "SOURCE",
    }];
  });
}

export function mergeManualEvidence(existingValue: unknown, previousDraft: unknown, nextDraft: unknown, reviewerId: string, options: {
  resolvedFields?: readonly string[];
  conflicts?: readonly unknown[];
  actorId?: string;
} = {}) {
  const existing = Array.isArray(existingValue) ? [...existingValue] : [];
  const reviewedAt = new Date().toISOString();
  const resolvedFields = new Set(options.resolvedFields ?? []);
  for (const fieldKey of Object.keys(REVIEW_FIELD_SOURCE_KEYS) as ReviewFieldKey[]) {
    const previous = draftFieldValue(previousDraft, fieldKey);
    const next = draftFieldValue(nextDraft, fieldKey);
    if (comparable(previous) === comparable(next) && !resolvedFields.has(fieldKey)) continue;
    existing.push({
      field_key: fieldKey,
      value: next,
      source_type: "manual_review",
      verification_state: "VERIFIED",
      authority: "MANUAL",
      reviewer_id: reviewerId,
      actor_id: options.actorId ?? reviewerId,
      reviewed_at: reviewedAt,
      previous_value: previous,
      ...(resolvedFields.has(fieldKey) ? {
        resolution: "CONFIRMED_BY_REVIEWER",
        resolved_conflicts: (options.conflicts ?? []).filter((conflict) => conflictField(conflict) === fieldKey && !isIdentityConflict(conflict)),
      } : {}),
    });
  }
  return existing;
}

function isIdentityConflict(value: unknown) {
  return Boolean(value && typeof value === "object" && "type" in value && value.type === "IDENTITY");
}

function conflictField(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const conflict = value as Record<string, unknown>;
  const key = canonicalSmartFieldKey(conflict.field_key ?? conflict.field);
  return Object.prototype.hasOwnProperty.call(REVIEW_FIELD_SOURCE_KEYS, key) ? key as ReviewFieldKey : null;
}

export function resolveReviewConflicts(conflictsValue: unknown, resolvedFields: readonly string[] = []) {
  for (const field of resolvedFields) {
    if (!Object.prototype.hasOwnProperty.call(REVIEW_FIELD_SOURCE_KEYS, field)) {
      throw new ActionError("invalid_resolution", "A resolved field is outside the Smart Review field contract", 400);
    }
  }
  const resolved = new Set(resolvedFields);
  const conflicts = Array.isArray(conflictsValue) ? conflictsValue : [];
  return conflicts.filter((conflict) => isIdentityConflict(conflict) || !resolved.has(conflictField(conflict) ?? ""));
}

export function assertReviewVersion(currentRevision: unknown, expectedRevision?: string) {
  if (!expectedRevision) throw new ActionError("client_upgrade_required", "Reload Career Gate before saving. Your local draft remains available for comparison.", 409);
  if (!/^[1-9][0-9]{0,18}$/.test(expectedRevision) || BigInt(expectedRevision) > 9223372036854775807n) {
    throw new ActionError("invalid_revision", "Invalid review revision", 400);
  }
  if (String(currentRevision) !== expectedRevision) {
    throw new ActionError("review_changed", "This file changed after you opened it. Reload the latest review before saving; your unsaved edits have been kept.", 409);
  }
}

function sanitizeReviewDraft(value: unknown) {
  const draft = structuredClone((value && typeof value === "object" ? value : {}) as Record<string, unknown>);
  const profile = (draft.profile && typeof draft.profile === "object" ? { ...(draft.profile as Record<string, unknown>) } : {}) as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(profile, "preferred_language")) {
    const raw = profile.preferred_language == null ? null : String(profile.preferred_language);
    profile.preferred_language = normalizeImportLanguage(raw);
  }
  if (Object.prototype.hasOwnProperty.call(profile, "english_proficiency")) {
    const raw = profile.english_proficiency == null ? null : String(profile.english_proficiency);
    profile.english_proficiency = normalizeEnglishProficiency(raw);
  }
  draft.profile = profile;
  const reviewFields = (draft.review_fields && typeof draft.review_fields === "object" ? { ...(draft.review_fields as Record<string, unknown>) } : {}) as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(reviewFields, "shift_days")) reviewFields.shift_days = normalizeShiftDays(reviewFields.shift_days as string | string[] | null | undefined);
  if (Object.prototype.hasOwnProperty.call(reviewFields, "shift_start_time")) reviewFields.shift_start_time = normalizeShiftTime(reviewFields.shift_start_time == null ? null : String(reviewFields.shift_start_time));
  if (Object.prototype.hasOwnProperty.call(reviewFields, "shift_end_time")) reviewFields.shift_end_time = normalizeShiftTime(reviewFields.shift_end_time == null ? null : String(reviewFields.shift_end_time));
  draft.review_fields = reviewFields;
  return draft;
}

type IdentityMatch = {
  id: string;
  ref: string;
  email: string | null;
  phone: string | null;
  full_name: string | null;
  date_of_birth: string | null;
};

/**
 * Existing clients reachable by any imported email or phone.
 *
 * Name and date of birth come back too: an email match alone does not decide a
 * duplicate, because one email may serve several applicants, so the caller
 * needs the identity signals to correlate against.
 */
async function identityIndex(rows: { email: string | null; phone: string | null }[]) {
  const emails = [...new Set(rows.map((row) => normalizeClientEmail(row.email)).filter((value): value is string => Boolean(value)))];
  const phones = [...new Set(rows.map((row) => normalizeClientPhone(row.phone)).filter((value): value is string => Boolean(value)))];
  if (!emails.length && !phones.length) return [] as IdentityMatch[];
  return sql()`
    select id,ref,email,phone,full_name,date_of_birth::text as date_of_birth
    from clients
    where deleted_at is null
      and (
        (${emails.length > 0} and lower(trim(coalesce(email,''))) = any(${emails}::text[]))
        or (${phones.length > 0} and regexp_replace(coalesce(phone,''),'\\D','','g') = any(${phones}::text[]))
      )
    order by created_at` as unknown as IdentityMatch[];
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
    const applicant = applicantIdentity({
      fullName: item.summary.full_name,
      // The prepared draft carries the normalized ISO date; the raw cell may
      // still be MM/DD/YYYY.
      dateOfBirth: item.draft?.profile.date_of_birth ?? null,
      phone: item.summary.phone,
    });

    const emailMatches = matches.filter((match) => {
      const m = identityKey(match.email, match.phone);
      return Boolean(identity.email && m.email === identity.email);
    });
    // A shared phone alone is not applicant identity: relatives may share
    // both their contact email and phone. Require corroborating evidence.
    const sharesApplicant = (match: IdentityMatch) =>
      sameApplicant(applicant, applicantIdentity({
        fullName: match.full_name,
        dateOfBirth: match.date_of_birth,
        phone: match.phone,
      }));
    const rowMatches = matches.filter(sharesApplicant);

    // Same email, no agreeing identity signal: a different applicant using a
    // relative's address. Allowed, and surfaced so staff can see why.
    const sharedEmailOnly = !rowMatches.length && emailMatches.length > 0 ? emailMatches[0] : null;

    const sharedPhoneOnly = !rowMatches.length ? matches.find(match => {
      const m = identityKey(match.email, match.phone);
      return Boolean(identity.phone && identity.phone.length >= 7 && m.phone === identity.phone);
    }) : null;
    const exact = rowMatches.find((match) => {
      const m = identityKey(match.email, match.phone);
      return Boolean(identity.email && identity.phone && m.email === identity.email && m.phone === identity.phone);
    });
    const identityState = exact ? "EXISTING_CLIENT" : rowMatches.length ? "POSSIBLE_DUPLICATE" : "NEW";
    const result = item.error ? "INVALID" : rowMatches.length ? "DUPLICATE" : "VALID";
    const first = exact ?? rowMatches[0] ?? null;
    const message = item.error
      ?? (first ? `Existing client ${first.ref} matches imported identity` : null)
      ?? (sharedPhoneOnly ? `Phone already used by ${sharedPhoneOnly.ref}; verify the applicant. Creation remains available.` : null)
      ?? (sharedEmailOnly ? `Email already used by ${sharedEmailOnly.ref}; a different applicant may share it` : null);
    return {
      row: item.index + 2,
      result,
      identity: identityState,
      ...item.summary,
      message,
      // A shared email is not a conflict, so it records no existing client:
      // staging must not raise an identity conflict against a different person.
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
    const [batch] = await tx`
      insert into client_import_batches(source_type,source_file_hash,idempotency_key,created_by,metadata)
      values(${source},${sourceHash(args.rows)},${key},${args.session.staff.id},${tx.json((args.metadata ?? {}) as never)})
      on conflict (created_by,idempotency_key) do update
        set idempotency_key=excluded.idempotency_key
        where client_import_batches.source_file_hash=excluded.source_file_hash
          and client_import_batches.source_type=excluded.source_type
      returning id,(xmax=0) as inserted`;
    if (!batch) throw new ActionError("idempotency_conflict", "This import key belongs to a different source file", 409);
    if (!batch.inserted) {
      const cases = await tx`select id,status,source_row,created_at from client_import_cases where batch_id=${batch.id} order by source_row nulls last`;
      return { batch_id: String(batch.id), staged: cases.length, cases, idempotent: true };
    }
    const cases = [] as { id: string; status: string; source_row: number; created_at: Date }[];
    for (const row of candidates) {
      const conflicts = row.existing_client_id
        ? [{ type: "IDENTITY", client_id: row.existing_client_id, client_ref: row.existing_client_ref, message: row.message }]
        : [];
      const draft = row.draft as PreparedImportDraft;
      const evidence = sheetEvidence(row.raw, draft, source, row.row);
      const [created] = await tx`
        insert into client_import_cases(
          batch_id,source_type,source_row,status,raw_input,mapped_draft,missing_fields,conflicts,field_evidence,verification_result,created_by
        ) values(
          ${batch.id},${source},${row.row},'PENDING',${tx.json(row.raw as never)},${tx.json(draft as never)},'[]'::jsonb,
          ${tx.json(conflicts as never)},${tx.json(evidence as never)},
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

function canonicalEvidence(rows: { row: IntakeRow; source: string; confidence?: Record<string, number> }[]) {
  const fields = [
    "full_name","phone","email","date_of_birth","preferred_language","english_proficiency","street","city","state","zip",
    "site_code","job_id","shift_code","shift_days","shift_start_time","shift_end_time","backup_site_code","backup_job_id","backup_shift_code",
  ] as const;
  const merged: IntakeRow = {};
  const evidence: Record<string, unknown>[] = [];
  const conflicts: Record<string, unknown>[] = [];
  for (const field of fields) {
    const values = rows
      .map((source) => ({ value: pickImportValue(source.row, field), source: source.source, confidence_score: source.confidence?.[field] ?? null }))
      .filter((item): item is { value: string; source: string; confidence_score: number | null } => Boolean(item.value));
    const unique = [...new Map(values.map((item) => [item.value.trim().toLowerCase(), item])).values()];
    if (unique.length === 1) {
      merged[field] = unique[0].value;
      evidence.push({ field_key: field, value: unique[0].value, source_type: unique[0].source, verification_state: "MATCHED", authority: "SOURCE", confidence_score: unique[0].confidence_score });
    } else if (unique.length > 1) {
      conflicts.push({ field_key: field, values: unique, type: "SOURCE_CONFLICT" });
      for (const item of unique) evidence.push({ field_key: field, value: item.value, source_type: item.source, verification_state: "CONFLICT", authority: "SOURCE", confidence_score: item.confidence_score });
    }
  }
  return { merged, evidence, conflicts };
}

function partialDraft(row: IntakeRow, notes: string) {
  try { return prepareImportDraft({ ...row, initial_note: notes || row.initial_note || null }); }
  catch {
    const rawLanguage = pickImportValue(row, "preferred_language");
    return {
      profile: {
        full_name: pickImportValue(row, "full_name") ?? "",
        phone: pickImportValue(row, "phone") ?? "",
        email: pickImportValue(row, "email"),
        date_of_birth: pickImportValue(row, "date_of_birth"),
        preferred_language: rawLanguage ? normalizeImportLanguage(rawLanguage) : null,
        english_proficiency: normalizeEnglishProficiency(pickImportValue(row, "english_proficiency")),
        street: pickImportValue(row, "street"), city: pickImportValue(row, "city"), state: pickImportValue(row, "state"), zip: pickImportValue(row, "zip"),
        appointment_availability: null, amazon_worked_before: null, amazon_worked_from: null, amazon_worked_to: null,
        amazon_applied_before: null, currently_amazon: null, via_agency: null, amazon_application_email: null, employment_history: [],
      },
      primary: [], backup: [],
      review_fields: {
        first_name: pickImportValue(row, "first_name"),
        middle_name: pickImportValue(row, "middle_name"),
        last_name: pickImportValue(row, "last_name"),
        work_location_candidates: pickImportValue(row, "work_location_candidates"),
        preferred_location: pickImportValue(row, "site_code"),
        location_option_1: pickImportValue(row, "alt_site_code"),
        location_option_2: pickImportValue(row, "backup_site_code"),
        preferred_shift: pickImportValue(row, "shift_code"),
        shift_days: normalizeShiftDays(pickImportValue(row, "shift_days")),
        shift_start_time: normalizeShiftTime(pickImportValue(row, "shift_start_time")),
        shift_end_time: normalizeShiftTime(pickImportValue(row, "shift_end_time")),
        additional_notes: pickImportValue(row, "additional_notes"),
      },
      status: "new_intake", next_step: null, staff_code: null, initial_note: notes || null,
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

  const extracted: { row: IntakeRow; source: string; confidence?: Record<string, number>; error?: string }[] = [];
  const fileData: { file: File; bytes: Uint8Array; sha256: string; extractedRows: IntakeRow[]; confidence: Record<string, number>; extractionError: string | null }[] = [];
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
    let confidence: Record<string, number> = {};
    let extractionError: string | null = null;
    try {
      const detailed = await rowsFromImageOrPdfDetailed(bytes, file.type);
      rows = detailed.map((item) => item.row);
      confidence = { ...(detailed[0]?.confidence ?? {}) };
    } catch (error) {
      extractionError = error instanceof Error ? error.message : "Extraction failed";
    }
    if (rows[0]) extracted.push({ row: rows[0], source: file.name || file.type, confidence });
    fileData.push({ file, bytes, sha256, extractedRows: rows, confidence, extractionError });
  }

  const merged = canonicalEvidence(extracted);
  const draft = partialDraft(merged.merged, notes);
  const missing = requiredMissingFromDraft(draft);
  const key = args.idempotencyKey.trim();
  if (key.length < 8 || key.length > 200) throw new ActionError("invalid_idempotency_key", "A valid idempotency key is required", 400);

  const captureGeneration = randomUUID();
  const created = await sql().begin(async (tx) => {
    const [existing] = await tx`select id from client_import_batches where created_by=${args.session.staff.id} and idempotency_key=${key}`;
    if (existing) {
      const [caseRow] = await tx`select id,status,public_ref,verification_result from client_import_cases where batch_id=${existing.id} order by created_at limit 1`;
      if (["CAPTURING", "CAPTURE_FAILED", "CAPTURE_INTERRUPTED"].includes(String(caseRow.verification_result?.processing_state ?? ""))) {
        throw new ActionError("capture_incomplete", "The previous submission needs staff review before it can be completed", 409);
      }
      return { batchId: String(existing.id), caseId: String(caseRow.id), publicRef: String(caseRow.public_ref), idempotent: true };
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
        ${tx.json({ extraction_errors: extractionErrors, processing_state: "CAPTURING", capture_generation: captureGeneration } as never)},${args.session.staff.id}
      ) returning id,public_ref`;
    return { batchId: String(batch.id), caseId: String(caseRow.id), publicRef: String(caseRow.public_ref), idempotent: false };
  });
  if (created.idempotent) return { batch_id: created.batchId, case_id: created.caseId, public_ref: created.publicRef, idempotent: true };

  const uploadedPaths: string[] = [];
  const persistedPaths = new Set<string>();
  try {
    for (const entry of fileData) {
      const path = `smart-import/${created.caseId}/${randomUUID()}-${safeFilename(entry.file.name || "upload")}`;
      await uploadObject(path, entry.bytes, entry.file.type);
      uploadedPaths.push(path);
      await sql().begin(async tx => {
        await assertCaptureLease(tx, created.caseId, captureGeneration);
        await tx`
        insert into client_import_documents(import_case_id,storage_reference,original_filename,mime_type,size_bytes,sha256,detected_document_type,extraction_metadata,uploaded_by)
        values(${created.caseId},${path},${safeFilename(entry.file.name || "upload")},${entry.file.type},${entry.file.size},${entry.sha256},'other',
          ${tx.json({ extracted_rows: entry.extractedRows.length, confidence: entry.confidence, extraction_error: entry.extractionError } as never)},${args.session.staff.id})`;
        await tx`
        insert into system_jobs(job_type,status,import_case_id,source_name,provider,confidence,result,error,created_by,completed_at)
        values('smart_document_extraction',${entry.extractionError ? "FAILED" : "COMPLETED"},${created.caseId},${safeFilename(entry.file.name || "upload")},'gemini',
          ${tx.json(entry.confidence as never)},${tx.json({ extracted_rows: entry.extractedRows.length, sha256: entry.sha256 } as never)},
          ${entry.extractionError},${args.session.staff.id},now())`;
      });
      persistedPaths.add(path);
    }
    await sql().begin(async tx => {
      await assertCaptureLease(tx, created.caseId, captureGeneration);
      await tx`update client_import_cases set verification_result=coalesce(verification_result,'{}'::jsonb) || ${tx.json({ processing_state: "CAPTURED" } as never)} where id=${created.caseId}`;
    });
  } catch (error) {
    for (const path of uploadedPaths) if (!persistedPaths.has(path)) await removeObject(path).catch(() => undefined);
    await sql()`update client_import_cases set verification_result=coalesce(verification_result,'{}'::jsonb) || ${sql().json({ processing_state: "CAPTURE_FAILED", source_capture_incomplete: true, capture_error: "Source upload did not complete; attach remaining documents before continuing." } as never)}
      where id=${created.caseId} and verification_result->>'processing_state'='CAPTURING' and verification_result->>'capture_generation'=${captureGeneration}`;
    throw error;
  }
  return { batch_id: created.batchId, case_id: created.caseId, public_ref: created.publicRef, idempotent: false };
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
  await assertImportReviewPermission(session);
  const [row] = await sql()`
    select c.*,to_char(c.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,c.revision::text as revision,
      s.display_name as reviewer_name,a.display_name as approved_by_name
    from client_import_cases c
    left join staff s on s.id=c.reviewer_id
    left join staff a on a.id=c.approved_by
    where c.id=${id} and (${session.staff.role !== "staff"} or c.reviewer_id=${session.staff.id})`;
  if (!row) throw new ActionError("not_found", "Import case not found", 404);
  if (row.archived_at && row.status !== "APPROVED_FILE") throw new ActionError("archived", "Import case is archived", 409);
  const docs = await sql()`
    select id,original_filename,mime_type,size_bytes,detected_document_type,extraction_metadata,created_at
    from client_import_documents where import_case_id=${id} order by created_at,id`;
  return { case: row, documents: docs };
}

function assertReviewOwnership(assignedReviewer: unknown, requestedReviewer: string) {
  if (assignedReviewer && String(assignedReviewer) !== requestedReviewer) {
    throw new ActionError("review_assigned", "This import is already assigned to a different reviewer", 409);
  }
}

async function requireActiveReviewer(tx: Tx, id: string) {
  const [reviewer] = await tx`select id from staff where id=${id} and active`;
  if (!reviewer) throw new ActionError("invalid_reviewer", "Reviewer is not an active staff member", 400);
  return String(reviewer.id);
}

export async function recoverImportCapture(session: StaffSession, id: string, expectedRevision: string, traceId: string) {
  assertManager(session);
  if (!expectedRevision) throw new ActionError("review_version_required", "Reload the import before recovery", 409);
  return sql().begin(async tx => {
    const [row] = await tx`select id,status,archived_at,verification_result,to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,revision::text as revision from client_import_cases where id=${id} for update`;
    if (!row) throw new ActionError("not_found", "Import case not found", 404);
    if (row.archived_at || row.status === "APPROVED_FILE") throw new ActionError("archived", "Import case is archived", 409);
    assertReviewVersion(row.revision, expectedRevision);
    const result = (row.verification_result ?? {}) as Record<string, unknown>;
    if (result.processing_state !== "CAPTURING") throw new ActionError("capture_not_active", "Source capture is not active", 409);
    const [count] = await tx`select count(*)::int as n from client_import_documents where import_case_id=${id}`;
    const recovered = { ...result, processing_state: "CAPTURE_INTERRUPTED", source_capture_incomplete: true, capture_error: "Capture was interrupted; attach remaining documents before continuing.", capture_recovered_by: session.staff.id, capture_recovered_at: new Date().toISOString(), document_count: Number(count.n) };
    const [updated] = await tx`update client_import_cases set verification_result=${tx.json(recovered as never)} where id=${id}
      returning to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,revision::text as revision`;
    await tx`insert into security_events(event,staff_id,route,detail,trace_id)
      values('smart_import_capture_recovered',${session.staff.id},'/api/staff/smart-client-import',${tx.json({ case_id: id, document_count: Number(count.n), capture_generation: typeof result.capture_generation === "string" ? result.capture_generation : null })},${traceId})`;
    return { state: "CAPTURE_INTERRUPTED", document_count: Number(count.n), updated_at: updated.updated_at, revision: updated.revision };
  });
}

export async function assignImportReviewer(session: StaffSession, id: string, reviewerId: string, expectedRevision: string, traceId: string) {
  assertManager(session);
  if (!expectedRevision) throw new ActionError("review_version_required", "Reload the review before continuing", 409);
  return sql().begin(async (tx) => {
    const [row] = await tx`select id,status,reviewer_id,archived_at,verification_result,to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,revision::text as revision from client_import_cases where id=${id} for update`;
    if (!row) throw new ActionError("not_found", "Import case not found", 404);
    if (row.archived_at || row.status === "APPROVED_FILE") throw new ActionError("archived", "Import case is archived", 409);
    assertReviewVersion(row.revision, expectedRevision);
    assertCaptureFinished(row.verification_result);
    if (hasPendingOverride(row.verification_result)) throw new ActionError("pending_override_active", "Cancel the pending override before changing the reviewer", 409);
    const [reviewer] = await tx`select id,role,permission_mode,custom_permissions from staff where id=${reviewerId} and active for share`;
    if (!reviewer) throw new ActionError("invalid_reviewer", "Reviewer is not an active staff member", 400);
    if (reviewer.role === "staff" && reviewer.permission_mode !== "full" &&
        !(reviewer.permission_mode === "custom" && Array.isArray(reviewer.custom_permissions) && reviewer.custom_permissions.includes("review_smart_import"))) {
      throw new ActionError("invalid_reviewer", "Reviewer lacks smart import review permission", 400);
    }
    if (String(row.reviewer_id ?? "") === reviewerId) return { id, reviewer_id: reviewerId, idempotent: true };
    await tx`update client_import_cases set reviewer_id=${reviewerId} where id=${id}`;
    await tx`insert into security_events(event,staff_id,route,detail,trace_id)
      values('smart_import_reviewer_assigned',${session.staff.id},'/api/staff/smart-client-import',
        ${tx.json({ case_id: id, previous_reviewer_id: row.reviewer_id ?? null, reviewer_id: reviewerId })},${traceId})`;
    return { id, reviewer_id: reviewerId, idempotent: false };
  });
}

export async function startImportReview(session: StaffSession, id: string, reviewerId: string, expectedRevision?: string) {
  requireReviewVersion(expectedRevision);
  await assertImportReviewPermission(session);
  return sql().begin(async (tx) => {
    await requireActiveReviewer(tx, reviewerId);
    const [row] = await tx`select id,status,reviewer_id,review_started_at,archived_at,verification_result,revision::text as revision from client_import_cases where id=${id} for update`;
    if (!row) throw new ActionError("not_found", "Import case not found", 404);
    await assertAssignedReviewer(tx, session, row.reviewer_id, reviewerId);
    assertReviewVersion(row.revision, expectedRevision);
    if (row.status === "APPROVED_FILE") throw new ActionError("already_approved", "Approved imports cannot be reopened", 409);
    if (row.archived_at) throw new ActionError("archived", "Import case is archived", 409);
    assertCaptureFinished(row.verification_result);
    if (hasPendingOverride(row.verification_result)) throw new ActionError("pending_override_active", "Cancel the pending override before changing this review", 409);
    assertReviewOwnership(row.reviewer_id, reviewerId);
    const [updated] = await tx`
      update client_import_cases
      set reviewer_id=${reviewerId},review_started_at=coalesce(review_started_at,now()),status='UNDER_REVIEW'
      where id=${id}
      returning id,status,reviewer_id,review_started_at,
        to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,revision::text as revision`;
    return updated;
  });
}

export async function saveImportReview(session: StaffSession, args: {
  id: string;
  reviewerId: string;
  draft: unknown;
  documentConfirmed: boolean;
  informationConfirmed: boolean;
  resolvedFields?: string[];
  expectedRevision?: string;
}) {
  await assertImportReviewPermission(session);
  requireReviewVersion(args.expectedRevision);
  if (!JsonObject.safeParse(args.draft).success) throw new ActionError("invalid_draft", "Mapped draft must be an object", 400);
  return sql().begin(async (tx) => {
    await requireActiveReviewer(tx, args.reviewerId);
    const [row] = await tx`select id,status,reviewer_id,review_started_at,mapped_draft,field_evidence,conflicts,verification_result,
      to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,revision::text as revision,archived_at
      from client_import_cases where id=${args.id} for update`;
    if (!row) throw new ActionError("not_found", "Import case not found", 404);
    await assertAssignedReviewer(tx, session, row.reviewer_id, args.reviewerId);
    if (row.status === "APPROVED_FILE") throw new ActionError("already_approved", "Approved imports cannot be changed", 409);
    if (row.archived_at) throw new ActionError("archived", "Import case is archived", 409);
    assertCaptureFinished(row.verification_result);
    assertReviewVersion(row.revision, args.expectedRevision);
    if (hasPendingOverride(row.verification_result)) throw new ActionError("pending_override_active", "Cancel the pending override before editing this review", 409);
    assertReviewOwnership(row.reviewer_id, args.reviewerId);
    const sanitizedDraft = sanitizeReviewDraft(args.draft);
    let storedDraft: unknown = sanitizedDraft;
    try { storedDraft = normalizePreparedDraft(sanitizedDraft); } catch { /* preserve reviewable invalid state; verify/approve remains authoritative */ }
    const missing = requiredMissingFromDraft(storedDraft);
    const conflicts = resolveReviewConflicts(row.conflicts, args.resolvedFields);
    const evidence = mergeManualEvidence(row.field_evidence, row.mapped_draft, storedDraft, args.reviewerId, {
      resolvedFields: args.resolvedFields,
      conflicts: Array.isArray(row.conflicts) ? row.conflicts : [],
      actorId: session.staff.id,
    });
    const [updated] = await tx`
      update client_import_cases set
        reviewer_id=${args.reviewerId},review_started_at=coalesce(review_started_at,now()),reviewed_at=now(),
        mapped_draft=${tx.json(storedDraft as never)},missing_fields=${tx.json(missing as never)},field_evidence=${tx.json(evidence as never)},
        conflicts=${tx.json(conflicts as never)},verification_result=${tx.json(preserveCaptureStatus(row.verification_result) as never)},
        document_match_confirmed=${args.documentConfirmed},information_match_confirmed=${args.informationConfirmed},
        status=case when status='PENDING' then 'UNDER_REVIEW' else status end
      where id=${args.id}
      returning id,status,to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,revision::text as revision`;
    return updated;
  });
}

async function resolveImportedStaff(tx: Tx, code: string | null) {
  if (!code) return null;
  const [staff] = await tx`select id from staff where active and lower(coalesce(staff_code,''))=lower(${code}) limit 1`;
  if (!staff) throw new ActionError("invalid_staff_code", `Active staff code not found: ${code}`, 400);
  return String(staff.id);
}

async function verifyLockedCase(tx: Tx, row: Record<string, unknown>) {
  const docs = await tx`select count(*)::int as count from client_import_documents where import_case_id=${String(row.id)}`;
  const documentCount = Number(docs[0]?.count ?? 0);
  const conflicts = Array.isArray(row.conflicts) ? row.conflicts as unknown[] : [];
  // Identity findings are derived from the current draft and live files. Drop
  // stale findings before rechecking, while retaining every other conflict.
  const sourceConflicts = conflicts.filter(isSourceReviewConflict);
  const remainingConflicts = conflicts.filter(conflict =>
    !(conflict && typeof conflict === "object" && "type" in conflict && conflict.type === "IDENTITY"));
  const blockingConflicts = remainingConflicts.filter((conflict) => !isSourceReviewConflict(conflict));

  // Identity is resolved first: a duplicate is a destructive-conflict blocker.
  const persistable = assessApproval({ mappedDraft: row.mapped_draft });
  let identityMatches: Awaited<ReturnType<typeof findClientIdentityMatches>> = [];
  // Public intake links are a separate origin inside the existing mobile staging
  // model; they retain the shared-contact policy throughout verification.
  const [batchOrigin] = await tx`
    select idempotency_key from client_import_batches where id=${String(row.batch_id)}`;
  const fromPublicLink = String(batchOrigin?.idempotency_key ?? "").startsWith("client-link:");
  if (persistable.draft) {
    identityMatches = await findClientIdentityMatches(tx, persistable.draft.profile.email, persistable.draft.profile.phone, {
      lock: true,
      fullName: persistable.draft.profile.full_name,
      dateOfBirth: persistable.draft.profile.date_of_birth,
      policy: fromPublicLink ? "public" : "staff",
    });
    if (identityMatches.length) blockingConflicts.push({ type: "IDENTITY", client_id: identityMatches[0].id, client_ref: identityMatches[0].ref });
  }

  const assessment = assessApproval({
    mappedDraft: row.mapped_draft,
    conflicts: [...sourceConflicts, ...blockingConflicts],
    reviewerAssigned: Boolean(row.reviewer_id),
    confirmationsRecorded: Boolean(row.document_match_confirmed) && Boolean(row.information_match_confirmed),
    documentCount,
  });
  if (incompleteCapture(row.verification_result)) {
    assessment.warnings.push({ field: "source_capture", state: "MISSING", message: "Source capture was interrupted; remaining documents must be collected." });
    if (assessment.readiness === "READY_TO_APPROVE") assessment.readiness = "APPROVE_WITH_WARNINGS";
  }
  const approvalReady = assessment.readiness !== "BLOCKED";
  // Optional gaps are reported, never used to withhold approval.
  const missing = assessment.warnings.filter((warning) => warning.state === "MISSING").map((warning) => warning.field);

  return {
    draft: assessment.draft,
    missing,
    documentCount,
    blockingConflicts,
    sourceConflicts,
    conflicts: [...sourceConflicts, ...blockingConflicts],
    assessment,
    result: {
      state: approvalReady ? (documentCount > 0 ? "READY" : "MISSING_DOCUMENT") : "REVIEW_REQUIRED",
      approval_ready: approvalReady,
      readiness: assessment.readiness,
      blockers: assessment.blockers,
      warnings: assessment.warnings,
      client_schema_valid: Boolean(assessment.draft),
      document_count: documentCount,
      blocking_conflicts: blockingConflicts.length,
      source_conflicts: sourceConflicts.length,
      follow_up_required: assessment.warnings.length > 0,
      document_match_confirmed: Boolean(row.document_match_confirmed),
      information_match_confirmed: Boolean(row.information_match_confirmed),
      identity: identityMatches.length ? "POSSIBLE_DUPLICATE" : "NEW",
      validation_error: assessment.blockers[0]?.message ?? null,
      checked_at: new Date().toISOString(),
    },
  };
}

export async function beginImportOverride(session: StaffSession, args: {
  id: string; reviewerId: string; draft: unknown; documentConfirmed: boolean; informationConfirmed: boolean;
  resolvedFields?: string[]; expectedRevision: string; traceId: string;
}) {
  await assertImportReviewPermission(session);
  if (!args.expectedRevision) throw new ActionError("review_version_required", "Reload the review before continuing", 409);
  if (!JsonObject.safeParse(args.draft).success) throw new ActionError("invalid_draft", "Mapped draft must be an object", 400);
  return sql().begin(async tx => {
    const [row] = await tx`select *,to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,revision::text as revision from client_import_cases where id=${args.id} for update`;
    if (!row) throw new ActionError("not_found", "Import case not found", 404);
    await assertAssignedReviewer(tx, session, row.reviewer_id, args.reviewerId);
    if (row.archived_at || row.status === "APPROVED_FILE") throw new ActionError("archived", "Import case is archived", 409);
    assertReviewVersion(row.revision, args.expectedRevision);
    assertReviewOwnership(row.reviewer_id, args.reviewerId);
    assertCaptureFinished(row.verification_result);
    if (hasPendingOverride(row.verification_result)) throw new ActionError("pending_override_active", "A pending override already exists", 409);
    await requireActiveReviewer(tx, args.reviewerId);
    const conflicts = resolveReviewConflicts(row.conflicts, args.resolvedFields);
    const verification = await verifyLockedCase(tx, { ...row, mapped_draft: args.draft, reviewer_id: args.reviewerId,
      document_match_confirmed: args.documentConfirmed, information_match_confirmed: args.informationConfirmed, conflicts });
    if (!verification.draft) throw new ActionError("approval_blocked", verification.result.validation_error || "This file cannot be approved", 409);
    const missing = verification.assessment.warnings.filter(warning => warning.state === "MISSING").map(warning => warning.field);
    if (!missing.length) throw new ActionError("override_not_required", "No missing item requires an override", 409);
    const evidence = mergeManualEvidence(row.field_evidence, row.mapped_draft, verification.draft, args.reviewerId, {
      resolvedFields: args.resolvedFields, conflicts: Array.isArray(row.conflicts) ? row.conflicts : [], actorId: session.staff.id,
    });
    const workflowOverride = { state: "PENDING_OVERRIDE", started_by: session.staff.id, reviewer_id: args.reviewerId, started_at: new Date().toISOString(), outstanding_fields: missing };
    const [updated] = await tx`update client_import_cases set reviewer_id=${args.reviewerId},review_started_at=coalesce(review_started_at,now()),
      status=case when status='PENDING' then 'UNDER_REVIEW' else status end, mapped_draft=${tx.json(verification.draft as never)},
      field_evidence=${tx.json(evidence as never)},missing_fields=${tx.json(verification.missing as never)}, conflicts=${tx.json(verification.conflicts as never)},
      document_match_confirmed=${args.documentConfirmed},information_match_confirmed=${args.informationConfirmed},
      verification_result=${tx.json({ ...preserveCaptureStatus(row.verification_result), ...verification.result, workflow_override: workflowOverride } as never)}
      where id=${args.id} returning to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,revision::text as revision`;
    await tx`insert into security_events(event,staff_id,route,detail,trace_id)
      values('smart_import_override_pending',${session.staff.id},'/api/staff/smart-client-import',${tx.json({ case_id: args.id, reviewer_id: args.reviewerId, outstanding_fields: missing })},${args.traceId})`;
    return { updated_at: updated.updated_at, revision: updated.revision, state: "PENDING_OVERRIDE" };
  });
}

export async function cancelImportOverride(session: StaffSession, id: string, expectedRevision: string, traceId: string) {
  await assertImportReviewPermission(session);
  if (!expectedRevision) throw new ActionError("review_version_required", "Reload the review before continuing", 409);
  return sql().begin(async tx => {
    const [row] = await tx`select id,status,reviewer_id,archived_at,verification_result,to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,revision::text as revision from client_import_cases where id=${id} for update`;
    if (!row) throw new ActionError("not_found", "Import case not found", 404);
    await assertAssignedReviewer(tx, session, row.reviewer_id);
    if (row.archived_at || row.status === "APPROVED_FILE") throw new ActionError("archived", "Import case is archived", 409);
    assertReviewVersion(row.revision, expectedRevision);
    if (!hasPendingOverride(row.verification_result)) throw new ActionError("no_pending_override", "No override is pending", 409);
    const result = row.verification_result as Record<string, unknown>;
    const workflow = result.workflow_override as Record<string, unknown>;
    const [updated] = await tx`update client_import_cases set verification_result=${tx.json({ ...result, workflow_override: { ...workflow, state: "CANCELLED", cancelled_by: session.staff.id, cancelled_at: new Date().toISOString() } } as never)} where id=${id}
      returning to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,revision::text as revision`;
    await tx`insert into security_events(event,staff_id,route,detail,trace_id)
      values('smart_import_override_cancelled',${session.staff.id},'/api/staff/smart-client-import',${tx.json({ case_id: id })},${traceId})`;
    return { updated_at: updated.updated_at, revision: updated.revision, state: "CANCELLED" };
  });
}

export async function verifyImportCase(session: StaffSession, id: string, expectedRevision?: string) {
  await assertImportReviewPermission(session);
  requireReviewVersion(expectedRevision);
  return sql().begin(async (tx) => {
    const [row] = await tx`select *,to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,revision::text as revision from client_import_cases where id=${id} for update`;
    if (!row) throw new ActionError("not_found", "Import case not found", 404);
    await assertAssignedReviewer(tx, session, row.reviewer_id);
    if (row.status === "APPROVED_FILE") throw new ActionError("already_approved", "Import is already approved", 409);
    if (row.archived_at) throw new ActionError("archived", "Import case is archived", 409);
    assertCaptureFinished(row.verification_result);
    assertReviewVersion(row.revision, expectedRevision);
    if (hasPendingOverride(row.verification_result)) throw new ActionError("pending_override_active", "Cancel the pending override before verifying this review", 409);
    const verification = await verifyLockedCase(tx, row as Record<string, unknown>);
    // The case guard only allows PENDING -> UNDER_REVIEW, so a pending case verifies
    // into UNDER_REVIEW regardless of its document count.
    const nextStatus = row.status !== "PENDING" && verification.result.approval_ready && verification.documentCount === 0
      ? "MISSING_DOCUMENT"
      : "UNDER_REVIEW";
    const [updated] = await tx`
      update client_import_cases set missing_fields=${tx.json(verification.missing as never)},conflicts=${tx.json(verification.conflicts as never)},
        verification_result=${tx.json({ ...preserveCaptureStatus(row.verification_result), ...verification.result } as never)},reviewed_at=now(),status=${nextStatus}
      where id=${id}
      returning to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,revision::text as revision`;
    return { ...verification.result, updated_at: updated.updated_at, revision: updated.revision };
  });
}

export async function approveImportCase(session: StaffSession, args: {
  id: string;
  reviewerId: string;
  draft: unknown;
  documentConfirmed: boolean;
  informationConfirmed: boolean;
  traceId: string;
  resolvedFields?: string[];
  expectedRevision?: string;
  override?: boolean;
  overrideReason?: string;
}) {
  await assertImportReviewPermission(session);
  requireReviewVersion(args.expectedRevision);
  return sql().begin(async (tx) => {
    await requireActiveReviewer(tx, args.reviewerId);
    const [row] = await tx`select *,to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,revision::text as revision from client_import_cases where id=${args.id} for update`;
    if (!row) throw new ActionError("not_found", "Import case not found", 404);
    await assertAssignedReviewer(tx, session, row.reviewer_id, args.reviewerId);
    if (row.status === "APPROVED_FILE") {
      if (row.created_client_id) return { client_id: String(row.created_client_id), idempotent: true };
      throw new ActionError("invalid_approved_state", "Approved import is missing its client reference", 500);
    }
    if (row.archived_at) throw new ActionError("archived", "Import case is archived", 409);
    assertCaptureFinished(row.verification_result);
    assertReviewVersion(row.revision, args.expectedRevision);
    assertReviewOwnership(row.reviewer_id, args.reviewerId);
    if (hasPendingOverride(row.verification_result) && !args.expectedRevision) throw new ActionError("review_version_required", "Reload the pending review before approving", 409);
    if (hasPendingOverride(row.verification_result) && (!isDeepStrictEqual(args.draft, row.mapped_draft) ||
      args.documentConfirmed !== Boolean(row.document_match_confirmed) || args.informationConfirmed !== Boolean(row.information_match_confirmed) ||
      (args.resolvedFields?.length ?? 0) > 0)) {
      throw new ActionError("review_changed", "The pending override must use the saved review. Cancel it to make changes.", 409);
    }
    // The case guard only permits PENDING -> UNDER_REVIEW, so approval performs that
    // legal transition itself instead of requiring a separate START REVIEW step. The
    // reviewer and the review start time are still recorded for the audit trail.
    if (row.status === "PENDING") {
      await tx`
        update client_import_cases
        set reviewer_id=${args.reviewerId},review_started_at=coalesce(review_started_at,now()),status='UNDER_REVIEW'
        where id=${args.id}`;
      row.status = "UNDER_REVIEW";
    }

    const conflicts = resolveReviewConflicts(row.conflicts, args.resolvedFields);
    const verificationRow = { ...row, mapped_draft: args.draft, reviewer_id: args.reviewerId, document_match_confirmed: args.documentConfirmed, information_match_confirmed: args.informationConfirmed, conflicts } as Record<string, unknown>;
    const verification = await verifyLockedCase(tx, verificationRow);
    if (!verification.draft) {
      throw new ActionError("approval_blocked", verification.result.validation_error || "This file cannot be saved as a Client yet", 409);
    }
    // Deferral is explicit and audited. This does not relax canonical identity,
    // duplicate, reviewer ownership or optimistic concurrency checks above.
    const missingItems = verification.assessment.warnings.filter((warning) => warning.state === "MISSING");
    const overrideRequired = missingItems.length > 0;
    const overrideReason = String(args.overrideReason ?? "").trim();
    if (overrideRequired && (args.override !== true || overrideReason.length < 8)) {
      throw new ActionError("override_required", "Missing documents or data require an explicit approval and a reason of at least 8 characters.", 409);
    }
    if (overrideRequired && !hasPendingOverride(row.verification_result)) {
      throw new ActionError("pending_override_required", "Start the pending override before approving missing items.", 409);
    }
    if (overrideReason.length > 1000) throw new ActionError("invalid_override_reason", "Keep the override reason within 1,000 characters.", 400);
    const override = overrideRequired ? {
      approved_with_missing_items: true, reason: overrideReason, actor_id: session.staff.id,
      reviewer_id: args.reviewerId, approved_at: new Date().toISOString(),
      outstanding_fields: missingItems.map((warning) => warning.field),
    } : null;
    const previousWorkflow = hasPendingOverride(row.verification_result)
      ? (row.verification_result as Record<string, unknown>).workflow_override as Record<string, unknown> : null;
    const approvalResult = { ...preserveCaptureStatus(row.verification_result), ...verification.result, override, ...(previousWorkflow ? { workflow_override: { ...previousWorkflow, state: "APPROVED", completed_by: session.staff.id, completed_at: new Date().toISOString() } } : {}) };
    // Approve the persistable draft: optional values that cannot satisfy their canonical
    // type were cleared and are reported as warnings, with their source evidence intact.
    const draft = verification.draft;
    const evidence = mergeManualEvidence(row.field_evidence, row.mapped_draft, draft, args.reviewerId, {
      resolvedFields: args.resolvedFields,
      conflicts: Array.isArray(row.conflicts) ? row.conflicts : [],
      actorId: session.staff.id,
    });

    const resolvedStaff = await resolveImportedStaff(tx, draft.staff_code);
    if (session.staff.role === "staff" && (draft.status !== "new_intake" || (resolvedStaff && resolvedStaff !== session.staff.id))) {
      throw new ActionError("forbidden", "Staff may only create an intake file assigned to themselves", 403);
    }
    const assignedStaff = session.staff.role === "staff" ? session.staff.id : resolvedStaff;
    const [sourceBatch] = await tx`select idempotency_key from client_import_batches where id=${String(row.batch_id)}`;
    const publicLinkImport = String(sourceBatch?.idempotency_key ?? "").startsWith("client-link:");
    const client = await insertClient(tx, {
      source: publicLinkImport ? "public_intake" : "staff_manual",
      profile: draft.profile,
      primary: draft.primary,
      backup: draft.backup,
      reviewFields: draft.review_fields,
      status: draft.status,
      nextStep: draft.next_step,
      assignedStaff,
      createdBy: session.staff.id,
      communicationConsent: false,
      ref: String(row.public_ref),
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

    const reviewWarnings = verification.assessment.warnings.filter((warning) => warning.field !== "source_documents");
    if (reviewWarnings.length) {
      const description = `Smart Career Collect Client approved this file with follow-up items.\n\n${reviewWarnings.map((warning) => `- ${warning.message}`).join("\n")}\n\nImport case: ${args.id}`;
      const [task] = await tx`
        insert into tasks(client_id,title,description,assigned_to,created_by)
        values(${client.id},'Complete client intake review',${description},${args.reviewerId},${session.staff.id}) returning id`;
      await logActivity(tx, { clientId: client.id, action: "task_added", actor: { staffId: session.staff.id, traceId: args.traceId }, entityType: "task", entityId: String(task.id), newValue: { source: "smart_client_import", outstanding_fields: reviewWarnings.map((warning) => warning.field) } });
    }

    await logActivity(tx, {
      clientId: client.id,
      action: "client_updated",
      actor: { staffId: session.staff.id, traceId: args.traceId },
      entityType: "client_import_case",
      entityId: args.id,
      newValue: {
        approved_from_import: true, source_type: row.source_type, document_count: verification.documentCount,
        override,
        document_match_confirmed: args.documentConfirmed, information_match_confirmed: args.informationConfirmed,
        follow_up_required: verification.assessment.warnings.length > 0,
        outstanding_fields: verification.assessment.warnings.map((warning) => warning.field),
        source_conflict_count: verification.sourceConflicts.length,
      },
    });

    await tx`
      update client_import_cases set
        reviewer_id=${args.reviewerId},reviewed_at=now(),mapped_draft=${tx.json(draft as never)},field_evidence=${tx.json(evidence as never)},
        missing_fields=${tx.json(verification.missing as never)},conflicts=${tx.json(verification.conflicts as never)},verification_result=${tx.json(approvalResult as never)},
        document_match_confirmed=${args.documentConfirmed},information_match_confirmed=${args.informationConfirmed},
        review_started_at=coalesce(review_started_at,now()),
        approved_by=${session.staff.id},approved_at=now(),created_client_id=${client.id},status='APPROVED_FILE',
        archived_at=coalesce(archived_at,now()),archived_by=coalesce(archived_by,${session.staff.id})
      where id=${args.id}`;
    return { client_id: client.id, ref: client.ref, idempotent: false };
  });
}

export async function getImportDocument(session: StaffSession, id: string) {
  await assertImportReviewPermission(session);
  const [row] = await sql()`
    select d.id,d.storage_reference,d.original_filename,d.mime_type,d.import_case_id,c.status,c.archived_at
    from client_import_documents d join client_import_cases c on c.id=d.import_case_id
    where d.id=${id} and (${session.staff.role !== "staff"} or c.reviewer_id=${session.staff.id})`;
  if (!row) throw new ActionError("not_found", "Import document not found", 404);
  if (row.archived_at && row.status !== "APPROVED_FILE") throw new ActionError("archived", "Import case is archived", 409);
  return row as { id: string; storage_reference: string; original_filename: string; mime_type: string; import_case_id: string };
}
