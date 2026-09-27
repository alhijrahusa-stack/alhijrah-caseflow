import "server-only";
import { sql } from "@/lib/db";
import { runIntakeAgent } from "@/lib/intake-agent";

/** Runs the intake agent for a client and records the run. Never edits the client. */
export async function intakeAgentFor(clientId: string, staffId: string | null, traceId: string) {
  const db = sql();
  const [c] = await db`select * from clients where id = ${clientId}`;
  if (!c) return null;
  const [[{ n: preferences }], [{ n: employment }], documents] = await Promise.all([
    db`select count(*)::int as n from client_preferences where client_id = ${clientId}`,
    db`select count(*)::int as n from employment_history where client_id = ${clientId}`,
    db`select doc_type, status from documents where client_id = ${clientId}`,
  ]);
  const t0 = performance.now();
  const r = await runIntakeAgent(c as never, { preferences, employment, documents: documents as never });
  const status = r.llm.status === "not_needed" ? "succeeded" : r.llm.status;
  const [run] = await db`
    insert into agent_runs (agent, client_id, input_hash, output, provider, model, status, error, trace_id, duration_ms, created_by)
    values ('intake', ${clientId}, ${r.inputHash}, ${db.json({ ...r.findings, llm: r.llm } as never)}, 'openai',
            ${"model" in r.llm ? (r.llm.model ?? null) : null}, ${status}, ${"error" in r.llm ? (r.llm.error ?? null) : null}, ${traceId},
            ${Math.round(performance.now() - t0)}, ${staffId})
    returning id, created_at`;
  return { id: run.id as string, created_at: run.created_at as Date, ...r };
}
