import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import type { IntakeRow } from "@/lib/intake-file";
import { ActionError, normalizeClientEmail } from "@/lib/service";
import { findPublicDuplicate } from "@/lib/public-intake-duplicate";
import { downloadObject, uploadObject, removeObject } from "@/lib/storage";
import { rowsFromImageOrPdfDetailed } from "@/lib/universal-intake";
import { extractDeterministicClient } from "@/lib/smart-client-local";
import {
  SMART_IMPORT_LIMITS,
  evidenceMatchScore,
  normalizeEvidenceValue,
  pickImportValue,
  prepareImportDraft,
  requiredMissingFromDraft,
  reviewFieldsFromRowTolerant,
  sourceHash,
} from "@/lib/smart-client-import-core";

const EVIDENCE_FIELDS = [
  "full_name", "first_name", "middle_name", "last_name", "phone", "email", "date_of_birth", "preferred_language", "street", "city", "state", "zip",
  "shift_days", "shift_start_time", "shift_end_time", "appointment_availability", "amazon_worked_before", "amazon_worked_from", "amazon_worked_to", "amazon_applied_before",
  "amazon_application_email", "currently_amazon", "via_agency", "employment_kind", "company", "job_title", "employment_from",
  "employment_to", "site_code", "alt_site_code", "work_location_candidates", "job_id", "shift_code", "backup_site_code", "backup_job_id", "backup_shift_code",
  "additional_notes",
] as const;

type SourceRow = { row: IntakeRow; source: string; documentId: string | null; sourcePage: number | null; confidence?: Record<string, number> };

type FileCapture = {
  file: File;
  bytes: Uint8Array;
  sha256: string;
  documentId: string | null;
  storagePath: string | null;
};

function assertManager(session: StaffSession) {
  if (session.staff.role === "staff") throw new ActionError("forbidden", "Smart client import requires manager or admin access", 403);
}

function safeFilename(value: string) {
  const name = value.replace(/[\\/\0\r\n]/g, "_").replace(/[^\p{L}\p{N}._ -]/gu, "_").trim();
  return (name || "upload").slice(0, 180);
}

function supportedMobileMime(file: File) {
  const mime = file.type || "application/octet-stream";
  return ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(mime);
}

function conservativeDocumentType(name: string) {
  const normalized = name.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (/\b(passport|drivers? license|driver license|photo id|state id)\b/.test(normalized)) return "photo_id";
  if (/\b(work authorization|employment authorization|ead)\b/.test(normalized)) return "work_authorization";
  if (/\b(social security|ss card)\b/.test(normalized)) return "social_security_card";
  if (/\b(resume|curriculum vitae|cv)\b/.test(normalized)) return "resume";
  return "other";
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
        appointment_availability: pickImportValue(row, "appointment_availability"),
        amazon_worked_before: null, amazon_worked_from: pickImportValue(row, "amazon_worked_from"), amazon_worked_to: pickImportValue(row, "amazon_worked_to"),
        amazon_applied_before: null, currently_amazon: null, via_agency: null, amazon_application_email: pickImportValue(row, "amazon_application_email"), employment_history: [],
      },
      review_fields: reviewFieldsFromRowTolerant(row),
      primary: [], backup: [], status: "new_intake", next_step: null, staff_code: null, initial_note: notes || null,
    };
  }
}

function mergeEvidence(sources: SourceRow[]) {
  const merged: IntakeRow = {};
  const evidence: Record<string, unknown>[] = [];
  const conflicts: Record<string, unknown>[] = [];

  for (const field of EVIDENCE_FIELDS) {
    const values = sources
      .map((source) => ({
        value: pickImportValue(source.row, field),
        source: source.source,
        documentId: source.documentId,
        sourcePage: source.sourcePage,
        confidenceScore: source.confidence?.[field] ?? null,
      }))
      .filter((item): item is { value: string; source: string; documentId: string | null; sourcePage: number | null; confidenceScore: number | null } => Boolean(item.value));
    if (!values.length) continue;

    const grouped = new Map<string, typeof values>();
    for (const value of values) {
      const key = normalizeEvidenceValue(field, value.value);
      const bucket = grouped.get(key) ?? [];
      bucket.push(value);
      grouped.set(key, bucket);
    }

    if (grouped.size === 1) {
      const group = [...grouped.values()][0];
      const representative = group[0];
      merged[field] = representative.value;
      const multiSource = new Set(group.map((item) => `${item.source}:${item.documentId ?? "text"}`)).size > 1;
      for (const item of group) {
        evidence.push({
          field_key: field,
          value: item.value,
          source_type: item.documentId ? "document" : item.source,
          source_document_id: item.documentId,
          source_page: item.sourcePage,
          source_text_reference: null,
          match_score: 100,
          verification_state: multiSource ? "MATCHED" : "REVIEW",
          confidence_score: item.confidenceScore,
        });
      }
      continue;
    }

    const variants = [...grouped.values()].map((group) => group[0]);
    let bestScore = 0;
    for (let i = 0; i < variants.length; i += 1) {
      for (let j = i + 1; j < variants.length; j += 1) bestScore = Math.max(bestScore, evidenceMatchScore(field, variants[i].value, variants[j].value));
    }
    conflicts.push({
      field_key: field,
      type: "SOURCE_CONFLICT",
      match_score: bestScore,
      values: variants.map((item) => ({ value: item.value, source: item.source, source_document_id: item.documentId })),
    });
    for (const item of values) {
      evidence.push({
        field_key: field,
        value: item.value,
        source_type: item.documentId ? "document" : item.source,
        source_document_id: item.documentId,
        source_page: item.sourcePage,
        source_text_reference: null,
        match_score: bestScore,
        verification_state: "CONFLICT",
        confidence_score: item.confidenceScore,
      });
    }
  }

  return { merged, evidence, conflicts };
}

type EvidenceEntry = Record<string, unknown>;

function evidenceIdentity(entry: EvidenceEntry) {
  return JSON.stringify([entry.field_key ?? null, entry.value ?? null, entry.source_type ?? null, entry.authority ?? null]);
}

/**
 * Field evidence is append-only history. Existing entries are never rewritten, and a later
 * automatic extraction is not recorded for a field whose current authority is MANUAL, so the
 * reviewed value stays the authority the review surface reads back.
 */
export function appendExtractionEvidence(existingValue: unknown, incoming: readonly EvidenceEntry[]) {
  const existing = (Array.isArray(existingValue) ? existingValue : []).filter(
    (entry): entry is EvidenceEntry => Boolean(entry) && typeof entry === "object",
  );
  const manualFields = new Set(
    existing.filter((entry) => entry.authority === "MANUAL").map((entry) => String(entry.field_key)),
  );
  const seen = new Set(existing.map(evidenceIdentity));
  const appended = incoming.filter((entry) => {
    if (manualFields.has(String(entry.field_key))) return false;
    const identity = evidenceIdentity(entry);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  return [...existing, ...appended];
}

function preserveReviewedDraft(current: unknown, incoming: ReturnType<typeof partialDraft>, reviewStarted: boolean, manualFields: ReadonlySet<string> = new Set()) {
  if (!reviewStarted || !current || typeof current !== "object") return incoming;
  const currentDraft = current as Record<string, unknown>;
  const currentProfile = currentDraft.profile && typeof currentDraft.profile === "object" ? currentDraft.profile as Record<string, unknown> : null;
  if (!currentProfile) return incoming;
  const incomingProfile = incoming.profile as Record<string, unknown>;
  const profile = { ...incomingProfile };
  for (const [key, value] of Object.entries(currentProfile)) {
    if (manualFields.has(key) || (value !== null && value !== undefined && value !== "")) profile[key] = value;
  }
  return {
    ...incoming,
    ...currentDraft,
    profile,
    primary: Array.isArray(currentDraft.primary) ? currentDraft.primary : incoming.primary,
    backup: Array.isArray(currentDraft.backup) ? currentDraft.backup : incoming.backup,
  } as typeof incoming;
}

/** Apply only values the client actually submitted. Preserve all other existing
 * fields and every staff-verified MANUAL authority. A generic reviewed-draft
 * merge intentionally preserves all nonblank old values and is therefore not
 * suitable for an explicit client correction to an existing case.
 */
function applyLinkedClientCorrections(
  current: unknown,
  incoming: ReturnType<typeof partialDraft>,
  provided: ReadonlySet<string>,
  manual: ReadonlySet<string>,
): ReturnType<typeof partialDraft> {
  if (!current || typeof current !== "object") return incoming;
  const old = current as Record<string, unknown>;
  const oldProfile = old.profile && typeof old.profile === "object" ? old.profile as Record<string, unknown> : {};
  const newProfile = incoming.profile as Record<string, unknown>;
  const profile = { ...oldProfile };
  for (const [field, value] of Object.entries(newProfile)) {
    if (!provided.has(field) || manual.has(field)) continue;
    if (value === null || value === undefined || (typeof value === "string" && !value.trim())) continue;
    profile[field] = value;
  }
  const result = { ...old, profile } as Record<string, unknown>;
  if (["site_code", "job_id", "shift_code", "shift_days", "shift_start_time", "shift_end_time"]
    .some((field) => provided.has(field) && !manual.has(field)) && incoming.primary.length) {
    result.primary = incoming.primary;
  }
  if (["backup_site_code", "backup_job_id", "backup_shift_code"]
    .some((field) => provided.has(field) && !manual.has(field)) && incoming.backup.length) {
    result.backup = incoming.backup;
  }
  const beforeReview = old.review_fields && typeof old.review_fields === "object"
    ? old.review_fields as Record<string, unknown> : {};
  const received = incoming as unknown as Record<string, unknown>;
  const afterReview = received.review_fields && typeof received.review_fields === "object"
    ? received.review_fields as Record<string, unknown> : {};
  const reviewFields = { ...beforeReview };
  const reviewSources: Record<string, string> = {
    first_name: "first_name", middle_name: "middle_name", last_name: "last_name",
    work_location_candidates: "work_location_candidates",
    preferred_location: "site_code", location_option_1: "alt_site_code", location_option_2: "backup_site_code",
    preferred_shift: "shift_code", shift_days: "shift_days",
    shift_start_time: "shift_start_time", shift_end_time: "shift_end_time",
    additional_notes: "additional_notes",
  };
  for (const [destination, source] of Object.entries(reviewSources)) {
    if (!provided.has(source) || manual.has(source) || manual.has(destination)) continue;
    const value = afterReview[destination];
    if (value !== null && value !== undefined && value !== "") reviewFields[destination] = value;
  }
  result.review_fields = reviewFields;
  return result as unknown as ReturnType<typeof partialDraft>;
}

/** Append a one-time, staff-authorized client submission to its ORIGINAL pending
 * Smart Import case. Storage is private, and case/document/link changes commit
 * together. No new case or public reference is ever created in this branch.
 */
async function appendLinkedClientIntake(args: {
  session: StaffSession; targetCaseId: string; linkId: string; notes: string;
  preDraft: ReturnType<typeof partialDraft>; preMerge: ReturnType<typeof mergeEvidence>; files: FileCapture[];
}) {
  const uploaded: string[] = [];
  try {
    for (const entry of args.files) {
      const path = `smart-import/${args.targetCaseId}/${randomUUID()}-${safeFilename(entry.file.name || "upload")}`;
      await uploadObject(path, entry.bytes, entry.file.type);
      uploaded.push(path);
      entry.storagePath = path;
    }
    const result = await sql().begin(async (tx) => {
      const [link] = await tx`select id,status,import_case_id from client_import_links where id=${args.linkId} for update`;
      if (!link || String(link.import_case_id ?? "") !== args.targetCaseId) {
        throw new ActionError("link_case_mismatch", "The link is not authorized for this case", 403);
      }
      const [current] = await tx`
        select id,batch_id,public_ref,source_type,status,created_at,raw_input,mapped_draft,missing_fields,conflicts,field_evidence,verification_result,review_started_at
        from client_import_cases where id=${args.targetCaseId} for update`;
      if (!current || current.source_type !== "mobile" || ["APPROVED_FILE","ARCHIVED"].includes(String(current.status))) {
        throw new ActionError("case_closed", "This case cannot accept a client update", 409);
      }
      if (link.status === "USED") {
        return {
          caseId: String(current.id), batchId: String(current.batch_id), publicRef: String(current.public_ref),
          createdAt: String(current.created_at), mappedDraft: current.mapped_draft,
          verificationResult: current.verification_result, idempotent: true, applied: false,
        };
      }
      if (link.status !== "PROCESSING") throw new ActionError("link_closed", "The link is not processing", 409);
      const existing = (current.mapped_draft ?? {}) as Record<string, unknown>;
      const profile = (existing.profile ?? {}) as Record<string, unknown>;
      const incoming = (args.preDraft.profile ?? {}) as Record<string, unknown>;
      for (const field of ["full_name", "date_of_birth"] as const) {
        const before = typeof profile[field] === "string" ? profile[field] as string : "";
        const after = typeof incoming[field] === "string" ? incoming[field] as string : "";
        if (before.trim() && after.trim() && normalizeEvidenceValue(field, before) !== normalizeEvidenceValue(field, after)) {
          throw new ActionError("identity_conflict", "The submitted identity differs from this case. Contact the office.", 409);
        }
      }
      const evidence = appendExtractionEvidence(current.field_evidence, args.preMerge.evidence);
      const manuallyReviewed = new Set(
        (Array.isArray(current.field_evidence) ? current.field_evidence : [])
          .filter((e: unknown) => e && typeof e === "object" && (e as Record<string, unknown>).authority === "MANUAL")
          .map((e: unknown) => String((e as Record<string, unknown>).field_key)),
      );
      const providedFields = new Set(args.preMerge.evidence.map((item) => String(item.field_key)));
      const nextDraft = applyLinkedClientCorrections(current.mapped_draft, args.preDraft, providedFields, manuallyReviewed);
      const oldInput = current.raw_input && typeof current.raw_input === "object" ? current.raw_input as Record<string, unknown> : {};
      const oldNotes = typeof oldInput.notes === "string" ? oldInput.notes : "";
      const joined = [args.notes, oldNotes].filter(Boolean).join("\n\n--- Earlier Smart Import source ---\n");
      for (const entry of args.files) {
        await tx`insert into client_import_documents(import_case_id,storage_reference,original_filename,mime_type,size_bytes,sha256,detected_document_type,extraction_metadata,uploaded_by)
          values(${args.targetCaseId},${entry.storagePath},${safeFilename(entry.file.name || "upload")},${entry.file.type},${entry.file.size},${entry.sha256},${conservativeDocumentType(entry.file.name)},
            ${tx.json({ extracted_rows: 0, extraction_error: null, processing_state: "PENDING" } as never)},${args.session.staff.id})`;
      }
      const [count] = await tx`select count(*)::int as n from client_import_documents where import_case_id=${args.targetCaseId}`;
      const oldResult = current.verification_result && typeof current.verification_result === "object" ? current.verification_result as Record<string, unknown> : {};
      const nextResult = { ...oldResult, processing_state: "CAPTURED",
        ai_state: args.files.length ? "PENDING" : oldResult.ai_state ?? "SKIPPED",
        document_count: Number(count.n), client_link_received_at: new Date().toISOString(),
        evidence_fields: evidence.length };
      await tx`update client_import_cases set
        raw_input=${tx.json({ ...oldInput, notes: joined } as never)},
        mapped_draft=${tx.json(nextDraft as never)},
        missing_fields=${tx.json(requiredMissingFromDraft(nextDraft) as never)},
        field_evidence=${tx.json(evidence as never)},
        verification_result=${tx.json(nextResult as never)}
        where id=${args.targetCaseId}`;
      const [updated] = await tx`update client_import_links set status='USED',used_at=now(),processing_started_at=null
        where id=${args.linkId} and status='PROCESSING' and import_case_id=${args.targetCaseId} returning id`;
      if (!updated) throw new ActionError("link_conflict", "Submission state changed; retry", 409);
      return { caseId: String(current.id), batchId: String(current.batch_id), publicRef: String(current.public_ref),
        createdAt: String(current.created_at), mappedDraft: nextDraft, verificationResult: nextResult, idempotent: false, applied: true };
    });
    if (!result.applied) { for (const path of uploaded) await removeObject(path).catch(() => undefined); }
    return { batch_id: result.batchId, case_id: result.caseId, idempotent: result.idempotent,
      public_ref: result.publicRef, created_at: result.createdAt, uploaded_by: args.session.staff.id,
      uploaded_by_name: args.session.staff.display_name, mapped_draft: result.mappedDraft,
      verification_result: result.verificationResult };
  } catch (error) {
    for (const path of uploaded) await removeObject(path).catch(() => undefined);
    throw error;
  }
}
export async function stageMobileImportV2(args: {
  session: StaffSession;
  notes: string;
  files: File[];
  idempotencyKey: string;
  caseNumber?: string | null;
  targetCaseId?: string | null;
  linkId?: string | null;
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

  const key = args.idempotencyKey.trim();
  if (key.length < 8 || key.length > 200) throw new ActionError("invalid_idempotency_key", "A valid idempotency key is required", 400);

  const local = extractDeterministicClient(notes);
  const preSources: SourceRow[] = [];
  if (notes) preSources.push({ row: local.row, source: "local_text", documentId: null, sourcePage: null });
  const preMerge = mergeEvidence(preSources);
  const preDraft = partialDraft(preMerge.merged, notes);
  const preMissing = requiredMissingFromDraft(preDraft);

  const fileData: FileCapture[] = [];
  for (const file of args.files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    fileData.push({ file, bytes, sha256, documentId: null, storagePath: null });
  }

  if (args.targetCaseId) {
    if (!args.linkId) throw new ActionError("invalid_link", "A linked case requires its one-time link", 400);
    return appendLinkedClientIntake({ session: args.session, targetCaseId: args.targetCaseId, linkId: args.linkId, notes, preDraft, preMerge, files: fileData });
  }

  const created = await sql().begin(async (tx) => {
    const [existing] = await tx`select id from client_import_batches where created_by=${args.session.staff.id} and idempotency_key=${key}`;
    if (existing) {
      const [caseRow] = await tx`
        select id,status,public_ref,created_at,mapped_draft,verification_result
        from client_import_cases where batch_id=${existing.id} order by created_at limit 1`;
      return {
        batchId: String(existing.id), caseId: String(caseRow.id), publicRef: String(caseRow.public_ref), idempotent: true,
        createdAt: String(caseRow.created_at), mappedDraft: caseRow.mapped_draft, verificationResult: caseRow.verification_result,
      };
    }

    const publicProfile = preDraft.profile as {
      full_name?: string | null;
      phone?: string | null;
      email?: string | null;
      date_of_birth?: string | null;
    };
    const publicEmail = normalizeClientEmail(publicProfile.email);
    if (key.startsWith("client-link:")) {
      // Use the canonical email lock also held by Client creation and the DB
      // guard. Recheck both canonical and staged rows inside this transaction.
      if (publicEmail) {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`cg-email:${publicEmail}`}, 0))`;
      }
      const match = await findPublicDuplicate({
        email: publicEmail,
        caseNumber: args.caseNumber,
        fullName: publicProfile.full_name,
        dateOfBirth: publicProfile.date_of_birth,
        phone: publicProfile.phone,
      }, tx);
      if (match.exists) {
        throw new ActionError(
          "duplicate_application",
          "An existing application matches this applicant or Case Number. Please contact Customer Service on WhatsApp.",
          409,
        );
      }
    }

    const [batch] = await tx`
      insert into client_import_batches(source_type,source_file_hash,idempotency_key,created_by,metadata)
      values('mobile',${sourceHash({ notes, files: fileData.map((entry) => ({ name: entry.file.name, sha256: entry.sha256 })) })},${key},${args.session.staff.id},
             ${tx.json({ file_count: args.files.length, raw_text_present: Boolean(notes), extraction_engine: "local_first_gemini_enrichment" } as never)}) returning id`;
    const [caseRow] = await tx`
      insert into client_import_cases(batch_id,source_type,status,raw_input,mapped_draft,missing_fields,conflicts,field_evidence,verification_result,created_by)
      values(${batch.id},'mobile','PENDING',${tx.json({ notes } as never)},${tx.json(preDraft as never)},${tx.json(preMissing as never)},
        ${tx.json(preMerge.conflicts as never)},${tx.json(preMerge.evidence as never)},
        ${tx.json({ processing_state: "CAPTURED", local_state: "COMPLETE", ai_state: args.files.length ? "PENDING" : "SKIPPED", extraction_errors: [], evidence_fields: preMerge.evidence.length } as never)},${args.session.staff.id})
      returning id,public_ref,created_at,mapped_draft,verification_result`;
    return {
      batchId: String(batch.id), caseId: String(caseRow.id), publicRef: String(caseRow.public_ref), idempotent: false,
      createdAt: String(caseRow.created_at), mappedDraft: caseRow.mapped_draft, verificationResult: caseRow.verification_result,
    };
  });

  if (!created.idempotent) {
    const uploadedPaths: string[] = [];
    try {
      for (const entry of fileData) {
        const path = `smart-import/${created.caseId}/${randomUUID()}-${safeFilename(entry.file.name || "upload")}`;
        await uploadObject(path, entry.bytes, entry.file.type);
        uploadedPaths.push(path);
        entry.storagePath = path;
        const [doc] = await sql()`
          insert into client_import_documents(import_case_id,storage_reference,original_filename,mime_type,size_bytes,sha256,detected_document_type,extraction_metadata,uploaded_by)
          values(${created.caseId},${path},${safeFilename(entry.file.name || "upload")},${entry.file.type},${entry.file.size},${entry.sha256},${conservativeDocumentType(entry.file.name)},
            ${sql().json({ extracted_rows: 0, extraction_error: null, processing_state: "PENDING" } as never)},${args.session.staff.id})
          returning id`;
        entry.documentId = String(doc.id);
      }
      await sql()`
        update client_import_cases
        set verification_result=${sql().json({
          processing_state: "CAPTURED",
          local_state: "COMPLETE",
          ai_state: args.files.length ? "PENDING" : "SKIPPED",
          extraction_errors: [],
          evidence_fields: preMerge.evidence.length,
          document_count: args.files.length,
        } as never)}
        where id=${created.caseId}`;
    } catch (error) {
      for (const path of uploadedPaths) await removeObject(path).catch(() => undefined);
      await sql().begin(async (tx) => {
        await tx`delete from client_import_documents where import_case_id=${created.caseId}`;
        await tx`delete from client_import_cases where id=${created.caseId}`;
        await tx`delete from client_import_batches where id=${created.batchId}`;
      });
      throw error;
    }
  }

  return {
    batch_id: created.batchId,
    case_id: created.caseId,
    idempotent: created.idempotent,
    public_ref: created.publicRef,
    created_at: created.createdAt,
    uploaded_by: args.session.staff.id,
    uploaded_by_name: args.session.staff.display_name,
    mapped_draft: created.mappedDraft ?? preDraft,
    verification_result: created.verificationResult ?? {
      processing_state: "CAPTURED",
      local_state: "COMPLETE",
      ai_state: args.files.length ? "PENDING" : "SKIPPED",
      extraction_errors: [],
      evidence_fields: preMerge.evidence.length,
    },
  };
}

export async function enrichMobileImportCase(session: StaffSession, caseId: string) {
  assertManager(session);
  const [caseRow] = await sql()`
    select id,source_type,raw_input,status,created_by,mapped_draft,review_started_at,field_evidence
    from client_import_cases where id=${caseId}`;
  if (!caseRow) throw new ActionError("not_found", "Import case not found", 404);
  if (caseRow.source_type !== "mobile") throw new ActionError("invalid_source", "Extraction retry is only available for mobile smart imports", 409);
  if (caseRow.status === "APPROVED_FILE") throw new ActionError("already_approved", "Approved imports cannot be re-extracted", 409);

  const notes = typeof caseRow.raw_input?.notes === "string" ? caseRow.raw_input.notes : "";
  const local = extractDeterministicClient(notes);
  const sources: SourceRow[] = [];
  if (notes) sources.push({ row: local.row, source: "local_text", documentId: null, sourcePage: null });

  const docs = await sql()`
    select id,storage_reference,original_filename,mime_type,extraction_metadata
    from client_import_documents where import_case_id=${caseId} order by created_at,id`;
  const extractionErrors: Record<string, unknown>[] = [];

  await sql()`
    update client_import_cases
    set verification_result=coalesce(verification_result,'{}'::jsonb) || ${sql().json({ processing_state: "AI_PROCESSING", local_state: "COMPLETE", ai_state: "PROCESSING" } as never)}
    where id=${caseId}`;

  type DocResult = {
    doc: Record<string, unknown>;
    rows: IntakeRow[];
    confidence: Record<string, number>;
    extractionError: string | null;
  };

  async function processDocument(doc: Record<string, unknown>): Promise<DocResult> {
    const started = Date.now();
    let rows: IntakeRow[] = [];
    let confidence: Record<string, number> = {};
    let extractionError: string | null = null;
    try {
      const bytes = await downloadObject(String(doc.storage_reference));
      const detailed = await rowsFromImageOrPdfDetailed(bytes, String(doc.mime_type));
      rows = detailed.map((item) => item.row);
      confidence = { ...(detailed[0]?.confidence ?? {}) };
    } catch (error) {
      extractionError = error instanceof Error ? error.message : "Extraction failed";
    }
    await sql()`
      insert into system_jobs(job_type,status,import_case_id,source_name,provider,confidence,result,error,created_by,completed_at)
      values('smart_document_extraction',${extractionError ? "FAILED" : "COMPLETED"},${caseId},${String(doc.original_filename)},'gemini',
        ${sql().json(confidence as never)},
        ${sql().json({ extracted_rows: rows.length, duration_ms: Date.now() - started } as never)},
        ${extractionError},${session.staff.id},now())`;
    await sql()`
      update client_import_documents
      set extraction_metadata=${sql().json({
        extracted_rows: rows.length,
        confidence,
        extraction_error: extractionError,
        processing_state: extractionError ? "FAILED" : "EXTRACTED",
        completed_at: new Date().toISOString(),
      } as never)}
      where id=${String(doc.id)}`;
    return { doc, rows, confidence, extractionError };
  }

  const results: DocResult[] = [];
  for (let index = 0; index < docs.length; index += 2) {
    const chunk = docs.slice(index, index + 2) as unknown as Record<string, unknown>[];
    results.push(...await Promise.all(chunk.map(processDocument)));
  }

  for (const result of results) {
    const doc = result.doc;
    // A multi-person image must never seed a single client draft.
    if (result.rows.length === 1) {
      sources.push({
        row: result.rows[0],
        source: String(doc.original_filename),
        documentId: String(doc.id),
        sourcePage: null,
        confidence: result.confidence,
      });
    }
    if (result.rows.length > 1) {
      extractionErrors.push({ source: doc.original_filename, code: "MULTIPLE_CLIENTS_DETECTED", count: result.rows.length });
    }
    if (result.extractionError) {
      extractionErrors.push({ source: doc.original_filename, code: "EXTRACTION_FAILED", message: result.extractionError });
    }
  }

  const merged = mergeEvidence(sources);
  const failedDocuments = results.filter((item) => item.extractionError).length;
  const aiState = docs.length === 0 ? "SKIPPED" : failedDocuments === docs.length ? "FAILED" : failedDocuments ? "PARTIAL" : "COMPLETE";
  const processingState = extractionErrors.length ? "REVIEW_REQUIRED" : "EXTRACTED";

  // Extraction can finish AFTER the client/staff reviewed or approved the file.
  // Re-read under a row lock immediately before persistence: never use the
  // stale pre-extraction review snapshot to replace manually reviewed values.
  return sql().begin(async (tx) => {
    const [latest] = await tx`
      select status,mapped_draft,field_evidence,review_started_at
      from client_import_cases where id=${caseId} for update`;
    if (!latest) throw new ActionError("not_found", "Import case not found", 404);
    if (latest.status === "APPROVED_FILE") {
      throw new ActionError("already_approved", "Approved files cannot be changed by delayed extraction", 409);
    }

    const manualFields = new Set<string>(
      (Array.isArray(latest.field_evidence) ? latest.field_evidence : [])
        .filter((entry: EvidenceEntry) => entry && entry.authority === "MANUAL")
        .map((entry: EvidenceEntry) => String(entry.field_key)),
    );
    const reviewed = Boolean(latest.review_started_at);
    const draft = preserveReviewedDraft(latest.mapped_draft, partialDraft(merged.merged, notes), reviewed, manualFields);
    const evidence = appendExtractionEvidence(latest.field_evidence, merged.evidence as EvidenceEntry[]);
    const unresolvedConflicts = merged.conflicts.filter((conflict) => !manualFields.has(String(conflict.field_key)));
    const missing = requiredMissingFromDraft(draft);
    const verificationResult = {
      processing_state: processingState,
      local_state: "COMPLETE",
      ai_state: aiState,
      extraction_errors: extractionErrors,
      evidence_fields: evidence.length,
      document_count: docs.length,
      provider: "gemini",
      manual_precedence_applied: reviewed,
      resolved_source_conflict_fields: merged.conflicts
        .filter((conflict) => manualFields.has(String(conflict.field_key))).map((conflict) => conflict.field_key),
      checked_at: new Date().toISOString(),
    };
    await tx`
      update client_import_cases
      set mapped_draft=${tx.json(draft as never)},missing_fields=${tx.json(missing as never)},
          conflicts=${tx.json(unresolvedConflicts as never)},field_evidence=${tx.json(evidence as never)},
          verification_result=${tx.json(verificationResult as never)}
      where id=${caseId}`;
    return {
      case_id: caseId,
      mapped_draft: draft,
      missing_fields: missing,
      conflicts: unresolvedConflicts,
      field_evidence: evidence,
      verification_result: verificationResult,
    };
  });
}
