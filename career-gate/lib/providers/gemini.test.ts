import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geminiExtract, geminiLiveProbe } from "./gemini";

describe("Gemini document vision real API contract", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_GEMINI_API_KEY", "unit-test-key");
    vi.stubEnv("DOCUMENT_VISION_FAST_MODEL", "gemini-3.5-flash-lite");
    vi.stubEnv("DOCUMENT_VISION_ESCALATION_MODEL", "gemini-3.8-flash");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("actually posts inline source bytes and a JSON schema to the configured Gemini model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "{\"clients\":[]}" }] } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const schema = { type: "OBJECT", properties: { clients: { type: "ARRAY" } } };
    const result = await geminiExtract({ model: "fast", mimeType: "image/png", data: new Uint8Array([1, 2, 3]), prompt: "extract", responseSchema: schema });
    expect(result).toEqual({ ok: true, text: "{\"clients\":[]}", model: "gemini-3.5-flash-lite" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models/gemini-3.5-flash-lite:generateContent");
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe("unit-test-key");
    const body = JSON.parse(String(init.body));
    expect(body.contents[0].parts[0].inlineData).toEqual({ mimeType: "image/png", data: "AQID" });
    expect(body.generationConfig.responseSchema).toEqual(schema);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("does not misreport quota exhaustion or disclose raw Google diagnostics", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "Secret project ID and billing URL" } }), { status: 429 },
    )));
    const result = await geminiExtract({ model: "fast", mimeType: "image/png", data: new Uint8Array([1]), prompt: "extract", responseSchema: {} });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("QUOTA_EXCEEDED");
    expect(result.message).not.toContain("Secret project");
    expect(result.message).toContain("quota");
  });

  it("rejects an empty candidate rather than declaring extraction successful", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [] }), { status: 200 })));
    const result = await geminiExtract({ model: "fast", mimeType: "application/pdf", data: new Uint8Array([1]), prompt: "extract", responseSchema: {} });
    expect(result).toMatchObject({ ok: false, code: "PROVIDER_ERROR" });
  });

  it("reports unconfigured models without contacting Google", async () => {
    vi.stubEnv("GOOGLE_GEMINI_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await geminiLiveProbe("fast")).toEqual({ model: "gemini-3.5-flash-lite", status: "NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a real generateContent request to verify each model can generate", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "{\"status\":\"OK\"}" }] } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await geminiLiveProbe("escalation")).toEqual({ model: "gemini-3.8-flash", status: "AVAILABLE" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models/gemini-3.8-flash:generateContent");
    const body = JSON.parse(String(init.body));
    expect(body.contents[0].parts[0].text).toContain("status");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.contents[0].parts).toHaveLength(1);
  });

  it("distinguishes real provider permission failures from valid generation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 403 })));
    expect(await geminiLiveProbe("fast")).toEqual({ model: "gemini-3.5-flash-lite", status: "UNAVAILABLE", reason: "AUTH_FAILED", http: 403 });
  });
});
