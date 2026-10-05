import "server-only";
import { runAudit } from "@/lib/audit";
import { sql } from "@/lib/db";
import { processDocument } from "@/lib/doc-intel";
import { registerHandler } from "@/lib/jobs";
import { deliverNotification } from "@/lib/notify";
import { indexSource, type SemanticSource } from "@/lib/semantic";

registerHandler("document_extraction", async (job) => {
  const r = await processDocument(job.entity_id!, job.trace_id ?? job.id);
  return r.status === "not_configured" ? { status: "not_configured", note: "Document vision NOT_CONFIGURED; human review required" } : { status: "succeeded" };
});

registerHandler("semantic_embedding", async (job) => {
  const r = await indexSource(job.payload.source as SemanticSource, job.entity_id!);
  if (r.status === "not_configured") return { status: "not_configured", note: "Embeddings NOT_CONFIGURED" };
  if (r.status === "failed") throw new Error(r.error);
  return { status: "succeeded" };
});

registerHandler("notification_send", async (job) => {
  const r = await deliverNotification(job.entity_id!);
  if (r.status === "failed") {
    if (r.retryable && job.attempts < job.max_attempts) {
      await sql()`update notifications set status = 'queued' where id = ${job.entity_id}`;
      throw new Error(r.error);
    }
    return { status: "failed_permanent", error: r.error };
  }
  if (r.status === "not_configured") return { status: "not_configured", note: "Provider NOT_CONFIGURED" };
  return { status: "succeeded" };
});

registerHandler("audit_scan", async (job) => {
  await runAudit((job.payload.client_id as string | undefined) ?? null, job.trace_id ?? job.id);
  return { status: "succeeded" };
});

registerHandler("intake_analysis", async (job) => {
  const { intakeAgentFor } = await import("@/lib/agent-runs");
  await intakeAgentFor(job.entity_id!, null, job.trace_id ?? job.id);
  return { status: "succeeded" };
});

registerHandler("smart_client_enrichment", async (job) => {
  if (!job.entity_id) return { status: "failed_permanent", error: "Smart import enrichment is missing case id" };
  const { enrichMobileImportCaseById } = await import("@/lib/smart-client-mobile");
  await enrichMobileImportCaseById(job.entity_id, { traceId: job.trace_id ?? job.id, jobId: job.id });
  return { status: "succeeded" };
});
