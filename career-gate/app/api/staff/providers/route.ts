import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { providerStates, registry } from "@/lib/providers/config";
import { geminiLiveProbe, geminiModelStatus } from "@/lib/providers/gemini";
import { openaiModelStatus } from "@/lib/providers/openai";
import { staffGuard } from "@/lib/staff-api";
import { embed } from "@/lib/providers/embeddings";
import { processJobs } from "@/lib/jobs";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Admin capability check: configuration state plus live model availability. */
export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const g = await staffGuard(req, traceId, { mutation: false });
  if (g.response) return g.response;
  if (g.session.staff.role !== "admin") return err("forbidden", "Admin only", 403, traceId);
  const live = new URL(req.url).searchParams.get("live") === "1";
  const o = registry.openai();
  return ok({
    states: providerStates(),
    models: live
      ? {
          document_fast: await geminiModelStatus("fast"),
          document_escalation: await geminiModelStatus("escalation"),
          agent: await openaiModelStatus(o.agentModel),
          embedding: await openaiModelStatus(o.embeddingModel),
        }
      : null,
  }, 200, traceId);
}

/** An explicit admin-only LIVE test against the real Gemini generateContent API. */
export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const g = await staffGuard(req, traceId, { mutation: true });
  if (g.response) return g.response;
  if (g.session.staff.role !== "admin") return err("forbidden", "Admin only", 403, traceId);
  let body: unknown;
  try { body = await req.json(); } catch { return err("invalid_input", "Invalid JSON body", 400, traceId); }
  const action = body && typeof body === "object" && !Array.isArray(body) ? (body as { action?: unknown }).action : null;
  if (action === "recover_embeddings") {
    const probe = await embed(["Career Gate search connectivity check"], "query");
    if (!probe.ok) return err(probe.code, probe.message, 503, traceId);
    const requeued = await sql()`
      update jobs set status='queued',run_after=now(),finished_at=null,locked_until=null,last_error=null
      where id in (select id from jobs where type='semantic_embedding' and status='not_configured'
        order by created_at limit 9 for update skip locked) returning id`;
    const results = await processJobs(9, { types: ["semantic_embedding"], concurrency: 3 });
    const [remaining] = await sql()`select count(*)::int total from jobs where type='semantic_embedding' and status in ('not_configured','queued','running','dead')`;
    const succeeded = results.filter(job => job.status === "succeeded").map(job => job.id);
    const [indexed] = await sql()`select count(*)::int total from semantic_index s join jobs j on j.entity_id=s.source_id::text and j.payload->>'source'=s.source_type
      where j.id=any(${succeeded}::uuid[]) and s.model=${probe.model}`;
    return ok({ requeued: requeued.length, succeeded: succeeded.length, indexed: Number(indexed.total), remaining: Number(remaining.total), model: probe.model }, 200, traceId);
  }
  if (action !== "gemini_probe") {
    return err("invalid_action", "Unsupported provider action", 400, traceId);
  }
  const [fast, escalation] = await Promise.all([geminiLiveProbe("fast"), geminiLiveProbe("escalation")]);
  return ok({ gemini: { fast, escalation }, check_type: "live_generation" }, 200, traceId);
}
