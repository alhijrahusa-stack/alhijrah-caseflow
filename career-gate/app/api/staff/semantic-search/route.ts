import { withStaff } from "@/lib/auth";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { embed } from "@/lib/providers/openai";
import { redact, toVector } from "@/lib/semantic";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

/**
 * query → embedding → vector search under RLS (authorization filter) →
 * joined to the relational client row (authoritative status) → ranked.
 */
export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const g = await staffGuard(req, traceId, { mutation: false });
  if (g.response) return g.response;
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 500);
  if (q.length < 3) return err("invalid_input", "Enter at least 3 characters", 400, traceId);
  const e = await embed([redact(q)]);
  if (!e.ok) return err(e.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "provider_error", e.message, e.code === "NOT_CONFIGURED" ? 503 : 502, traceId);
  const results = await withStaff(g.session, (tx) => tx`
    select s.client_id, c.ref, c.full_name, c.current_status, s.source_type, s.content_redacted,
           round((1 - (s.embedding <=> ${toVector(e.vectors[0])}::vector))::numeric, 4) as score
    from semantic_index s join clients c on c.id = s.client_id
    where c.deleted_at is null
    order by s.embedding <=> ${toVector(e.vectors[0])}::vector
    limit 20`);
  return ok({ results, model: e.model }, 200, traceId);
}
