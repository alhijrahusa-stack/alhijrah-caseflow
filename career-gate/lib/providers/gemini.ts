import "server-only";
import { registry } from "./config";

type GeminiErrorCode = "NOT_CONFIGURED" | "PROVIDER_ERROR" | "TIMEOUT" | "QUOTA_EXCEEDED" | "AUTH_FAILED" | "MODEL_UNAVAILABLE";

function classifyGoogleStatus(status: number): GeminiErrorCode {
  if (status === 429) return "QUOTA_EXCEEDED";
  if (status === 401 || status === 403) return "AUTH_FAILED";
  if (status === 404) return "MODEL_UNAVAILABLE";
  return "PROVIDER_ERROR";
}

function safeErrorMessage(code: GeminiErrorCode): string {
  if (code === "QUOTA_EXCEEDED") return "Gemini quota exceeded. Document reading is temporarily unavailable.";
  if (code === "AUTH_FAILED") return "Gemini API credentials or permissions were rejected.";
  if (code === "MODEL_UNAVAILABLE") return "The configured Gemini model is unavailable.";
  if (code === "TIMEOUT") return "Gemini request timed out.";
  if (code === "NOT_CONFIGURED") return "Gemini document vision is not configured.";
  return "Gemini did not complete the request.";
}


const BASE = "https://generativelanguage.googleapis.com/v1beta";

export type VisionCall =
  | { ok: true; text: string; model: string }
  | { ok: false; code: GeminiErrorCode; message: string; model: string | null };

/** Structured extraction from an image or PDF with a JSON response schema. */
export async function geminiExtract(args: {
  model: "fast" | "escalation";
  mimeType: string;
  data: Uint8Array;
  prompt: string;
  responseSchema: unknown;
  timeoutMs?: number;
}): Promise<VisionCall> {
  const cfg = registry.documentVision();
  const model = args.model === "fast" ? cfg.fastModel : cfg.escalationModel;
  if (!cfg.apiKey || !model) return { ok: false, code: "NOT_CONFIGURED", message: "Document vision is NOT_CONFIGURED", model };
  try {
    const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType: args.mimeType, data: Buffer.from(args.data).toString("base64") } },
            { text: args.prompt },
          ],
        }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: args.responseSchema },
      }),
      signal: AbortSignal.timeout(args.timeoutMs ?? 45_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      const code = classifyGoogleStatus(res.status);
      return { ok: false, code, message: safeErrorMessage(code), model };
    }
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) return { ok: false, code: "PROVIDER_ERROR", message: safeErrorMessage("PROVIDER_ERROR"), model };
    return { ok: true, text, model };
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    const code = timeout ? "TIMEOUT" : "PROVIDER_ERROR";
    return { ok: false, code, message: safeErrorMessage(code), model };
  }
}

/** This makes an actual generateContent call, not merely a model-list check. No client data is sent. */
export async function geminiLiveProbe(which: "fast" | "escalation") {
  const cfg = registry.documentVision();
  const model = which === "fast" ? cfg.fastModel : cfg.escalationModel;
  if (!cfg.apiKey || !model) return { model, status: "NOT_CONFIGURED" as const };
  try {
    const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Return exactly this JSON object: {\"status\":\"OK\"}." }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 64,
          responseSchema: { type: "OBJECT", properties: { status: { type: "STRING" } }, required: ["status"] } },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      const code = classifyGoogleStatus(res.status);
      return { model, status: "UNAVAILABLE" as const, reason: code, http: res.status };
    }
    const body = await res.json().catch(() => null) as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null;
    const output = body?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    let valid = false;
    try { valid = JSON.parse(output)?.status === "OK"; } catch { /* malformed upstream response */ }
    return valid
      ? { model, status: "AVAILABLE" as const }
      : { model, status: "UNAVAILABLE" as const, reason: "INVALID_RESPONSE" as const };
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    return { model, status: "UNAVAILABLE" as const, reason: timeout ? "TIMEOUT" as const : "PROVIDER_ERROR" as const };
  }
}
/** Capability check: does the configured model exist for this key? */
export async function geminiModelStatus(which: "fast" | "escalation") {
  const cfg = registry.documentVision();
  const model = which === "fast" ? cfg.fastModel : cfg.escalationModel;
  if (!cfg.apiKey || !model) return { model, status: "NOT_CONFIGURED" as const };
  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}`, {
    headers: { "x-goog-api-key": cfg.apiKey },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return { model, status: res?.ok ? ("AVAILABLE" as const) : ("UNAVAILABLE" as const), http: res?.status ?? null };
}
