import "server-only";
import { z } from "zod";
import { geminiExtract } from "@/lib/providers/gemini";
import { ActionError } from "@/lib/service";
import { normalizeSmartDate } from "@/lib/smart-client-fields";
import { parseMrz, type MrzResult } from "@/lib/mrz";
import type { IntakeRow } from "@/lib/intake-file";

const MAX_GOOGLE_SHEET_BYTES = 10 * 1024 * 1024;

const OCR_FIELDS = [
  "full_name",
  "first_name",
  "middle_name",
  "last_name",
  "phone",
  "email",
  "date_of_birth",
  "preferred_language",
  "english_proficiency",
  "street",
  "city",
  "state",
  "zip",
  "appointment_availability",
  "amazon_worked_before",
  "amazon_worked_from",
  "amazon_worked_to",
  "amazon_applied_before",
  "amazon_application_email",
  "currently_amazon",
  "via_agency",
  "employment_kind",
  "company",
  "job_title",
  "employment_from",
  "employment_to",
  "site_code",
  "job_id",
  "shift_code",
  "shift_days",
  "shift_start_time",
  "shift_end_time",
  "alt_site_code",
  "backup_site_code",
  "backup_job_id",
  "backup_shift_code",
  "additional_notes",
] as const;

/**
 * What the document itself is, as opposed to what it says about the applicant.
 *
 * The classification is read in the same call as the fields: a separate round trip
 * to decide a strategy would cost more latency than it saves, and the model already
 * has the page in front of it. It is evidence for the reviewer and for storage — it
 * is never auto-filled into a client field, and the document number is deliberately
 * absent from this schema so it is never extracted at all.
 */
const DOCUMENT_CLASS_SCHEMA = {
  type: "OBJECT",
  nullable: true,
  properties: {
    document_type: { type: "STRING", nullable: true },
    issuing_authority: { type: "STRING", nullable: true },
    expiration_date: { type: "STRING", nullable: true },
    side: { type: "STRING", nullable: true },
    legibility: { type: "STRING", nullable: true },
    confidence: { type: "NUMBER", nullable: true },
  },
  required: ["document_type", "issuing_authority", "expiration_date", "side", "legibility", "confidence"],
};

/** The document classes this intake recognizes. Anything else stays OTHER. */
export const DOCUMENT_CLASSES = [
  "DRIVER_LICENSE",
  "STATE_ID",
  "PERMANENT_RESIDENT_CARD",
  "EMPLOYMENT_AUTHORIZATION_DOCUMENT",
  "US_PASSPORT",
  "SOCIAL_SECURITY_CARD",
  "APPLICATION_FORM",
  "RESUME",
  "OTHER",
] as const;
export type DocumentClass = (typeof DOCUMENT_CLASSES)[number];

export type DocumentClassification = {
  document_type: DocumentClass | null;
  issuing_authority: string | null;
  expiration_date: string | null;
  side: "FRONT" | "BACK" | "UNKNOWN" | null;
  legibility: "CLEAR" | "PARTIAL" | "POOR" | null;
  confidence: number | null;
};

const OCR_SCHEMA = {
  type: "OBJECT",
  properties: {
    document: DOCUMENT_CLASS_SCHEMA,
    mrz_lines: { type: "ARRAY", nullable: true, items: { type: "STRING" } },
    clients: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          ...Object.fromEntries(OCR_FIELDS.map((field) => [field, { type: "STRING", nullable: true }])),
          confidence: {
            type: "OBJECT",
            properties: Object.fromEntries(OCR_FIELDS.map((field) => [field, { type: "NUMBER", nullable: true }])),
            required: [...OCR_FIELDS],
          },
        },
        required: [...OCR_FIELDS, "confidence"],
      },
    },
  },
  required: ["clients"],
};

const clientShape = Object.fromEntries(
  OCR_FIELDS.map((field) => [field, z.string().nullable()]),
) as unknown as Record<(typeof OCR_FIELDS)[number], z.ZodTypeAny>;
const ConfidenceResult = z.object(Object.fromEntries(
  OCR_FIELDS.map((field) => [field, z.number().min(0).max(1).nullable()]),
) as unknown as Record<(typeof OCR_FIELDS)[number], z.ZodTypeAny>);
const ClientResult = z.object({ ...clientShape, confidence: ConfidenceResult });
const DocumentClassResult = z.object({
  document_type: z.string().nullable(),
  issuing_authority: z.string().nullable(),
  expiration_date: z.string().nullable(),
  side: z.string().nullable(),
  legibility: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
}).partial().nullable().optional();
const OcrResult = z.object({
  clients: z.array(ClientResult).max(100),
  document: DocumentClassResult,
  mrz_lines: z.array(z.string().max(60)).max(4).nullable().optional(),
});

export type DocumentExtraction = {
  row: IntakeRow;
  confidence: Partial<Record<(typeof OCR_FIELDS)[number], number>>;
};

const OCR_PROMPT = `Extract client application facts from this source into the provided schema.
Use only facts explicitly supported by the source. Never infer, guess, repair, translate into an unsupported fact, or complete missing information.
Return null for anything not explicitly present.
One identifiable client equals one clients item.
Dates must be YYYY-MM-DD only when the exact date is supported.
Boolean-like fields must be returned as the visible source answer text (for example Yes/No), not inferred.
For Amazon assignment fields, return site_code, job_id, shift_code and backup_* codes only when those exact codes are present. A desired shift written only as free text must stay in shift_code only when it is clearly the source value; do not invent a catalog code.
Employment fields describe only the explicitly visible employment entry. Do not invent employer history.
For every returned field, also return confidence[field] as a number from 0 to 1 reflecting only how clearly the source itself supports the extracted value. Use null when the field is absent. Confidence is review telemetry, never canonical truth.
Also classify the document itself in the document object.
document_type must be exactly one of DRIVER_LICENSE, STATE_ID, PERMANENT_RESIDENT_CARD, EMPLOYMENT_AUTHORIZATION_DOCUMENT, US_PASSPORT, SOCIAL_SECURITY_CARD, APPLICATION_FORM, RESUME, OTHER. Use OTHER when the document is not clearly one of the others; never guess between two classes.
side must be FRONT, BACK or UNKNOWN. legibility must be CLEAR, PARTIAL or POOR and describes only how readable the source image is.
expiration_date and issuing_authority come from the document only when printed on it.
Never return a document number, a social security number or any identifier not requested by this schema, in any field.
If the document carries a machine readable zone, return its lines verbatim in mrz_lines, exactly as printed, character for character, including every < filler. Do not interpret, reorder, validate or correct them. Return null when there is no machine readable zone.
The output is staging evidence for human review, not canonical truth.`;

/** The confidence below which a field is worth a second, stronger read. */
export const ESCALATION_CONFIDENCE_FLOOR = 0.85;

/** Fields worth escalating a whole document for when the fast read is weak. */
const ESCALATION_TRIGGER_FIELDS = ["full_name", "date_of_birth", "street", "city", "state", "zip", "phone"] as const;

export type ExtractionStage = {
  stage: "fast" | "escalation";
  model: string | null;
  ok: boolean;
  /** Provider failure class, or null on success. Never the provider's raw text. */
  code: "NOT_CONFIGURED" | "PROVIDER_ERROR" | "TIMEOUT" | "INVALID_JSON" | "SCHEMA_REJECTED" | null;
  duration_ms: number;
  fields_read: number;
};

export type DocumentIntelligence = {
  rows: DocumentExtraction[];
  classification: DocumentClassification | null;
  /**
   * The machine readable zone, parsed and check-digit verified in this process.
   * Null when the document has no band or the band could not be read as one.
   */
  mrz: MrzResult | null;
  stages: ExtractionStage[];
  /** True when the escalation stage ran because the fast read was not good enough. */
  escalated: boolean;
  duration_ms: number;
};

function normalizeClass(value: string | null | undefined): DocumentClass | null {
  const raw = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return (DOCUMENT_CLASSES as readonly string[]).includes(raw) ? (raw as DocumentClass) : raw ? "OTHER" : null;
}

function enumOf<T extends string>(value: string | null | undefined, allowed: readonly T[]): T | null {
  const raw = String(value ?? "").trim().toUpperCase();
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

/** Exported for test: the classification read, with no provider involved. */
export function readDocumentClassification(value: unknown): DocumentClassification | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const text = (key: string) => {
    const item = raw[key];
    return typeof item === "string" && item.trim() ? item.trim().slice(0, 120) : null;
  };
  const confidence = typeof raw.confidence === "number" && raw.confidence >= 0 && raw.confidence <= 1 ? raw.confidence : null;
  const classification: DocumentClassification = {
    document_type: normalizeClass(text("document_type")),
    issuing_authority: text("issuing_authority"),
    // A printed expiry is only kept when it is a real calendar date.
    expiration_date: normalizeSmartDate(text("expiration_date")),
    side: enumOf(text("side"), ["FRONT", "BACK", "UNKNOWN"] as const),
    legibility: enumOf(text("legibility"), ["CLEAR", "PARTIAL", "POOR"] as const),
    confidence,
  };
  const stated = Object.values(classification).some((item) => item !== null);
  return stated ? classification : null;
}

/** How many of the fields that matter the read actually produced with confidence. */
/** Exported for test: whether a read is weak enough to deserve a second one. */
export function readStrength(rows: DocumentExtraction[]) {
  if (rows.length !== 1) return { weak: rows.length === 0, read: 0 };
  const [only] = rows;
  let read = 0;
  let weak = false;
  for (const field of ESCALATION_TRIGGER_FIELDS) {
    const value = only.row[field];
    if (typeof value !== "string" || !value.trim()) continue;
    read += 1;
    const confidence = only.confidence[field];
    if (typeof confidence !== "number" || confidence < ESCALATION_CONFIDENCE_FLOOR) weak = true;
  }
  // Nothing read at all from a document is also a weak read.
  return { weak: weak || read === 0, read };
}

/**
 * Merges a stronger second read into the first, field by field.
 *
 * The higher-confidence value wins per field; a value only one stage produced is
 * kept; and a tie keeps the first read rather than churning. Nothing is invented,
 * and the two reads are never spliced across different people — a disagreement on
 * identity returns both rows so the merge layer above quarantines the document.
 */
/**
 * The glyph confusions a second read exists to correct.
 *
 * A stronger model reading "AHMED M0HAMMED" as "Ahmed Mohammed" has corrected the
 * same name, not found a different person. Collapsing exactly these substitutions
 * lets the correction through while a genuinely different name still reads as
 * different. This is a fixed, enumerated mapping — never fuzzy matching, and never
 * applied to a value that is stored: it is used only to decide whether two reads are
 * about the same person.
 */
const GLYPH_CONFUSIONS: Record<string, string> = {
  "0": "o", "1": "i", "5": "s", "8": "b", "2": "z", "6": "g", l: "i", q: "g",
};

function identityKey(entry: DocumentExtraction) {
  const raw = String(entry.row.full_name ?? "").trim().toLowerCase();
  if (!raw) return "";
  return raw
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/./gu, (char) => GLYPH_CONFUSIONS[char] ?? char)
    .replace(/\s+/g, " ");
}

/** Exported for test: the per-field merge of a stronger read into a first one. */
export function mergeDocumentStages(fast: DocumentExtraction[], escalated: DocumentExtraction[]): DocumentExtraction[] {
  if (fast.length !== 1 || escalated.length !== 1) return escalated.length ? escalated : fast;
  const [a] = fast;
  const [b] = escalated;
  const left = identityKey(a);
  const right = identityKey(b);
  if (left && right && left !== right) return [a, b];

  const row: IntakeRow = { ...a.row };
  const confidence: DocumentExtraction["confidence"] = { ...a.confidence };
  for (const field of OCR_FIELDS) {
    const left = typeof a.row[field] === "string" && String(a.row[field]).trim() ? String(a.row[field]) : null;
    const right = typeof b.row[field] === "string" && String(b.row[field]).trim() ? String(b.row[field]) : null;
    if (!right) continue;
    if (!left) {
      row[field] = right;
      if (typeof b.confidence[field] === "number") confidence[field] = b.confidence[field];
      continue;
    }
    const leftScore = typeof a.confidence[field] === "number" ? a.confidence[field]! : -1;
    const rightScore = typeof b.confidence[field] === "number" ? b.confidence[field]! : -1;
    if (rightScore > leftScore) {
      row[field] = right;
      confidence[field] = b.confidence[field]!;
    }
  }
  return [{ row, confidence }];
}

function parseStage(text: string) {
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { code: "INVALID_JSON" as const, rows: null, classification: null }; }
  const parsed = OcrResult.safeParse(json);
  if (!parsed.success) return { code: "SCHEMA_REJECTED" as const, rows: null, classification: null, mrz: null };
  return {
    code: null,
    rows: parsed.data.clients.map((client) => ({
      row: Object.fromEntries(OCR_FIELDS.map((field) => [field, client[field] ?? null])) as IntakeRow,
      confidence: Object.fromEntries(
        OCR_FIELDS.flatMap((field) => typeof client.confidence[field] === "number" ? [[field, client.confidence[field]]] : []),
      ) as DocumentExtraction["confidence"],
    })),
    classification: readDocumentClassification(parsed.data.document),
    mrz: parseMrz((parsed.data.mrz_lines ?? []).join("\n")),
  };
}

/**
 * Overlays a verified machine readable zone onto the model's reading.
 *
 * Only fields the band's own check digits cover are overlaid, and only when the
 * composite check verifies too. The name is taken from the band because the band is
 * the document's own canonical spelling of it — but it is not listed as check-digit
 * verified, because no check digit covers it.
 *
 * A document with more than one applicant is left alone: an MRZ belongs to one
 * person, and splicing it onto an ambiguous read is exactly the mistake to avoid.
 */
function applyMrz(rows: DocumentExtraction[], mrz: MrzResult): DocumentExtraction[] {
  if (rows.length !== 1) return rows;
  const [only] = rows;
  const row: IntakeRow = { ...only.row };
  const confidence = { ...only.confidence };

  if (mrz.full_name) {
    row.full_name = mrz.full_name;
    row.first_name = mrz.given_names.split(" ")[0] || null;
    row.middle_name = mrz.given_names.split(" ").slice(1).join(" ") || null;
    row.last_name = mrz.surname || null;
  }
  if (mrz.verified_fields.includes("date_of_birth") && mrz.date_of_birth) {
    row.date_of_birth = mrz.date_of_birth;
    // 1 is not a calibrated probability; it records that arithmetic, not a model,
    // established this value.
    confidence.date_of_birth = 1;
  }
  return [{ row, confidence }];
}

/**
 * Classify and extract one document.
 *
 * The fast model runs first. The stronger model runs only when the fast read left a
 * field that matters missing or below the confidence floor — so the common case costs
 * one call, and a difficult scan still gets a second opinion without the reviewer
 * asking for one. Both reads are then merged per field by confidence.
 *
 * A provider that is not configured is reported as such and never silently treated
 * as an empty document.
 */
export async function classifyAndExtractDocument(bytes: Uint8Array, mimeType: string): Promise<DocumentIntelligence> {
  const startedAt = Date.now();
  const stages: ExtractionStage[] = [];
  let best: DocumentExtraction[] | null = null;
  let classification: DocumentClassification | null = null;
  let mrz: MrzResult | null = null;
  let lastMessage = "Document extraction failed";
  let notConfigured = false;

  for (const stage of ["fast", "escalation"] as const) {
    // The second stage is only paid for when the first one was not good enough.
    if (stage === "escalation" && best && !readStrength(best).weak) break;

    const stageStart = Date.now();
    const result = await geminiExtract({
      model: stage,
      mimeType,
      data: bytes,
      prompt: OCR_PROMPT,
      responseSchema: OCR_SCHEMA,
      timeoutMs: stage === "fast" ? 18_000 : 22_000,
    });
    if (!result.ok) {
      stages.push({ stage, model: result.model, ok: false, code: result.code, duration_ms: Date.now() - stageStart, fields_read: 0 });
      lastMessage = result.message;
      if (result.code === "NOT_CONFIGURED") { notConfigured = true; break; }
      continue;
    }
    const parsed = parseStage(result.text);
    if (!parsed.rows) {
      stages.push({ stage, model: result.model, ok: false, code: parsed.code, duration_ms: Date.now() - stageStart, fields_read: 0 });
      lastMessage = parsed.code === "INVALID_JSON" ? "OCR provider returned invalid JSON" : "OCR output failed validation";
      continue;
    }
    classification = parsed.classification ?? classification;
    // A band that verifies is kept over one that does not, whichever stage read it.
    if (parsed.mrz && (!mrz || (parsed.mrz.verified && !mrz.verified))) mrz = parsed.mrz;
    best = best ? mergeDocumentStages(best, parsed.rows) : parsed.rows;
    stages.push({ stage, model: result.model, ok: true, code: null, duration_ms: Date.now() - stageStart, fields_read: readStrength(parsed.rows).read });
  }

  if (notConfigured) throw new ActionError("ocr_not_configured", lastMessage, 503);
  if (!best) throw new ActionError("ocr_failed", lastMessage, 422);
  return {
    // A check digit is arithmetic, not a probability: where the band verifies, its
    // fields replace the model's reading of the same fields outright.
    rows: mrz?.verified ? applyMrz(best, mrz) : best,
    classification,
    mrz,
    stages,
    escalated: stages.some((item) => item.stage === "escalation" && item.ok),
    duration_ms: Date.now() - startedAt,
  };
}

export async function rowsFromImageOrPdfDetailed(bytes: Uint8Array, mimeType: string): Promise<DocumentExtraction[]> {
  let lastMessage = "Document extraction failed";
  for (const model of ["fast", "escalation"] as const) {
    const result = await geminiExtract({ model, mimeType, data: bytes, prompt: OCR_PROMPT, responseSchema: OCR_SCHEMA, timeoutMs: model === "fast" ? 18_000 : 22_000 });
    if (!result.ok) {
      lastMessage = result.message;
      if (result.code === "NOT_CONFIGURED") throw new ActionError("ocr_not_configured", result.message, 503);
      continue;
    }
    let json: unknown;
    try { json = JSON.parse(result.text); } catch { lastMessage = "OCR provider returned invalid JSON"; continue; }
    const parsed = OcrResult.safeParse(json);
    if (!parsed.success) { lastMessage = parsed.error.issues[0]?.message ?? "OCR output failed validation"; continue; }
    return parsed.data.clients.map((client) => ({
      row: Object.fromEntries(OCR_FIELDS.map((field) => [field, client[field] ?? null])) as IntakeRow,
      confidence: Object.fromEntries(
        OCR_FIELDS.flatMap((field) => typeof client.confidence[field] === "number" ? [[field, client.confidence[field]]] : []),
      ) as Partial<Record<(typeof OCR_FIELDS)[number], number>>,
    }));
  }
  throw new ActionError("ocr_failed", lastMessage, 422);
}

export async function rowsFromImageOrPdf(bytes: Uint8Array, mimeType: string) {
  return (await rowsFromImageOrPdfDetailed(bytes, mimeType)).map((item) => item.row);
}

export function googleSheetCsvUrl(input: string) {
  let url: URL;
  try { url = new URL(input); } catch { throw new ActionError("invalid_sheet_url", "Invalid Google Sheets URL", 400); }
  if (url.hostname !== "docs.google.com") throw new ActionError("invalid_sheet_url", "Only docs.google.com Google Sheets URLs are accepted", 400);
  const match = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (!match) throw new ActionError("invalid_sheet_url", "Google Sheets document ID is missing", 400);
  const gid = url.searchParams.get("gid") ?? url.hash.match(/gid=(\d+)/)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${encodeURIComponent(gid)}`;
}

export async function fetchGoogleSheet(input: string) {
  const url = googleSheetCsvUrl(input);
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) throw new ActionError("sheet_unavailable", "Google Sheet must be accessible with the provided link", 422);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_GOOGLE_SHEET_BYTES) throw new ActionError("sheet_too_large", "Google Sheet exceeds the 10 MB import limit", 413);
  const text = await res.text();
  if (Buffer.byteLength(text, "utf8") > MAX_GOOGLE_SHEET_BYTES) throw new ActionError("sheet_too_large", "Google Sheet exceeds the 10 MB import limit", 413);
  return text;
}
