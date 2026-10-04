import { z } from "zod";
import { sql } from "@/lib/db";
import { ActionError } from "@/lib/service";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";
import {
  approveImportCase,
  getImportCase,
  listImportQueue,
  startImportReview,
  verifyImportCase,
} from "@/lib/smart-client-import";
import { saveImportReviewWithEvidence } from "@/lib/smart-client-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Id = z.uuid();

async function withUploaderMetadata<T extends { rows: Array<{ id: string }> }>(queue: T) {
  const ids = queue.rows.map((row) => row.id);
  if (!ids.length) return queue;
  const meta = await sql()`
    select c.id,c.created_by,s.display_name as uploaded_by_name
    from client_import_cases c
    left join staff s on s.id=c.created_by
    where c.id = any(${ids}::uuid[])`;
  const index = new Map(meta.map((row) => [String(row.id), { uploaded_by: String(row.created_by), uploaded_by_name: row.uploaded_by_name ? String(row.uploaded_by_name) : null }]));
  return { ...queue, rows: queue.rows.map((row) => ({ ...row, ...(index.get(row.id) ?? { uploaded_by: null, uploaded_by_name: null }) })) };
}

export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: false });
  if (guard.response) return guard.response;
  if (guard.session.staff.role === "staff") return err("forbidden", "Smart client import requires manager or admin access", 403, traceId);
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (id) {
      const detail = await getImportCase(guard.session, Id.parse(id));
      const [creator] = await sql()`select display_name from staff where id=${String(detail.case.created_by)} limit 1`;
      return ok({ ...detail, case: { ...detail.case, uploaded_by_name: creator?.display_name ? String(creator.display_name) : null } }, 200, traceId);
    }
    const queue = await listImportQueue(guard.session, {
      status: url.searchParams.get("status"),
      q: url.searchParams.get("q"),
      cursor: url.searchParams.get("cursor"),
    });
    return ok(await withUploaderMetadata(queue), 200, traceId);
  } catch (error) {
    if (error instanceof ActionError) return err(error.code, error.message, error.status, traceId);
    if (error instanceof z.ZodError) return err("invalid_id", "Invalid import case ID", 400, traceId);
    return err("smart_import_failed", error instanceof Error ? error.message : "Request failed", 500, traceId);
  }
}

const ActionBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start_review"), id: z.uuid(), reviewer_id: z.uuid() }),
  z.object({
    action: z.literal("save"), id: z.uuid(), reviewer_id: z.uuid(), draft: z.record(z.string(), z.unknown()),
    document_match_confirmed: z.boolean(), information_match_confirmed: z.boolean(),
  }),
  z.object({ action: z.literal("verify"), id: z.uuid() }),
  z.object({
    action: z.literal("approve"), id: z.uuid(), reviewer_id: z.uuid(), draft: z.record(z.string(), z.unknown()),
    document_match_confirmed: z.boolean(), information_match_confirmed: z.boolean(),
  }),
  z.object({ action: z.literal("archive"), id: z.uuid() }),
  z.object({ action: z.literal("restore"), id: z.uuid() }),
  z.object({ action: z.literal("soft_delete"), id: z.uuid(), case_number: z.string().min(1) }),
]);

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  if (guard.session.staff.role === "staff") return err("forbidden", "Smart client import requires manager or admin access", 403, traceId);
  try {
    const body = ActionBody.parse(await req.json());
    if (body.action === "start_review") return ok(await startImportReview(guard.session, body.id, body.reviewer_id), 200, traceId);
    if (body.action === "save") return ok(await saveImportReviewWithEvidence(guard.session, {
      id: body.id,
      reviewerId: body.reviewer_id,
      draft: body.draft,
      documentConfirmed: body.document_match_confirmed,
      informationConfirmed: body.information_match_confirmed,
    }), 200, traceId);
    if (body.action === "verify") return ok(await verifyImportCase(guard.session, body.id), 200, traceId);
    if (body.action === "archive") {
      const [row] = await sql()`update client_import_cases set archived_at=coalesce(archived_at,now()) where id=${body.id} and deleted_at is null returning id,case_number,archived_at`;
      if (!row) throw new ActionError("not_found", "Import case not found", 404);
      return ok(row, 200, traceId);
    }
    if (body.action === "restore") {
      const [row] = await sql()`update client_import_cases set archived_at=null where id=${body.id} and deleted_at is null returning id,case_number,archived_at`;
      if (!row) throw new ActionError("not_found", "Import case not found", 404);
      return ok(row, 200, traceId);
    }
    if (body.action === "soft_delete") {
      const [row] = await sql()`select id,case_number,status,created_client_id from client_import_cases where id=${body.id} for update`;
      if (!row) throw new ActionError("not_found", "Import case not found", 404);
      if (String(row.case_number) !== body.case_number.trim()) throw new ActionError("confirmation_mismatch", "Type the exact case number to confirm deletion", 409);
      if (row.status === "APPROVED_FILE" || row.created_client_id) throw new ActionError("delete_blocked", "Approved imports are retained for audit and cannot be deleted", 409);
      const [deleted] = await sql()`update client_import_cases set deleted_at=now(),archived_at=coalesce(archived_at,now()) where id=${body.id} returning id,case_number,deleted_at`;
      return ok(deleted, 200, traceId);
    }
    return ok(await approveImportCase(guard.session, {
      id: body.id,
      reviewerId: body.reviewer_id,
      draft: body.draft,
      documentConfirmed: body.document_match_confirmed,
      informationConfirmed: body.information_match_confirmed,
      traceId,
    }), 200, traceId);
  } catch (error) {
    if (error instanceof ActionError) return err(error.code, error.message, error.status, traceId);
    if (error instanceof z.ZodError) return err("invalid_input", error.issues[0]?.message ?? "Invalid input", 400, traceId);
    return err("smart_import_failed", error instanceof Error ? error.message : "Request failed", 500, traceId);
  }
}
