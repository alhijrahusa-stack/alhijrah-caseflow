import "server-only";
import { z } from "zod";
import { geminiExtract } from "@/lib/providers/gemini";
import { ActionError } from "@/lib/service";
import type { IntakeRow } from "@/lib/intake-file";

const MAX_GOOGLE_SHEET_BYTES = 10 * 1024 * 1024;

const OCR_SCHEMA = {
  type: "OBJECT",
  properties: {
    clients: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          full_name: { type: "STRING", nullable: true },
          phone: { type: "STRING", nullable: true },
          email: { type: "STRING", nullable: true },
          date_of_birth: { type: "STRING", nullable: true },
          preferred_language: { type: "STRING", nullable: true },
          street: { type: "STRING", nullable: true },
          city: { type: "STRING", nullable: true },
          state: { type: "STRING", nullable: true },
          zip: { type: "STRING", nullable: true },
          site_code: { type: "STRING", nullable: true },
          job_id: { type: "STRING", nullable: true },
          shift_code: { type: "STRING", nullable: true },
        },
        required: ["full_name", "phone", "email", "date_of_birth", "preferred_language", "street", "city", "state", "zip", "site_code", "job_id", "shift_code"],
      },
    },
  },
  required: ["clients"],
};

const OcrResult = z.object({
  clients: z.array(z.object({
    full_name: z.string().nullable(), phone: z.string().nullable(), email: z.string().nullable(), date_of_birth: z.string().nullable(),
    preferred_language: z.string().nullable(), street: z.string().nullable(), city: z.string().nullable(), state: z.string().nullable(),
    zip: z.string().nullable(), site_code: z.string().nullable(), job_id: z.string().nullable(), shift_code: z.string().nullable(),
  })).max(100),
});

const OCR_PROMPT = `Extract client application facts from this source. Return only values explicitly supported by the source. Do not infer, repair, guess, or complete missing data. One identifiable client equals one clients item. Dates must be YYYY-MM-DD only when the exact date is supported. For Amazon assignment fields, return site_code, job_id, and shift_code only when those exact codes are present. Otherwise return null.`;

export async function rowsFromImageOrPdf(bytes: Uint8Array, mimeType: string) {
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
      full_name: client.full_name,
      phone: client.phone,
      email: client.email,
      date_of_birth: client.date_of_birth,
      preferred_language: client.preferred_language,
      street: client.street,
      city: client.city,
      state: client.state,
      zip: client.zip,
      site_code: client.site_code,
      job_id: client.job_id,
      shift_code: client.shift_code,
    })) satisfies IntakeRow[];
  }
  throw new ActionError("ocr_failed", lastMessage, 422);
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
