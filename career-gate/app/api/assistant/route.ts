import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { convertToModelMessages, stepCountIs, streamText, type LanguageModel } from "ai";
import { ASSISTANT_LIMITS, AssistantRequest, assistantSystemPrompt, assistantTools, conversationForModel } from "@/lib/assistant-chat";
import { err, ipHash } from "@/lib/http";
import { log, traceIdFrom } from "@/lib/obs";
import { registry } from "@/lib/providers/config";
import { hitBoth, securityEvent } from "@/lib/ratelimit";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Overridable in tests only; production always builds the Gemini model from the registry. */
export const assistantModel = {
  create(apiKey: string, modelId: string): LanguageModel {
    return createGoogleGenerativeAI({ apiKey })(modelId);
  },
};

/**
 * Operations assistant chat for managers and admins. Streams a UI message
 * stream (AI SDK) from Gemini; the model answers through read-only checks that
 * run under the caller's RLS scope. Only user and assistant text is accepted
 * from the browser.
 */
export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: false });
  if (guard.response) return guard.response;
  const session = guard.session;
  if (session.staff.role === "staff") return err("forbidden", "Operational assistant requires manager or admin access", 403, traceId);

  const config = registry.operationsAssistant();
  if (!config.apiKey) return err("assistant_not_configured", "The assistant model is NOT_CONFIGURED on this deployment.", 503, traceId);

  // Bounded before parsing: the history is resent each turn, but never needs this much.
  const declared = Number(req.headers.get("content-length") ?? 0);
  const raw = declared > ASSISTANT_LIMITS.bodyBytes ? null : await req.text().catch(() => null);
  if (raw === null || raw.length > ASSISTANT_LIMITS.bodyBytes) return err("payload_too_large", "The conversation is too long. Start a new chat.", 413, traceId);
  const parsed = AssistantRequest.safeParse((() => { try { return JSON.parse(raw); } catch { return null; } })());
  const conversation = parsed.success ? conversationForModel(parsed.data.messages) : null;
  if (!conversation) return err("invalid_input", "Send a question as the latest message", 400, traceId);

  const [okWindow, okDay] = await hitBoth("assistant_chat_10min", "assistant_chat_day", `staff:${session.staff.id}`);
  if (!okWindow || !okDay) {
    await securityEvent({ event: "rate_limited_assistant_chat", staffId: session.staff.id, ipHash: ipHash(req), route: "/api/assistant", traceId });
    return err("rate_limited", "Too many assistant questions. Wait a few minutes and try again.", 429, traceId);
  }

  const started = Date.now();
  const result = streamText({
    model: assistantModel.create(config.apiKey, config.model),
    system: assistantSystemPrompt(new Date()),
    messages: await convertToModelMessages(conversation),
    tools: assistantTools(session, (intent, error) => {
      log("error", { event: "assistant_check_failed", trace_id: traceId, intent, error_message: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
    }),
    stopWhen: stepCountIs(ASSISTANT_LIMITS.steps),
    maxOutputTokens: ASSISTANT_LIMITS.outputTokens,
    temperature: 0.2,
    abortSignal: req.signal,
    onFinish: ({ usage, steps, finishReason }) => {
      log("info", {
        event: "assistant_chat_finished", trace_id: traceId, model: config.model, finish_reason: finishReason, steps: steps.length,
        tools: steps.flatMap((step) => step.toolCalls.map((call) => call.toolName)), input_tokens: usage.inputTokens ?? null,
        output_tokens: usage.outputTokens ?? null, duration_ms: Date.now() - started,
      });
    },
  });

  return result.toUIMessageStreamResponse({
    headers: { "Cache-Control": "private, no-store", "X-Trace-Id": traceId },
    onError: (error) => {
      log("error", { event: "assistant_chat_failed", trace_id: traceId, model: config.model, error_message: error instanceof Error ? error.message.slice(0, 300) : "unknown" });
      return "The assistant could not answer right now. Try again.";
    },
  });
}
