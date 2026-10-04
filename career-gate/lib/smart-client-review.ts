import "server-only";
import { randomUUID } from "node:crypto";
import type { StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { saveImportReview } from "@/lib/smart-client-import";

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function comparable(value: unknown) {
  if (value == null) return "";
  return typeof value === "string" ? value.trim() : JSON.stringify(value);
}

export async function saveImportReviewWithEvidence(session: StaffSession, args: {
  id: string;
  reviewerId: string;
  draft: Record<string, unknown>;
  documentConfirmed: boolean;
  informationConfirmed: boolean;
}) {
  const [before] = await sql()`select mapped_draft,field_evidence,verification_result,case_number from client_import_cases where id=${args.id}`;
  const result = await saveImportReview(session, args);
  const previousProfile = object(object(before?.mapped_draft).profile);
  const nextProfile = object(args.draft.profile);
  const changed = Object.keys(nextProfile).filter((key) => comparable(previousProfile[key]) !== comparable(nextProfile[key]));
  if (!changed.length) return result;

  const existingEvidence = Array.isArray(before?.field_evidence) ? before.field_evidence as Record<string, unknown>[] : [];
  const changedSet = new Set(changed);
  const retained = existingEvidence.filter((item) => !(String(item.source_type ?? "") === "manual_review" && changedSet.has(String(item.field_key ?? ""))));
  const at = new Date().toISOString();
  const manualEvidence = changed.map((field) => ({
    field_key: field,
    value: nextProfile[field] == null ? "" : String(nextProfile[field]),
    source_type: "manual_review",
    source_document_id: null,
    source_page: null,
    source_text_reference: null,
    match_score: 100,
    confidence: 100,
    verification_state: "MATCHED",
    manual_override: true,
    updated_by: session.staff.id,
    updated_at: at,
  }));
  const currentVerification = object(before?.verification_result);
  const priorOverrides = Array.isArray(currentVerification.manual_overrides)
    ? currentVerification.manual_overrides.filter((item): item is string => typeof item === "string")
    : [];
  const manualOverrides = [...new Set([...priorOverrides, ...changed.map((field) => `profile.${field}`)])];
  const latestEvent = {
    event_id: randomUUID(),
    event_type: "IMPORT_FIELD_EDITED",
    case_number: before?.case_number ? String(before.case_number) : null,
    timestamp: at,
    state: "UNDER_REVIEW",
  };

  await sql()`
    update client_import_cases
    set field_evidence=${sql().json([...retained, ...manualEvidence] as never)},
        verification_result=coalesce(verification_result,'{}'::jsonb) || ${sql().json({
          manual_overrides: manualOverrides,
          manual_override_updated_by: session.staff.id,
          manual_override_updated_at: at,
          latest_event: latestEvent,
        } as never)}
    where id=${args.id}`;
  return result;
}
