import "server-only";
import { ActionError } from "@/lib/service";
import { extractDeterministicClient } from "@/lib/smart-client-local";
import { extractIdentityDocument } from "@/lib/providers/document-intelligence";
import type { DocumentExtraction } from "@/lib/providers/document-intelligence-types";

const MAX_GOOGLE_SHEET_BYTES = 10 * 1024 * 1024;

export type { DocumentExtraction } from "@/lib/providers/document-intelligence-types";

/**
 * Canonical document extraction entry point.
 *
 * Identity documents use Regula Document Reader 9.9 first and Microblink
 * BlinkID Verify 4000.4.0 only as the conditional fallback. Free text remains
 * deterministic and never goes through an identity-document provider.
 */
export async function rowsFromImageOrPdfDetailed(
  bytes: Uint8Array,
  mimeType: string,
  options: {
    filename?: string;
    traceId?: string | null;
    microblinkConsent?: { userId: string; durationDays: number; givenOn?: string } | null;
  } = {},
): Promise<DocumentExtraction[]> {
  if (mimeType === "text/plain") {
    const source = new TextDecoder().decode(bytes);
    const local = extractDeterministicClient(source);
    return [{
      row: local.row,
      confidence: {},
      fieldEvidence: [],
      provider: { name: "deterministic", version: "1" },
      documentType: "text",
      country: null,
      quality: { overall: "NOT_PERFORMED", checks: [] },
      authenticity: { overall: "NOT_PERFORMED", checks: [] },
      mrz: null,
      traceId: options.traceId ?? null,
    }];
  }

  if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    throw new ActionError("unsupported_file", "Document Intelligence supports PDF, JPG, PNG and WebP", 415);
  }

  const result = await extractIdentityDocument({
    data: bytes,
    mimeType,
    filename: options.filename,
    traceId: options.traceId,
    microblinkConsent: options.microblinkConsent ?? null,
  });
  return [result];
}

export async function rowsFromImageOrPdf(
  bytes: Uint8Array,
  mimeType: string,
  options: Parameters<typeof rowsFromImageOrPdfDetailed>[2] = {},
) {
  return (await rowsFromImageOrPdfDetailed(bytes, mimeType, options)).map((item) => item.row);
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
