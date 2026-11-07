// @vitest-environment node
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("@/lib/server-voice-auth", () => ({ authorizeVoiceRequest: auth.authorize }));

import { POST as analyze } from "@/app/api/analyze/route";
import { POST as transcribe } from "@/app/api/stt/route";

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", "test-not-a-real-key");
  auth.authorize.mockReset().mockResolvedValue(null);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function audioRequest(bytes: Uint8Array): NextRequest {
  const form = new FormData();
  form.set("file", new File([bytes as BlobPart], "عينة.m4a", { type: "audio/x-m4a" }));
  return new NextRequest("http://localhost/api/stt", { method: "POST", body: form });
}

function analysisRequest(): NextRequest {
  return new NextRequest("http://localhost/api/analyze", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "قال عمر إن المبلغ غير واضح." }),
  });
}

describe("authenticated Groq routes using the real SDK transport", () => {
  it("uploads M4A bytes with SDK multipart boundary, Arabic and unchanged source hash", async () => {
    const bytes = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32, 0, 0, 0, 0]);
    const transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(url, init);
      if (req.url === "data:,") return new Response(""); // SDK multipart capability probe.
      expect(req.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
      expect(req.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
      const sent = await req.formData();
      const file = sent.get("file") as File;
      expect(file.name).toBe("recording.m4a");
      expect(file.type).toBe("audio/mp4");
      expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes);
      expect(sent.get("language")).toBe("ar");
      expect(sent.get("model")).toBe("whisper-large-v3");
      return Response.json({ text: "هذا نص الاختبار." });
    });
    vi.stubGlobal("fetch", transport);
    const result = await transcribe(audioRequest(bytes));
    expect(result.status).toBe(200);
    expect((await result.json()).source_sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(transport.mock.calls.filter(([url]) => String(url).startsWith("https://api.groq.com/"))).toHaveLength(1);
  });

  it("keeps authorization before any provider call", async () => {
    auth.authorize.mockResolvedValue(NextResponse.json({ error: "Authentication required." }, { status: 401 }));
    const transport = vi.fn(); vi.stubGlobal("fetch", transport);
    expect((await transcribe(audioRequest(Buffer.from("bad")))).status).toBe(401);
    expect((await analyze(analysisRequest())).status).toBe(401);
    expect(transport).not.toHaveBeenCalled();
  });

  it("uses GPT OSS JSON mode and returns only validated derived fields", async () => {
    const fields = { cleaned_transcript: "قال عمر إن المبلغ غير واضح.", summary: "المبلغ غير واضح.", translation: "Omar said the amount is unclear.", analysis: "الاسم: عمر. المبلغ: غير محسوم." };
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const body = await new Request(url, init).json();
      expect(body.model).toBe("openai/gpt-oss-120b");
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body.messages[0].content).toContain("Do NOT assign real identities");
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ ...fields, extra: "ignored" }) } }] });
    }));
    const result = await analyze(analysisRequest());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(fields);
    expect(result.headers.get("x-analysis-model")).toBe("openai/gpt-oss-120b");
  });

  it("rejects truncated or malformed analysis instead of displaying partial text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ finish_reason: "length", message: { content: "{}" } }] })));
    expect((await analyze(analysisRequest())).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"cleaned_transcript":"x"}' } }] })));
    expect((await analyze(analysisRequest())).status).toBe(502);
  });

  it("reports model access failure without leaking the provider message or key", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "model_not_found", message: "sensitive provider details" } }, { status: 404 })));
    const result = await analyze(analysisRequest());
    expect(result.status).toBe(503);
    expect(JSON.stringify(await result.json())).not.toContain("sensitive provider details");
    expect(log).toHaveBeenCalledWith("MURAILEX_ANALYSIS_FAILED", expect.objectContaining({ model: "openai/gpt-oss-120b", providerCode: "model_not_found" }));
  });
});
