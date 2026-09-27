import "server-only";
import { z } from "zod";
import { sha256Hex } from "@/lib/crypto";
import { OFFICE } from "@/lib/office";
import { agentJson } from "@/lib/providers/openai";

// Intake Agent: missing/inconsistent items are detected deterministically.
// The model (when configured) may only rephrase the action and message; it
// cannot add, remove or change findings, and nothing is sent or saved to the
// client record.

export type MissingItem = { code: string; label: string; severity: "required" | "recommended" };
export type IntakeFindings = { missing_items: MissingItem[]; recommended_action: string; message_draft: string };

type ClientLike = Record<string, unknown> & {
  full_name: string;
  email: string | null;
  date_of_birth: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  appointment_availability: string | null;
  amazon_worked_before: boolean | null;
  amazon_worked_from: string | null;
  amazon_worked_to: string | null;
  amazon_applied_before: boolean | null;
  amazon_application_email: string | null;
  currently_amazon: boolean | null;
  via_agency: boolean | null;
};

export function detectMissing(c: ClientLike, ctx: { preferences: number; employment: number; documents: { doc_type: string; status: string }[] }): MissingItem[] {
  const items: MissingItem[] = [];
  const req = (cond: boolean, code: string, label: string) => cond && items.push({ code, label, severity: "required" });
  const rec = (cond: boolean, code: string, label: string) => cond && items.push({ code, label, severity: "recommended" });
  req(!c.date_of_birth, "dob", "Date of birth");
  req(!c.email, "email", "Email address");
  req(!c.street || !c.city || !c.state || !c.zip, "address", "Full address (street, city, state, ZIP)");
  req(!c.appointment_availability, "availability", "Appointment availability");
  req(c.amazon_worked_before === null, "amazon_worked_before", "Whether the client worked at Amazon before");
  req(c.amazon_worked_before === true && (!c.amazon_worked_from || !c.amazon_worked_to), "amazon_dates", "Amazon employment dates");
  req(c.amazon_applied_before === null, "amazon_applied_before", "Whether the client applied to Amazon before");
  req(c.amazon_applied_before === true && !c.amazon_application_email, "amazon_email", "Email used on the previous Amazon application");
  rec(c.currently_amazon === null, "currently_amazon", "Whether the client currently works at Amazon");
  rec(c.via_agency === null, "via_agency", "Whether the client works through a third-party agency");
  rec(ctx.preferences === 0, "preferences", "Job preferences (site, job, shift)");
  rec(ctx.employment === 0, "employment", "Employment history for the last five years (or confirmation of none)");
  const usable = (t: string) => ctx.documents.some((d) => d.doc_type === t && !["rejected", "needs_reupload"].includes(d.status));
  req(!usable("photo_id"), "doc_photo_id", "Photo ID document");
  req(!usable("work_authorization"), "doc_work_authorization", "Work authorization document");
  for (const d of ctx.documents.filter((x) => x.status === "needs_reupload")) items.push({ code: `reupload_${d.doc_type}`, label: `Clearer copy of ${d.doc_type.replace(/_/g, " ")}`, severity: "required" });
  if (c.amazon_worked_from && c.amazon_worked_to && c.amazon_worked_to < c.amazon_worked_from) {
    items.push({ code: "amazon_dates_inconsistent", label: "Amazon end date is before start date", severity: "required" });
  }
  if (c.currently_amazon === true && c.amazon_worked_before === false) {
    items.push({ code: "amazon_current_vs_history", label: "Marked as currently at Amazon but never worked at Amazon", severity: "required" });
  }
  return items;
}

export function deterministicDraft(c: { full_name: string }, items: MissingItem[]): Omit<IntakeFindings, "missing_items"> {
  if (!items.length) return { recommended_action: "No missing intake items detected. Continue the workflow.", message_draft: "" };
  const first = c.full_name.split(" ")[0];
  const required = items.filter((i) => i.severity === "required");
  return {
    recommended_action: required.length ? `Collect: ${required.map((i) => i.label).join("; ")}.` : `Optional: ${items.map((i) => i.label).join("; ")}.`,
    message_draft: [
      `Hello ${first},`,
      `To continue your ${OFFICE.product} request we still need:`,
      ...items.map((i) => `- ${i.label}`),
      `Reply here or call ${OFFICE.phone} (WhatsApp ${OFFICE.whatsapp}).`,
      `${OFFICE.company}`,
    ].join("\n"),
  };
}

const LlmSchema = z.object({ recommended_action: z.string().min(1).max(600), message_draft: z.string().min(1).max(1500) });
const LLM_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { recommended_action: { type: "string" }, message_draft: { type: "string" } },
  required: ["recommended_action", "message_draft"],
};

export async function runIntakeAgent(c: ClientLike, ctx: Parameters<typeof detectMissing>[1]) {
  const missing = detectMissing(c, ctx);
  const base = deterministicDraft(c, missing);
  const input = JSON.stringify({ first_name: c.full_name.split(" ")[0], missing_items: missing.map((m) => m.label), office: { phone: OFFICE.phone, whatsapp: OFFICE.whatsapp, company: OFFICE.company } });
  const inputHash = sha256Hex(input);
  if (!missing.length) return { findings: { missing_items: missing, ...base }, llm: { status: "not_needed" as const }, inputHash };

  const system = "You write short, polite office messages. Use ONLY the missing_items given. Do not add requirements, facts, dates or promises. Output JSON only.";
  let res = await agentJson({ system, input, schemaName: "intake_draft", schema: LLM_JSON_SCHEMA });
  if (!res.ok) {
    return { findings: { missing_items: missing, ...base }, llm: { status: res.code === "NOT_CONFIGURED" ? ("not_configured" as const) : ("failed" as const), error: res.message }, inputHash };
  }
  const parse = (t: string) => { try { return LlmSchema.safeParse(JSON.parse(t)); } catch { return null; } };
  let parsed = parse(res.text);
  if (!parsed?.success) {
    res = await agentJson({ system, input, schemaName: "intake_draft", schema: LLM_JSON_SCHEMA });
    parsed = res.ok ? parse(res.text) : null;
  }
  if (!parsed?.success) {
    return { findings: { missing_items: missing, ...base }, llm: { status: "schema_invalid" as const, model: res.ok ? res.model : null }, inputHash };
  }
  return { findings: { missing_items: missing, ...parsed.data }, llm: { status: "succeeded" as const, model: res.ok ? res.model : null }, inputHash };
}
