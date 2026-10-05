import "server-only";
import { sql } from "@/lib/db";
import type { StaffSession } from "@/lib/auth";
import { ActionError } from "@/lib/service";
import type { QueueRow } from "@/lib/smart-client-import";
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
function encodeCursor(createdAt: string, id: string) { return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url"); }

export async function listActiveImportQueue(session: StaffSession, args: { status?: string | null; q?: string | null; cursor?: string | null }) {
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
    where c.archived_at is null
      and (${status === "ALL"} or c.status=${status === "ALL" ? "PENDING" : status})
      and (${q === ""} or c.id::text ilike ${`%${q}%`}
           or coalesce(c.mapped_draft #>> '{profile,full_name}','') ilike ${`%${q}%`}
           or coalesce(c.mapped_draft #>> '{profile,phone}','') ilike ${`%${q}%`}
           or coalesce(c.mapped_draft #>> '{profile,email}','') ilike ${`%${q}%`})
      and (${cursor == null} or (c.created_at,c.id) < (${cursor?.createdAt ?? "9999-12-31T23:59:59.999Z"}::timestamptz,${cursor?.id ?? "ffffffff-ffff-ffff-ffff-ffffffffffff"}::uuid))
    order by c.created_at desc,c.id desc
    limit ${limit + 1}`;
  const visible = rows.slice(0, limit) as unknown as QueueRow[];
  const next = rows.length > limit ? visible[visible.length - 1] : null;
  const counterRows = await sql()`select status,count(*)::int as count from client_import_cases where archived_at is null group by status`;
  const counters = Object.fromEntries(IMPORT_STATUSES.map((key) => [key, 0])) as Record<ImportStatus, number>;
  for (const row of counterRows) if ((IMPORT_STATUSES as readonly string[]).includes(String(row.status))) counters[row.status as ImportStatus] = Number(row.count);
  return { rows: visible, counters, next_cursor: next ? encodeCursor(String(next.created_at), String(next.id)) : null };
}

export async function archiveImportCase(session: StaffSession, id: string) {
  assertManager(session);
  return sql().begin(async (tx) => {
    const [row] = await tx`select id,archived_at from client_import_cases where id=${id} for update`;
    if (!row) throw new ActionError("not_found", "Import case not found", 404);
    if (row.archived_at) return { archived: true, idempotent: true };
    await tx`update client_import_cases set archived_at=now(),archived_by=${session.staff.id} where id=${id}`;
    return { archived: true, idempotent: false };
  });
}

export async function assertImportNotArchived(id: string) {
  const [row] = await sql()`select archived_at from client_import_cases where id=${id}`;
  if (!row) throw new ActionError("not_found", "Import case not found", 404);
  if (row.archived_at) throw new ActionError("archived", "Import case is archived", 409);
}
