import "server-only";
import { sql } from "@/lib/db";
import type { StaffSession } from "@/lib/auth";
import { ActionError } from "@/lib/service";

function assertManager(session: StaffSession) {
  if (session.staff.role === "staff") throw new ActionError("forbidden", "Smart client import requires manager or admin access", 403);
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

export async function filterArchivedQueue<T extends { rows: Array<{ id: string }>; counters: Record<string, number>; next_cursor: string | null }>(queue: T) {
  const ids = queue.rows.map((row) => row.id);
  if (!ids.length) {
    const counters = await liveCounters();
    return { ...queue, counters };
  }
  const live = await sql()`select id from client_import_cases where id=any(${ids}::uuid[]) and archived_at is null`;
  const keep = new Set(live.map((row) => String(row.id)));
  const counters = await liveCounters();
  return { ...queue, rows: queue.rows.filter((row) => keep.has(row.id)), counters };
}

async function liveCounters() {
  const rows = await sql()`select status,count(*)::int as count from client_import_cases where archived_at is null group by status`;
  const counters: Record<string, number> = { PENDING: 0, UNDER_REVIEW: 0, MISSING_DOCUMENT: 0, APPROVED_FILE: 0 };
  for (const row of rows) if (Object.hasOwn(counters, String(row.status))) counters[String(row.status)] = Number(row.count);
  return counters;
}

export async function assertImportNotArchived(id: string) {
  const [row] = await sql()`select archived_at from client_import_cases where id=${id}`;
  if (!row) throw new ActionError("not_found", "Import case not found", 404);
  if (row.archived_at) throw new ActionError("archived", "Import case is archived", 409);
}
