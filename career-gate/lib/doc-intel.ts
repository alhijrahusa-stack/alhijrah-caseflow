import "server-only";
import { z } from "zod";
import { sql } from "@/lib/db";
import { registry } from "@/lib/providers/config";
import { geminiExtract } from "@/lib/providers/gemini";
import { needsHuman, reconcileDob, reconcileName, type Recon } from "@/lib/reconcile";
import { logActivity } from "@/lib/service";
import { downloadObject } from "@/lib/storage";

// Pipeline: stored original (immutable, hashed) → quality (at upload) →
// classification + structured extraction (fast model) → Zod validation →
// deterministic reconciliation → escalation model when needed → human review.
// AI never sets a document to verified and never edits the client record.

const DOC_CLASSES = ["photo_id", "work_authorization", "social_security_card", "resume", "other", "unreadable"] as const;
const FIELD_NAMES = ["full_name", "given_name", "family_name", "date_of_birth", "expiration_date", "document_number_last4"] as const;

export const ExtractionSchema = z.object({
  document_class: z.enum(DOC_CLASSES),
  readable: z.boolean(),
  fields: z
    .array(
      z.object({
        field_name: z.enum(FIELD_NAMES),
        raw_value: z.string().max(200).nullable(),
        normalized_value: z.string().max(200).nullable(),
        source_page: z.number().int().min(1).max(50).nullable(),
        legible: z.boolean(),
      }),
    )
    .max(20),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

// Gemini responseSchema (OpenAPI subset) mirroring ExtractionSchema.
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    document_class: { type: "STRING", enum: [...DOC_CLASSES] },
    readable: { type: "BOOLEAN" },
    fields: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          field_name: { type: "STRING", enum: [...FIELD_NAMES] },
          raw_value: { type: "STRING", nullable: true },
          normalized_value: { type: "STRING", nullable: true },
          source_page: { type: "INTEGER", nullable: true },
          legible: { type: "BOOLEAN" },
        },
        required: ["field_name", "raw_value", "normalized_value", "source_page", "legible"],
      },
    },
  },
  required: ["document_class", "readable", "fields"],
};

const PROMPT = `Classify this document and extract only these fields when present: full_name, given_name, family_name, date_of_birth, expiration_date, document_number_last4.
Rules:
- Copy values exactly as printed into raw_value. Put a normalized form in normalized_value (dates as YYYY-MM-DD, names as printed without extra spaces).
- For any document or identity number return ONLY the last 4 characters in document_number_last4. Never return a full Social Security number, A-number or document number.
- If a field is not present, omit it. If it is present but not legible, set legible=false and raw_value=null.
- Set readable=false if the document cannot be read reliably.`;

/** Material fields per declared type: what must be legible for review to proceed. */
const MATERIAL: Record<string, string[]> = {
  photo_id: ["full_name", "date_of_birth"],
  work_authorization: ["full_name", "date_of_birth"],
  social_security_card: ["full_name"],
  resume: ["full_name"],
  other: [],
};

/** Rejects outputs carrying anything that looks like a full SSN or long identifier. */
function containsSensitive(x: Extraction) {
  return x.fields.some((f) => [f.raw_value, f.normalized_value].some((v) => v && /\d{3}-?\d{2}-?\d{4}|[A-Za-z]?\d{8,}/.test(v)));
}

export function parseExtraction(text: string): { ok: true; value: Extraction } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid JSON" };
  }
  const r = ExtractionSchema.safeParse(json);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "schema invalid" };
  if (containsSensitive(r.data)) return { ok: false, error: "output contained a full identifier" };
  return { ok: true, value: r.data };
}

const field = (x: Extraction, name: string) => x.fields.find((f) => f.field_name === name);

export function assessExtraction(x: Extraction, declaredType: string, record: { full_name: string; date_of_birth: string | null }) {
  const material = MATERIAL[declaredType] ?? [];
  const missing = material.filter((m) => {
    const f = m === "full_name" ? field(x, "full_name") ?? field(x, "family_name") : field(x, m);
    return !f || !f.legible || !(f.normalized_value ?? f.raw_value);
  });
  const fullName =
    field(x, "full_name")?.normalized_value ??
    ([field(x, "given_name")?.normalized_value, field(x, "family_name")?.normalized_value].filter(Boolean).join(" ") || null);
  const recon: Recon[] = [];
  if (material.includes("full_name")) recon.push(reconcileName(record.full_name, fullName));
  if (material.includes("date_of_birth")) recon.push(reconcileDob(record.date_of_birth, field(x, "date_of_birth")?.normalized_value ?? field(x, "date_of_birth")?.raw_value ?? null));
  // Internal inconsistency: full name disagrees with given + family.
  const given = field(x, "given_name")?.normalized_value;
  const family = field(x, "family_name")?.normalized_value;
  const inconsistent = Boolean(field(x, "full_name")?.normalized_value && given && family && reconcileName(`${given} ${family}`, field(x, "full_name")!.normalized_value).state === "MISMATCH");
  const classMismatch = x.document_class !== declaredType && declaredType !== "other";
  return { missing, recon, inconsistent, classMismatch, unreadable: !x.readable };
}

type Attempt = { model: "fast" | "escalation"; provider_model: string | null; status: "succeeded" | "schema_invalid" | "failed" | "not_configured"; extraction?: Extraction; error?: string; ms: number };

/**
 * Runs extraction for one document. Final state is needs_review or
 * needs_reupload — never verified.
 */
export async function processDocument(documentId: string, traceId: string) {
  const db = sql();
  const [doc] = await db`
    select d.*, c.full_name, c.date_of_birth from documents d join clients c on c.id = d.client_id where d.id = ${documentId}`;
  if (!doc) return { status: "missing" as const };
  if (["verified", "rejected"].includes(doc.status)) return { status: "already_final" as const };

  await db`update documents set status = 'processing' where id = ${documentId}`;
  await logActivity(db, { clientId: doc.client_id, action: "document_processing_started", actor: { staffId: null, traceId }, entityType: "document", entityId: documentId });

  const record = { full_name: doc.full_name as string, date_of_birth: doc.date_of_birth as string | null };
  const attempts: Attempt[] = [];
  let bytes: Uint8Array | null = null;

  const run = async (model: "fast" | "escalation") => {
    const t0 = performance.now();
    const cfg = registry.documentVision();
    if (!cfg.apiKey || !(model === "fast" ? cfg.fastModel : cfg.escalationModel)) {
      // Nothing is downloaded or sent anywhere when the provider is not configured.
      const a: Attempt = { model, provider_model: null, status: "not_configured", error: "Document vision is NOT_CONFIGURED", ms: 0 };
      attempts.push(a);
      return a;
    }
    bytes ??= await downloadObject(doc.storage_path);
    let res = await geminiExtract({ model, mimeType: doc.mime_type, data: bytes, prompt: PROMPT, responseSchema: RESPONSE_SCHEMA });
    if (!res.ok) {
      const a: Attempt = { model, provider_model: res.model, status: res.code === "NOT_CONFIGURED" ? "not_configured" : "failed", error: res.message, ms: Math.round(performance.now() - t0) };
      attempts.push(a);
      return a;
    }
    let parsed = parseExtraction(res.text);
    if (!parsed.ok) {
      // One controlled retry for invalid output.
      res = await geminiExtract({ model, mimeType: doc.mime_type, data: bytes, prompt: PROMPT, responseSchema: RESPONSE_SCHEMA });
      parsed = res.ok ? parseExtraction(res.text) : { ok: false, error: res.message };
    }
    const a: Attempt = parsed.ok
      ? { model, provider_model: res.model, status: "succeeded", extraction: parsed.value, ms: Math.round(performance.now() - t0) }
      : { model, provider_model: res.model, status: "schema_invalid", error: parsed.error, ms: Math.round(performance.now() - t0) };
    attempts.push(a);
    return a;
  };

  let final = await run("fast");
  let assessment = final.extraction ? assessExtraction(final.extraction, doc.doc_type, record) : null;
  const shouldEscalate =
    final.status === "schema_invalid" ||
    (final.status === "succeeded" && assessment && (assessment.missing.length > 0 || assessment.inconsistent || assessment.unreadable || needsHuman(assessment.recon)));
  if (shouldEscalate) {
    const esc = await run("escalation");
    if (esc.status === "succeeded" || final.status !== "succeeded") {
      final = esc;
      assessment = esc.extraction ? assessExtraction(esc.extraction, doc.doc_type, record) : assessment;
    }
  }

  for (const a of attempts) {
    await db`
      insert into document_extractions (document_id, client_id, provider, model, status, escalated, document_class,
        fields, reconciliation, error, trace_id, duration_ms)
      values (${documentId}, ${doc.client_id}, 'google_gemini', ${a.provider_model}, ${a.status}, ${a.model === "escalation"},
        ${a.extraction?.document_class ?? null},
        ${db.json(((a.extraction?.fields ?? []).map((f) => ({ ...f, provider: "google_gemini", model: a.provider_model, review_state: "unreviewed" }))) as never)},
        ${db.json((a === final && assessment ? assessment.recon : []) as never)},
        ${a.error ?? null}, ${traceId}, ${a.ms})`;
  }

  const notConfigured = attempts.every((a) => a.status === "not_configured");
  const unreadable =
    final.status === "succeeded" && assessment && (assessment.unreadable || assessment.missing.length > 0) && (MATERIAL[doc.doc_type] ?? []).length > 0;
  const nextStatus = unreadable ? "needs_reupload" : "needs_review";
  await db`update documents set status = ${nextStatus} where id = ${documentId} and status = 'processing'`;
  await logActivity(db, {
    clientId: doc.client_id, action: "document_processed", actor: { staffId: null, traceId }, entityType: "document", entityId: documentId,
    newValue: {
      extraction: notConfigured ? "NOT_CONFIGURED" : final.status,
      model: final.provider_model,
      escalated: attempts.some((a) => a.model === "escalation"),
      reconciliation: assessment?.recon.map((r) => `${r.field}:${r.state}`) ?? [],
      result: nextStatus,
    },
  });
  return { status: notConfigured ? ("not_configured" as const) : ("processed" as const), result: nextStatus };
}
