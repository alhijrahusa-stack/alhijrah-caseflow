import "server-only";

import { ActionError } from "@/lib/service";
import { microblinkExtract } from "@/lib/providers/microblink";
import { regulaExtract } from "@/lib/providers/regula";
import type { DocumentExtraction, ProviderCall } from "@/lib/providers/document-intelligence-types";

function extractedFieldCount(result: DocumentExtraction) {
  return Object.values(result.row).filter((value) => typeof value === "string" && value.trim()).length;
}

/**
 * Identity-document provider policy.
 *
 * Regula 9.9 is always attempted first. Microblink Verify 4000.4.0 is reached
 * only when Regula is unavailable/unsupported/fails, or when it returns no
 * usable applicant fields. A successful Regula result is never overwritten by
 * a fallback result.
 */
export async function extractIdentityDocument(args: {
  data: Uint8Array;
  mimeType: string;
  filename?: string;
  traceId?: string | null;
  microblinkConsent?: { userId: string; durationDays: number; givenOn?: string } | null;
}): Promise<DocumentExtraction> {
  const primary = await regulaExtract({
    data: args.data,
    mimeType: args.mimeType,
    traceId: args.traceId,
  });

  if (primary.ok && extractedFieldCount(primary.result) > 0) return primary.result;

  const fallback = await microblinkExtract({
    data: args.data,
    mimeType: args.mimeType,
    filename: args.filename,
    traceId: args.traceId,
    consent: args.microblinkConsent ?? null,
  });

  if (fallback.ok) return fallback.result;
  if (primary.ok) return primary.result;

  const failures: ProviderCall[] = [primary, fallback];
  const configured = failures.filter((item) => !item.ok && item.code !== "NOT_CONFIGURED");
  const details = failures
    .filter((item): item is Extract<ProviderCall, { ok: false }> => !item.ok)
    .map((item) => `${item.provider}:${item.code}:${item.message}`)
    .join(" | ");

  if (!configured.length) {
    throw new ActionError(
      "document_provider_not_configured",
      "Document Intelligence is not configured. Regula 9.9 is required; Microblink 4000.4.0 is the conditional fallback.",
      503,
    );
  }
  throw new ActionError("document_extraction_failed", details || "Document extraction failed", 422);
}
