import "server-only";
import { EMBEDDING_COLUMN_DIMENSIONS, registry } from "./config";

const BASE = "https://api.openai.com/v1";

type Fail = { ok: false; code: "NOT_CONFIGURED" | "PROVIDER_ERROR" | "TIMEOUT"; message: string };

function fail(e: unknown): Fail {
  const timeout = e instanceof Error && e.name === "TimeoutError";
  return { ok: false, code: timeout ? "TIMEOUT" : "PROVIDER_ERROR", message: e instanceof Error ? e.message : "error" };
}

/** Responses API with a strict JSON schema. Returns the raw text for Zod validation. */
export async function agentJson(args: { system: string; input: string; schemaName: string; schema: unknown }): Promise<
  { ok: true; text: string; model: string } | Fail
> {
  const { apiKey, agentModel } = registry.openai();
  if (!apiKey || !agentModel) return { ok: false, code: "NOT_CONFIGURED", message: "Agent model is NOT_CONFIGURED" };
  try {
    const res = await fetch(`${BASE}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: agentModel,
        instructions: args.system,
        input: args.input,
        text: { format: { type: "json_schema", name: args.schemaName, schema: args.schema, strict: true } },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      output?: { type?: string; content?: { type?: string; text?: string }[] }[];
      error?: { message?: string };
    };
    if (!res.ok) return { ok: false, code: "PROVIDER_ERROR", message: body.error?.message ?? `HTTP ${res.status}` };
    const text = (body.output ?? [])
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text ?? "")
      .join("");
    return { ok: true, text, model: agentModel };
  } catch (e) {
    return fail(e);
  }
}

export async function embed(texts: string[]): Promise<{ ok: true; vectors: number[][]; model: string } | Fail> {
  const { apiKey, embeddingModel, embeddingDimensions } = registry.openai();
  if (!apiKey || !embeddingModel || embeddingDimensions !== EMBEDDING_COLUMN_DIMENSIONS) {
    return { ok: false, code: "NOT_CONFIGURED", message: "Embeddings are NOT_CONFIGURED" };
  }
  try {
    const res = await fetch(`${BASE}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: embeddingModel, input: texts, dimensions: embeddingDimensions }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as { data?: { embedding: number[]; index: number }[]; error?: { message?: string } };
    if (!res.ok || !body.data) return { ok: false, code: "PROVIDER_ERROR", message: body.error?.message ?? `HTTP ${res.status}` };
    const vectors = body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (vectors.some((v) => v.length !== EMBEDDING_COLUMN_DIMENSIONS)) {
      return { ok: false, code: "PROVIDER_ERROR", message: "Embedding dimension mismatch" };
    }
    return { ok: true, vectors, model: embeddingModel };
  } catch (e) {
    return fail(e);
  }
}

export async function openaiModelStatus(model: string | null) {
  const { apiKey } = registry.openai();
  if (!apiKey || !model) return { model, status: "NOT_CONFIGURED" as const };
  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return { model, status: res?.ok ? ("AVAILABLE" as const) : ("UNAVAILABLE" as const), http: res?.status ?? null };
}
