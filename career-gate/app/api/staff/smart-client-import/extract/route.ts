import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { ActionError } from "@/lib/service";
import { staffGuard } from "@/lib/staff-api";
import { mergeIntakeDocumentSuggestions, type IntakeDocumentResult } from "@/lib/client-intake-extraction";
import { SMART_IMPORT_LIMITS } from "@/lib/smart-client-import-core";
import { classifyAndExtractDocument, type DocumentClassification, type ExtractionStage } from "@/lib/universal-intake";
import type { MrzResult } from "@/lib/mrz";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Zero-click document intelligence for the staff Smart Client Import surface.
 *
 * Reading a document no longer waits for a submission. The surface posts one file
 * here the moment it is chosen, and gets back the classification, the fields and the
 * per-field review reasons — so the form fills itself while the staff member is still
 * looking at the page.
 *
 * This route is deliberately STATELESS: it creates no case, writes no row and stores
 * nothing. Choosing a document, looking at what it says and then discarding it must
 * not leave an abandoned case in the Active Queue, and must not consume a case
 * number. The document is uploaded and the evidence persisted only when the staff
 * member submits, which is also the only place authorization to create a case is
 * decided.
 *
 * It reuses the existing extraction engine and the existing merge layer rather than
 * adding a second one, so the staff surface and the client intake link cannot drift
 * apart in what they consider safe to auto-fill.
 */

const ACCEPTED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

/**
 * What the response says about the band.
 *
 * The document number is deliberately NOT included. It is read to verify the band's
 * check digits and then dropped: the office does not need it on this surface, and an
 * identifier that is never returned cannot leak from one.
 */
export type MrzSummary = {
  format: MrzResult["format"];
  verified: boolean;
  verified_fields: string[];
  issuing_state: string;
  nationality: string;
  expiration_date: string | null;
  failed_checks: string[];
};

function summarizeMrz(mrz: MrzResult | null): MrzSummary | null {
  if (!mrz) return null;
  const failed = Object.entries(mrz.checks)
    .filter(([, value]) => value && !value.valid)
    .map(([key]) => key);
  return {
    format: mrz.format,
    verified: mrz.verified,
    verified_fields: mrz.verified_fields,
    issuing_state: mrz.issuing_state,
    nationality: mrz.nationality,
    expiration_date: mrz.expiration_date,
    failed_checks: failed,
  };
}

/** The first bytes of a file, which are what its real type is decided by. */
const SIGNATURES: readonly { mime: string; bytes: readonly number[]; offset: number }[] = [
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46], offset: 0 },
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff], offset: 0 },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], offset: 0 },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },
];

/**
 * The type the bytes actually are, not the type the browser claimed.
 *
 * A declared content type is attacker-controlled, so it is only accepted when the
 * file's own signature agrees with it. WEBP additionally carries "WEBP" at offset 8.
 */
function realType(bytes: Uint8Array): string | null {
  for (const signature of SIGNATURES) {
    if (bytes.length < signature.offset + signature.bytes.length) continue;
    if (!signature.bytes.every((byte, index) => bytes[signature.offset + index] === byte)) continue;
    if (signature.mime === "image/webp") {
      const tag = String.fromCharCode(...bytes.slice(8, 12));
      if (tag !== "WEBP") continue;
    }
    return signature.mime;
  }
  return null;
}

export type ExtractResponse = {
  filename: string;
  classification: DocumentClassification | null;
  /** The parsed machine readable zone, with its check-digit outcome. */
  mrz: MrzSummary | null;
  stages: ExtractionStage[];
  escalated: boolean;
  duration_ms: number;
  applicants: number;
} & ReturnType<typeof mergeIntakeDocumentSuggestions>;

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  if (guard.session.staff.role === "staff") {
    return err("forbidden", "Smart client import requires manager or admin access", 403, traceId);
  }

  try {
    const form = await req.formData();
    const file = form.getAll("files").find((value): value is File => value instanceof File && value.size > 0);
    if (!file) return err("document_required", "Choose a document to read.", 400, traceId);
    if (file.size > SMART_IMPORT_LIMITS.maxFileBytes) {
      return err("file_too_large", "This file is larger than the allowed limit.", 413, traceId);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const actual = realType(bytes);
    if (!actual) return err("unsupported_file", "Supported files: PDF, JPG, PNG and WEBP.", 415, traceId);
    // A declared type that disagrees with the bytes is refused rather than trusted.
    if (file.type && ACCEPTED.has(file.type) && file.type !== actual) {
      return err("unsupported_file", "This file's contents do not match its type.", 415, traceId);
    }

    const intelligence = await classifyAndExtractDocument(bytes, actual);
    const documents: IntakeDocumentResult[] = [{ filename: file.name || "document", rows: intelligence.rows }];
    const suggestions = mergeIntakeDocumentSuggestions(documents);

    return ok({
      filename: file.name || "document",
      classification: intelligence.classification,
      mrz: summarizeMrz(intelligence.mrz),
      stages: intelligence.stages,
      escalated: intelligence.escalated,
      duration_ms: intelligence.duration_ms,
      applicants: intelligence.rows.length,
      ...suggestions,
    }, 200, traceId);
  } catch (error) {
    // The provider's own diagnostics can name projects, quotas and billing URLs.
    // None of that belongs in a response, so each failure class gets its own
    // actionable message and manual entry stays available throughout.
    if (error instanceof ActionError) {
      if (error.code === "ocr_not_configured") {
        return err(
          "ai_not_configured",
          "Automatic document reading is not configured. Enter the details in the source box; everything else works normally.",
          503,
          traceId,
        );
      }
      if (/quota exceeded|exceeded your current quota|resource_exhausted/i.test(error.message)) {
        return err(
          "ai_temporarily_unavailable",
          "Automatic document reading is temporarily unavailable. Enter the details in the source box and submit as usual.",
          503,
          traceId,
        );
      }
      return err(
        "extraction_failed",
        "This document could not be read. Keep it attached and complete the details in the source box.",
        422,
        traceId,
      );
    }
    return err("extraction_failed", "This document could not be read.", 422, traceId);
  }
}
