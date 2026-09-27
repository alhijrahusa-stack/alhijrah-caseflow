import "server-only";
import type postgres from "postgres";
import { sql } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { embed } from "@/lib/providers/openai";

export type SemanticSource = "note" | "task" | "contact" | "followup";

/** Removes contact details and identifiers before text leaves the database. */
export function redact(text: string) {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b\d{3}-?\d{2}-?\d{4}\b/g, "[id]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]")
    .replace(/\b[A-Za-z]?\d{7,}\b/g, "[id]")
    .slice(0, 4000);
}

export const toVector = (v: number[]) => `[${v.join(",")}]`;

export async function queueEmbedding(tx: postgres.TransactionSql, source: SemanticSource, sourceId: string, traceId: string) {
  await enqueue(tx, { type: "semantic_embedding", entityId: sourceId, payload: { source }, dedupeKey: `embed:${source}:${sourceId}`, traceId, maxAttempts: 4 });
}

async function sourceText(source: SemanticSource, id: string) {
  const db = sql();
  const [r] =
    source === "note"
      ? await db`select client_id, note as text from notes where id = ${id}`
      : source === "task"
        ? await db`select client_id, concat_ws('. ', title, description) as text from tasks where id = ${id} and client_id is not null`
        : source === "contact"
          ? await db`select client_id, concat_ws('. ', method, result, next_action) as text from contacts where id = ${id}`
          : await db`select client_id, concat_ws('. ', reason, completion_note) as text from followups where id = ${id}`;
  return r ? { clientId: r.client_id as string, text: redact(r.text as string) } : null;
}

export async function indexSource(source: SemanticSource, id: string) {
  const s = await sourceText(source, id);
  if (!s) return { status: "missing" as const };
  const res = await embed([s.text]);
  if (!res.ok) return res.code === "NOT_CONFIGURED" ? { status: "not_configured" as const } : { status: "failed" as const, error: res.message };
  await sql()`
    insert into semantic_index (client_id, source_type, source_id, content_redacted, embedding, model)
    values (${s.clientId}, ${source}, ${id}, ${s.text}, ${toVector(res.vectors[0])}::vector, ${res.model})
    on conflict (source_type, source_id) do update
      set content_redacted = excluded.content_redacted, embedding = excluded.embedding, model = excluded.model, updated_at = now()`;
  return { status: "indexed" as const };
}
