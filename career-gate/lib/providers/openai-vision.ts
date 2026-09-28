import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { registry } from "@/lib/providers/config";

export const DocumentVisionSchema = z.object({
  documentType: z.enum(["Passport", "DriverLicense", "StateID", "WorkPermit", "Other"]),
  fullName: z.string().max(200),
  dateOfBirth: z.string().max(20),
  expirationDate: z.string().max(20),
  documentNumber: z.string().max(80),
  confidenceScore: z.number().min(0).max(1),
  detectedLanguage: z.enum(["en", "ar", "bilingual"]),
});

export type DocumentVision = z.infer<typeof DocumentVisionSchema>;

const INSTRUCTIONS = `Extract only text visibly present in this document.

Rules:
- Never infer missing characters.
- Never autocorrect a person's name.
- Preserve spelling exactly as printed.
- If a field is unreadable or absent, return an empty string.
- Normalize dates only when the complete date is clearly legible.
- confidenceScore is advisory extraction confidence only.
- Do not make any eligibility, authenticity, legal, immigration, or identity-verification decision.`;

export type VisionResult =
  | { ok: true; model: string; object: DocumentVision }
  | { ok: false; model: string | null; code: "NOT_CONFIGURED" | "TIMEOUT" | "PROVIDER_ERROR" | "SCHEMA_INVALID"; message: string };

export async function openaiVisionExtract(input: { mimeType: string; data: Uint8Array }): Promise<VisionResult> {
  const cfg = registry.documentVision();
  if (!cfg.apiKey || !cfg.model) {
    return { ok: false, model: cfg.model, code: "NOT_CONFIGURED", message: "Document vision is NOT_CONFIGURED" };
  }

  const openai = createOpenAI({ apiKey: cfg.apiKey });
  const binary = Buffer.from(input.data);
  const media = input.mimeType === "application/pdf"
    ? ({ type: "file", data: binary, mediaType: "application/pdf" } as const)
    : ({ type: "image", image: binary, mediaType: input.mimeType } as const);

  try {
    const result = await generateText({
      model: openai(cfg.model),
      output: Output.object({ schema: DocumentVisionSchema }),
      temperature: 0,
      abortSignal: AbortSignal.timeout(45_000),
      messages: [{ role: "user", content: [{ type: "text", text: INSTRUCTIONS }, media] }],
    });
    const parsed = DocumentVisionSchema.safeParse(result.output);
    if (!parsed.success) {
      return { ok: false, model: cfg.model, code: "SCHEMA_INVALID", message: parsed.error.issues[0]?.message ?? "Structured output schema invalid" };
    }
    return { ok: true, model: cfg.model, object: parsed.data };
  } catch (error) {
    const e = error as { name?: string; message?: string };
    const timedOut = e?.name === "TimeoutError" || /timeout|timed out/i.test(e?.message ?? "");
    return {
      ok: false,
      model: cfg.model,
      code: timedOut ? "TIMEOUT" : "PROVIDER_ERROR",
      message: e?.message || (timedOut ? "Document vision timed out" : "Document vision provider failed"),
    };
  }
}
