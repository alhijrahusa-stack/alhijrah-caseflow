import { afterEach, describe, expect, it, vi } from "vitest";
import { embed } from "./embeddings";
import { providerStates } from "./config";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function configured() {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("GOOGLE_GEMINI_API_KEY", "test-gemini-key");
  vi.stubEnv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001");
}

describe("semantic embedding transport", () => {
  it("remains unconfigured without an explicit embedding model", async () => {
    configured(); vi.stubEnv("GEMINI_EMBEDDING_MODEL", "");
    const transport = vi.fn(); vi.stubGlobal("fetch", transport);
    expect(await embed(["Search text"])).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
    expect(providerStates().embeddings).toBe("NOT_CONFIGURED");
    expect(transport).not.toHaveBeenCalled();
  });

  it("normalizes 1536-dimensional vectors and identifies their embedding space", async () => {
    configured();
    const transport = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embeddings: [{ values: [3, 4, ...Array(1534).fill(0)] }] }) });
    vi.stubGlobal("fetch", transport);
    const result = await embed(["Search text"], "query");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.model).toBe("google/gemini-embedding-001");
    expect(result.vectors[0]).toHaveLength(1536);
    expect(Math.hypot(...result.vectors[0])).toBeCloseTo(1);
    const request = JSON.parse(transport.mock.calls[0][1].body);
    expect(request.requests[0]).toMatchObject({ taskType: "RETRIEVAL_QUERY", outputDimensionality: 1536 });
    expect(providerStates().embeddings).toBe("CONFIGURED");
  });

  it.each([
    { embeddings: [] },
    { embeddings: [{ values: [1] }] },
    { embeddings: [{ values: Array(1536).fill(0) }] },
    { embeddings: [{ values: [NaN, ...Array(1535).fill(1)] }] },
    { embeddings: [{ values: [Infinity, ...Array(1535).fill(1)] }] },
  ])("rejects malformed provider vectors before they reach Postgres", async body => {
    configured(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
    expect(await embed(["Search text"])).toMatchObject({ ok: false, code: "PROVIDER_ERROR" });
  });

  it("does not expose provider response content in an error", async () => {
    configured(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { message: "private provider diagnostic" } }) }));
    const result = await embed(["Search text"]);
    expect(result).toMatchObject({ ok: false, message: "Embedding provider returned HTTP 403" });
    expect(JSON.stringify(result)).not.toContain("private provider diagnostic");
  });

  it("keeps an explicitly configured OpenAI embedding provider", async () => {
    configured(); vi.stubEnv("OPENAI_API_KEY", "test-openai-key"); vi.stubEnv("OPENAI_EMBEDDING_MODEL", "configured-model"); vi.stubEnv("EMBEDDING_DIMENSIONS", "1536");
    const transport = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ index: 0, embedding: Array(1536).fill(1) }] }) });
    vi.stubGlobal("fetch", transport);
    expect(await embed(["Search text"])).toMatchObject({ ok: true, model: "configured-model" });
    expect(transport.mock.calls[0][0]).toBe("https://api.openai.com/v1/embeddings");
  });
});
