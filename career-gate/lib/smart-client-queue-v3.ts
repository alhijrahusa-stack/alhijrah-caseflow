import "server-only";
import type { StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { ActionError } from "@/lib/service";
import { IMPORT_STATUSES, SMART_IMPORT_LIMITS, type ImportStatus } from "@/lib/smart-client-import-core";

function assertManager(session: StaffSession) {
  if (session.staff.role === "staff") throw new ActionError("forbidden", "Smart client import requires manager or admin access", 403);
}

function parseStatus(value: string | null): ImportStatus | "ALL" {
  if (!value || value === "ALL") return "ALL";
  if (!(IMPORT_STATUSES as readonly string[]).includes(value)) throw new ActionError("invalid_status", "Invalid import status", 400);
  return value as ImportStatus;
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

export async function listImportQueueV3(session: StaffSession, args: { status?: string | null; q?: string | null; cursor?: string | null }) {
  assertManager(session);
  const status = parseStatus(args.status ?? null);
  const q = (args.q ?? "").trim().slice(0, 160);
  const cursor = decodeCursor(args.cursor ?? null);
  const limit = SMART_IMPORT_LIMITS.queuePageSize;
  const like = `%${q}%`;

  const rows = await sql()`
    select
      c.id,c.case_number,c.source_type,c.source_row,c.status,c.reviewer_id,
      reviewer.display_name as reviewer_name,
      creator.id as uploaded_by,creator.display_name as uploaded_by_name,
      coalesce(
        nullif(c.mapped_draft #>> '{profile,full_name}',''),
        (select nullif(e->>'value','') from jsonb_array_elements(c.field_evidence) e
          where e->>'field_key'='full_name' and e->>'source_type' in ('manual_review','local_text') limit 1),
        nullif(c.mapped_draft #>> '{profile,email}',''),
        nullif(c.mapped_draft #>> '{profile,phone}',''),
        c.case_number
      ) as display_identity,
      c.mapped_draft #>> '{profile,full_name}' as full_name,
      c.mapped_draft #>> '{profile,phone}' as phone,
      c.mapped_draft #>> '{profile,email}' as email,
      c.created_at,c.updated_at,c.created_client_id,c.archived_at,
      coalesce(c.verification_result->>'processing_state','CAPTURED') as processing_state,
      coalesce(c.verification_result->>'ai_state','SKIPPED') as ai_state,
      coalesce((c.verification_result->>'approval_ready')::boolean,false) as approval_ready,
      (select count(*)::int from client_import_documents d where d.import_case_id=c.id) as document_count,
      (coalesce(jsonb_array_length(c.missing_fields),0)+coalesce(jsonb_array_length(c.conflicts),0))::int as issue_count
    from client_import_cases c
    left join staff reviewer on reviewer.id=c.reviewer_id
    left join staff creator on creator.id=c.created_by
    where c.deleted_at is null and c.archived_at is null
      and (${status === "ALL"} or c.status=${status === "ALL" ? "PENDING" : status})
      and (${q === ""}
        or c.id::text ilike ${like}
        or c.case_number ilike ${like}
        or coalesce(c.mapped_draft #>> '{profile,full_name}','') ilike ${like}
        or coalesce(c.mapped_draft #>> '{profile,phone}','') ilike ${like}
        or coalesce(c.mapped_draft #>> '{profile,email}','') ilike ${like})
      and (${cursor == null} or (c.created_at,c.id) < (${cursor?.createdAt ?? "9999-12-31T23:59:59.999Z"}::timestamptz,${cursor?.id ?? "ffffffff-ffff-ffff-ffff-ffffffffffff"}::uuid))
    order by c.created_at desc,c.id desc
    limit ${limit + 1}`;

  const visible = rows.slice(0, limit);
  const next = rows.length > limit ? visible[visible.length - 1] : null;
  const counters = await sql()`
    select status,count(*)::int as count
    from client_import_cases
    where deleted_at is null and archived_at is null
    group by status`;
  const counts = Object.fromEntries(IMPORT_STATUSES.map((key) => [key, 0])) as Record<ImportStatus, number>;
  for (const row of counters) if ((IMPORT_STATUSES as readonly string[]).includes(String(row.status))) counts[row.status as ImportStatus] = Number(row.count);
  return {
    rows: visible,
    counters: counts,
    next_cursor: next ? encodeCursor(String(next.created_at), String(next.id)) : null,
  };
}
