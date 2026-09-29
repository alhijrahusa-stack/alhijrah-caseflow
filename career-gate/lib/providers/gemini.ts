import "server-only";
import { registry } from "./config";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export type VisionCall =
  | { ok: true; text: string; model: string }
  | { ok: false; code: "NOT_CONFIGURED" | "PROVIDER_ERROR" | "TIMEOUT"; message: string; model: string | null };

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
    if (!res.ok) return { ok: false, code: "PROVIDER_ERROR", message: body.error?.message ?? `HTTP ${res.status}`, model };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return { ok: true, text, model };
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    return { ok: false, code: timeout ? "TIMEOUT" : "PROVIDER_ERROR", message: e instanceof Error ? e.message : "error", model };
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
