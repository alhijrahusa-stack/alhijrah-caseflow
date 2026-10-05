import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import type { IntakeRow } from "@/lib/intake-file";
import { ActionError } from "@/lib/service";
import { downloadObject, uploadObject, removeObject } from "@/lib/storage";
import { rowsFromImageOrPdf } from "@/lib/universal-intake";
import { extractDeterministicClient } from "@/lib/smart-client-local";
import {
  SMART_IMPORT_LIMITS,
  evidenceMatchScore,
  normalizeEvidenceValue,
  pickImportValue,
  prepareImportDraft,
  requiredMissingFromDraft,
  sourceHash,
} from "@/lib/smart-client-import-core";

const EVIDENCE_FIELDS = [
  "full_name", "phone", "email", "date_of_birth", "preferred_language", "street", "city", "state", "zip",
  "appointment_availability", "amazon_worked_before", "amazon_worked_from", "amazon_worked_to", "amazon_applied_before",
  "amazon_application_email", "currently_amazon", "via_agency", "employment_kind", "company", "job_title", "employment_from",
  "employment_to", "site_code", "job_id", "shift_code", "backup_site_code", "backup_job_id", "backup_shift_code",
] as const;

type SourceRow = { row: IntakeRow; source: string; documentId: string | null; sourcePage: number | null };

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
      }))
      .filter((item): item is { value: string; source: string; documentId: string | null; sourcePage: number | null } => Boolean(item.value));
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
      });
    }
  }

  return { merged, evidence, conflicts };
}

function preserveReviewedDraft(current: unknown, incoming: ReturnType<typeof partialDraft>, reviewStarted: boolean) {
  if (!reviewStarted || !current || typeof current !== "object") return incoming;
  const currentDraft = current as Record<string, unknown>;
  const currentProfile = currentDraft.profile && typeof currentDraft.profile === "object" ? currentDraft.profile as Record<string, unknown> : null;
  if (!currentProfile) return incoming;
  const incomingProfile = incoming.profile as Record<string, unknown>;
  const profile = { ...incomingProfile };
  for (const [key, value] of Object.entries(currentProfile)) {
    if (value !== null && value !== undefined && value !== "") profile[key] = value;
  }
  return {
    ...incoming,
    ...currentDraft,
    profile,
    primary: Array.isArray(currentDraft.primary) ? currentDraft.primary : incoming.primary,
    backup: Array.isArray(currentDraft.backup) ? currentDraft.backup : incoming.backup,
  } as typeof incoming;
}

export async function stageMobileImportV2(args: {
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

  const created = await sql().begin(async (tx) => {
    const [existing] = await tx`select id from client_import_batches where created_by=${args.session.staff.id} and idempotency_key=${key}`;
    if (existing) {
      const [caseRow] = await tx`
        select id,status,created_at,mapped_draft,verification_result
        from client_import_cases where batch_id=${existing.id} order by created_at limit 1`;
      return {
        batchId: String(existing.id), caseId: String(caseRow.id), idempotent: true,
        createdAt: String(caseRow.created_at), mappedDraft: caseRow.mapped_draft, verificationResult: caseRow.verification_result,
      };
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
      returning id,created_at,mapped_draft,verification_result`;
    return {
      batchId: String(batch.id), caseId: String(caseRow.id), idempotent: false,
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
    select id,source_type,raw_input,status,created_by,mapped_draft,review_started_at
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

  for (const doc of docs) {
    let rows: IntakeRow[] = [];
    let extractionError: string | null = null;
    try {
      const bytes = await downloadObject(String(doc.storage_reference));
      rows = await rowsFromImageOrPdf(bytes, String(doc.mime_type));
      if (rows[0]) sources.push({ row: rows[0], source: String(doc.original_filename), documentId: String(doc.id), sourcePage: null });
      if (rows.length > 1) extractionErrors.push({ source: doc.original_filename, code: "MULTIPLE_CLIENTS_DETECTED", count: rows.length });
    } catch (error) {
      extractionError = error instanceof Error ? error.message : "Extraction failed";
      extractionErrors.push({ source: doc.original_filename, code: "EXTRACTION_FAILED", message: extractionError });
    }
    await sql()`
      update client_import_documents
      set extraction_metadata=${sql().json({ extracted_rows: rows.length, extraction_error: extractionError, processing_state: extractionError ? "FAILED" : "EXTRACTED" } as never)}
      where id=${doc.id}`;
  }

  const merged = mergeEvidence(sources);
  const extractedDraft = partialDraft(merged.merged, notes);
  const draft = preserveReviewedDraft(caseRow.mapped_draft, extractedDraft, Boolean(caseRow.review_started_at));
  const missing = requiredMissingFromDraft(draft);
  const aiState = docs.length === 0 ? "SKIPPED" : extractionErrors.length === docs.length ? "FAILED" : extractionErrors.length ? "PARTIAL" : "COMPLETE";
  const processingState = extractionErrors.length ? "REVIEW_REQUIRED" : "EXTRACTED";
  const verificationResult = {
    processing_state: processingState,
    local_state: "COMPLETE",
    ai_state: aiState,
    extraction_errors: extractionErrors,
    evidence_fields: merged.evidence.length,
    document_count: docs.length,
    manual_precedence_applied: Boolean(caseRow.review_started_at),
    checked_at: new Date().toISOString(),
  };

  await sql()`
    update client_import_cases
    set mapped_draft=${sql().json(draft as never)},missing_fields=${sql().json(missing as never)},
        conflicts=${sql().json(merged.conflicts as never)},field_evidence=${sql().json(merged.evidence as never)},
        verification_result=${sql().json(verificationResult as never)}
    where id=${caseId}`;

  return {
    case_id: caseId,
    mapped_draft: draft,
    missing_fields: missing,
    conflicts: merged.conflicts,
    field_evidence: merged.evidence,
    verification_result: verificationResult,
  };
}