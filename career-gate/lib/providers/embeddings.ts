import "server-only";
import { EMBEDDING_COLUMN_DIMENSIONS, registry } from "./config";
import { embed as openaiEmbed } from "./openai";

export async function embed(texts: string[], purpose: "document" | "query" = "document") {
  const openai = registry.openai();
  if (openai.apiKey && openai.embeddingModel && openai.embeddingDimensions === EMBEDDING_COLUMN_DIMENSIONS) return openaiEmbed(texts);
  const { apiKey, model } = registry.geminiEmbedding();
  if (!apiKey || !model) return { ok: false as const, code: "NOT_CONFIGURED" as const, message: "Embeddings are NOT_CONFIGURED" };
  if (texts.length === 0 || texts.some(text => !text.trim())) return { ok: false as const, code: "PROVIDER_ERROR" as const, message: "Embedding input is empty" };
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: texts.map(text => ({
        model: `models/${model}`,
        content: { parts: [{ text }] },
        taskType: purpose === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
        outputDimensionality: EMBEDDING_COLUMN_DIMENSIONS,
      })) }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => null) as { embeddings?: { values?: number[] }[] } | null;
    if (!response.ok) return { ok: false as const, code: "PROVIDER_ERROR" as const, message: `Embedding provider returned HTTP ${response.status}` };
    if (!Array.isArray(body?.embeddings) || body.embeddings.length !== texts.length) return { ok: false as const, code: "PROVIDER_ERROR" as const, message: "Embedding response count mismatch" };
    const vectors: number[][] = [];
    for (const item of body.embeddings) {
      const values = item.values;
      if (!Array.isArray(values) || values.length !== EMBEDDING_COLUMN_DIMENSIONS || values.some(value => typeof value !== "number" || !Number.isFinite(value))) return { ok: false as const, code: "PROVIDER_ERROR" as const, message: "Invalid embedding vector" };
      const norm = Math.hypot(...values);
      if (!Number.isFinite(norm) || norm === 0) return { ok: false as const, code: "PROVIDER_ERROR" as const, message: "Invalid embedding norm" };
      vectors.push(values.map(value => value / norm));
    }
    return { ok: true as const, vectors, model: `google/${model}` };
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    return { ok: false as const, code: timeout ? "TIMEOUT" as const : "PROVIDER_ERROR" as const, message: timeout ? "Embedding request timed out" : "Embedding provider request failed" };
  }
}
