import { z } from "zod";
import { withStaff } from "@/lib/auth";
import { dbErrorResponse, err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { registryFilterValues } from "@/lib/registry-filters";
import { isTrustedMutationOrigin } from "@/lib/request-origin";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Input = z.object({ name: z.string().trim().min(1).max(80), filters: z.record(z.string(), z.string().max(100)) });

export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: false });
  if (guard.response) return guard.response;
  const filters = await withStaff(guard.session, tx => tx`select id,name,filters from staff_saved_filters where staff_id=${guard.session.staff.id} order by name`);
  return Response.json({ ok: true, filters }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  if (!isTrustedMutationOrigin(req)) return err("invalid_origin", "The request must come from this application", 403, traceId);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("invalid_input", "Enter a filter name of 1–80 characters", 400, traceId);
  const filters = registryFilterValues(new URLSearchParams(parsed.data.filters), guard.session.staff.role !== "staff");
  try {
    const saved = await withStaff(guard.session, async tx => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`registry-filters:${guard.session.staff.id}`},0))`;
      const [{total}] = await tx`select count(*)::int total from staff_saved_filters where staff_id=${guard.session.staff.id}`;
      const [existing] = await tx`select id from staff_saved_filters where staff_id=${guard.session.staff.id} and name=${parsed.data.name}`;
      if (Number(total) >= 20 && !existing) return null;
      const [row] = await tx`insert into staff_saved_filters(staff_id,name,filters)
        values(${guard.session.staff.id},${parsed.data.name},${tx.json(filters)})
        on conflict(staff_id,name) do update set filters=excluded.filters returning id,name,filters`;
      return row;
    });
    if (!saved) return err("filter_limit", "You can save up to 20 filters. Remove an existing filter first.", 409, traceId);
    return ok({ filter: saved }, 200, traceId);
  } catch (error) { return dbErrorResponse(error, traceId); }
}

export async function DELETE(req: Request) {
  const traceId = traceIdFrom(req);
  if (!isTrustedMutationOrigin(req)) return err("invalid_origin", "The request must come from this application", 403, traceId);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  const parsed = z.object({ id: z.uuid() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("invalid_input", "Invalid filter", 400, traceId);
  const rows = await withStaff(guard.session, tx => tx`delete from staff_saved_filters where id=${parsed.data.id} and staff_id=${guard.session.staff.id} returning id`);
  if (!rows.length) return err("not_found", "Saved filter not found", 404, traceId);
  return ok({ removed: parsed.data.id }, 200, traceId);
}
