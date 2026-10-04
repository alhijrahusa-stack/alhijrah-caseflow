import "server-only";
import { z } from "zod";
import { geminiExtract } from "@/lib/providers/gemini";
import { visionJson } from "@/lib/providers/openai";
import { ActionError } from "@/lib/service";
import type { IntakeRow } from "@/lib/intake-file";

const MAX_GOOGLE_SHEET_BYTES = 10 * 1024 * 1024;
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 15 * 60 * 1000;

const OCR_FIELDS = [
  "full_name",
  "phone",
  "email",
  "date_of_birth",
  "preferred_language",
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
  "backup_site_code",
  "backup_job_id",
  "backup_shift_code",
] as const;

const OCR_SCHEMA = {
  type: "object",
  properties: {
    clients: {
      type: "array",
      items: {
        type: "object",
        properties: Object.fromEntries(OCR_FIELDS.map((field) => [field, { type: ["string", "null"] }])),
        required: [...OCR_FIELDS],
        additionalProperties: false,
      },
      maxItems: 100,
    },
  },
  required: ["clients"],
  additionalProperties: false,
};

const GEMINI_OCR_SCHEMA = {
  type: "OBJECT",
  properties: {
    clients: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: Object.fromEntries(OCR_FIELDS.map((field) => [field, { type: "STRING", nullable: true }])),
        required: [...OCR_FIELDS],
      },
    },
  },
  required: ["clients"],
};

const clientShape = Object.fromEntries(
  OCR_FIELDS.map((field) => [field, z.string().nullable()]),
) as unknown as Record<(typeof OCR_FIELDS)[number], z.ZodTypeAny>;
const ClientResult = z.object(clientShape);
const OcrResult = z.object({ clients: z.array(ClientResult).max(100) });

const OCR_PROMPT = `Extract client application facts from this source into the provided schema.
Use only facts explicitly supported by the source. Never infer, guess, repair, translate into an unsupported fact, or complete missing information.
Return null for anything not explicitly present.
One identifiable client equals one clients item.
Dates must be YYYY-MM-DD only when the exact date is supported.
Boolean-like fields must be returned as the visible source answer text (for example Yes/No), not inferred.
For Amazon assignment fields, return site_code, job_id, shift_code and backup_* codes only when those exact codes are present. A desired shift written only as free text must stay in shift_code only when it is clearly the source value; do not invent a catalog code.
Employment fields describe only the explicitly visible employment entry. Do not invent employer history.
The output is staging evidence for human review, not canonical truth.`;

type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";
type Attempt = {
  provider: "gemini" | "openai";
  variant: string;
  model: string | null;
  result: "SUCCESS" | "FAILED" | "NOT_CONFIGURED" | "SKIPPED";
  code: string | null;
  duration_ms: number;
};

type ProviderDeps = {
  gemini: typeof geminiExtract;
  openai: typeof visionJson;
  now: () => number;
};

let geminiFailures = 0;
let geminiOpenedAt = 0;

function breakerState(now = Date.now()): BreakerState {
  if (!geminiOpenedAt) return "CLOSED";
  if (now - geminiOpenedAt >= BREAKER_COOLDOWN_MS) return "HALF_OPEN";
  return "OPEN";
}

function markGeminiSuccess() {
  geminiFailures = 0;
  geminiOpenedAt = 0;
}

function markGeminiFailure(now = Date.now()) {
  geminiFailures += 1;
  if (geminiFailures >= BREAKER_THRESHOLD && !geminiOpenedAt) geminiOpenedAt = now;
}

export function documentVisionCircuitState() {
  return { state: breakerState(), consecutive_failures: geminiFailures, opened_at: geminiOpenedAt || null };
}

export function resetDocumentVisionCircuitForTest() {
  geminiFailures = 0;
  geminiOpenedAt = 0;
}

function parseRows(text: string) {
  let json: unknown;
  try { json = JSON.parse(text); }
  catch { throw new Error("OCR provider returned invalid JSON"); }
  const parsed = OcrResult.safeParse(json);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "OCR output failed validation");
  return parsed.data.clients.map((client) => Object.fromEntries(
    OCR_FIELDS.map((field) => [field, client[field] ?? null]),
  ) as IntakeRow);
}

export async function rowsFromImageOrPdfDetailed(
  bytes: Uint8Array,
  mimeType: string,
  deps: ProviderDeps = { gemini: geminiExtract, openai: visionJson, now: () => Date.now() },
) {
  const attempts: Attempt[] = [];
  const startedState = breakerState(deps.now());
  let lastMessage = "Document extraction failed";
  let geminiFailedThisRequest = false;

  if (startedState !== "OPEN") {
    for (const model of ["fast", "escalation"] as const) {
      const t0 = performance.now();
      const result = await deps.gemini({ model, mimeType, data: bytes, prompt: OCR_PROMPT, responseSchema: GEMINI_OCR_SCHEMA });
      if (!result.ok) {
        lastMessage = result.message;
        attempts.push({
          provider: "gemini",
          variant: model,
          model: result.model,
          result: result.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED",
          code: result.code,
          duration_ms: Math.round(performance.now() - t0),
        });
        geminiFailedThisRequest = true;
        continue;
      }
      try {
        const rows = parseRows(result.text);
        attempts.push({ provider: "gemini", variant: model, model: result.model, result: "SUCCESS", code: null, duration_ms: Math.round(performance.now() - t0) });
        markGeminiSuccess();
        return {
          rows,
          telemetry: { provider: "gemini" as const, fallback_used: false, breaker_state: breakerState(deps.now()), attempts },
        };
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : "OCR output failed validation";
        attempts.push({ provider: "gemini", variant: model, model: result.model, result: "FAILED", code: "INVALID_OUTPUT", duration_ms: Math.round(performance.now() - t0) });
        geminiFailedThisRequest = true;
      }
    }
    if (geminiFailedThisRequest) markGeminiFailure(deps.now());
  } else {
    attempts.push({ provider: "gemini", variant: "breaker", model: null, result: "SKIPPED", code: "CIRCUIT_OPEN", duration_ms: 0 });
  }

  const openaiStart = performance.now();
  const fallback = await deps.openai({
    mimeType,
    data: bytes,
    prompt: OCR_PROMPT,
    schemaName: "career_gate_client_document_extraction",
    schema: OCR_SCHEMA,
  });
  if (fallback.ok) {
    try {
      const rows = parseRows(fallback.text);
      attempts.push({ provider: "openai", variant: "fallback", model: fallback.model, result: "SUCCESS", code: null, duration_ms: Math.round(performance.now() - openaiStart) });
      return {
        rows,
        telemetry: { provider: "openai" as const, fallback_used: true, breaker_state: breakerState(deps.now()), attempts },
      };
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : "OpenAI fallback returned invalid output";
      attempts.push({ provider: "openai", variant: "fallback", model: fallback.model, result: "FAILED", code: "INVALID_OUTPUT", duration_ms: Math.round(performance.now() - openaiStart) });
    }
  } else {
    lastMessage = fallback.message || lastMessage;
    attempts.push({
      provider: "openai",
      variant: "fallback",
      model: null,
      result: fallback.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED",
      code: fallback.code,
      duration_ms: Math.round(performance.now() - openaiStart),
    });
  }

  throw Object.assign(new ActionError("ocr_failed", lastMessage, 422), {
    providerTelemetry: { provider: null, fallback_used: true, breaker_state: breakerState(deps.now()), attempts },
  });
}

export async function rowsFromImageOrPdf(bytes: Uint8Array, mimeType: string) {
  const result = await rowsFromImageOrPdfDetailed(bytes, mimeType);
  return result.rows;
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
