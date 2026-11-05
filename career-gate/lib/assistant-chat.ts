import "server-only";
import { tool, type InferUITools, type UIMessage } from "ai";
import { z } from "zod";
import type { StaffSession } from "@/lib/auth";
import type { AssistantIntent } from "@/lib/operational-assistant-core";
import { operationalAnswerFor, type OperationalAnswer } from "@/lib/operational-assistant";
import { OFFICE } from "@/lib/office";

/**
 * Operations assistant chat: Gemini decides which live check answers the
 * question and words the reply; every figure comes from a read-only check run
 * under the signed-in manager's RLS scope (withStaff). The model is given
 * counts and stage labels only. Client names and record links go to the
 * browser as the tool's output and never to the model.
 */

export const ASSISTANT_LIMITS = { messages: 24, textChars: 2000, steps: 4, outputTokens: 900, bodyBytes: 256 * 1024 } as const;

export function assistantSystemPrompt(now: Date) {
  return [
    "You are the Career Gate operations assistant for managers of an employment-placement office.",
    `Office time zone: ${OFFICE.timeZone}. Current time: ${now.toISOString()}.`,
    "Answer only from the results of the tools in this conversation. Never invent, estimate or round a figure the tools did not return; if a tool reports it is unavailable, say so.",
    "Call a tool whenever the question concerns payments after successful interviews, staff workload, document review blockers or workflow capacity. Call it again for a follow-up instead of reusing an old figure.",
    "If a question needs data no tool provides, say plainly which of the four checks you can run instead. Do not guess.",
    "You cannot change records, send messages or contact anyone. Do not offer to.",
    "The related client records are shown to the user beside your reply as links; refer to them (\"listed below\") rather than naming people.",
    "Reply in the language of the user's latest message (Arabic or English). Be brief and concrete: lead with the number, then the next action. Plain text only, no Markdown tables.",
  ].join("\n");
}

type CheckResult =
  | { status: "ok"; answer: OperationalAnswer }
  | { status: "unavailable" };

/** What the model sees from a check: figures and stage labels, no names, ids or links. */
export function forModel(result: CheckResult) {
  if (result.status !== "ok") return { status: "unavailable", note: "Operational data could not be read. Tell the user to try again." };
  const { answer } = result;
  return {
    status: "ok",
    title: answer.title,
    summary: answer.answer,
    method: answer.method,
    facts: answer.facts.map(({ label, value, unit }) => ({ label, value, ...(unit ? { unit } : {}) })),
    ...(answer.forecast ? { stages: answer.forecast.map(({ label, queued, exits_28d, exits_7d, estimated_clearance_days, sample }) => ({ label, queued, exits_28d, exits_7d, estimated_clearance_days, sample })) } : {}),
    related_records_shown_to_user: answer.links.length,
    generated_at: answer.generated_at,
  };
}

const CHECKS: Record<Exclude<AssistantIntent, "help">, string> = {
  unpaid_interviews: "Clients whose latest recorded interview this office month passed and who still have an outstanding balance, with the total owed.",
  team_load: "Active client files, open and overdue tasks across the team, and the busiest staff members.",
  document_blockers: "Active clients whose latest uploaded document awaits review, was rejected or needs re-upload.",
  flow_forecast: "Queue size and recorded stage exits (7 and 28 days) per workflow stage, with an estimated clearance time where the sample suffices.",
};

export function assistantTools(session: StaffSession, onCheckFailed: (intent: AssistantIntent, error: unknown) => void) {
  const check = (intent: Exclude<AssistantIntent, "help">) => tool({
    description: CHECKS[intent],
    inputSchema: z.object({}),
    execute: async (): Promise<CheckResult> => {
      try {
        return { status: "ok", answer: await operationalAnswerFor(session, intent) };
      } catch (error) {
        onCheckFailed(intent, error);
        return { status: "unavailable" };
      }
    },
    toModelOutput: ({ output }) => ({ type: "json", value: forModel(output) }),
  });
  return {
    unpaid_interviews: check("unpaid_interviews"),
    team_load: check("team_load"),
    document_blockers: check("document_blockers"),
    flow_forecast: check("flow_forecast"),
  };
}

export type AssistantTools = ReturnType<typeof assistantTools>;
export type AssistantUIMessage = UIMessage<never, never, InferUITools<AssistantTools>>;

const IncomingMessage = z.object({
  id: z.string().min(1).max(100),
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.looseObject({ type: z.string().max(60) })).max(60),
});
export const AssistantRequest = z.object({ messages: z.array(IncomingMessage).min(1).max(200) });

/**
 * Keeps only the text the user and the assistant wrote, newest turns first, so
 * a client cannot hand the model fabricated tool results: figures are always
 * re-read by a tool. The newest message must be the user's.
 */
export function conversationForModel(messages: z.infer<typeof AssistantRequest>["messages"]): Omit<UIMessage, "id">[] | null {
  const cleaned = messages.flatMap((message) => {
    const text = message.parts
      .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim()
      .slice(0, ASSISTANT_LIMITS.textChars);
    return text ? [{ role: message.role, parts: [{ type: "text" as const, text }] }] : [];
  }).slice(-ASSISTANT_LIMITS.messages);
  if (cleaned.at(-1)?.role !== "user") return null;
  // A conversation sent to the model starts with the user.
  while (cleaned.length && cleaned[0].role !== "user") cleaned.shift();
  return cleaned;
}
