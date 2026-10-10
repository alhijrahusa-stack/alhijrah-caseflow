import "server-only";
import { z } from "zod";
import { geminiExtract } from "@/lib/providers/gemini";
import { ActionError } from "@/lib/service";
import type { IntakeRow } from "@/lib/intake-file";

const MAX_GOOGLE_SHEET_BYTES = 10 * 1024 * 1024;

const OCR_FIELDS = [
  "full_name",
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
  "backup_site_code",
  "backup_job_id",
  "backup_shift_code",
] as const;

const OCR_SCHEMA = {
  type: "OBJECT",
  properties: {
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
) as Record<(typeof OCR_FIELDS)[number], z.ZodTypeAny>);
const ClientResult = z.object({ ...clientShape, confidence: ConfidenceResult });
const OcrResult = z.object({ clients: z.array(ClientResult).max(100) });

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
The output is staging evidence for human review, not canonical truth.`;

export async function rowsFromImageOrPdfDetailed(bytes: Uint8Array, mimeType: string): Promise<DocumentExtraction[]> {
  let lastMessage = "Document extraction failed";
  for (const model of ["fast", "escalation"] as const) {
    const result = await geminiExtract({ model, mimeType, data: bytes, prompt: OCR_PROMPT, responseSchema: OCR_SCHEMA });
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
