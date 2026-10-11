import "server-only";

import type { IntakeRow } from "@/lib/intake-file";
import { registry } from "@/lib/providers/config";
import type {
  DocumentExtraction,
  DocumentFieldEvidence,
  ProviderCall,
  VerificationState,
} from "@/lib/providers/document-intelligence-types";

const VERSION = "4000.4.0";
type AnyRecord = Record<string, unknown>;

function object(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function deepFind(root: unknown, names: readonly string[]): string | null {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const seen = new Set<unknown>();
  const queue: unknown[] = [root];
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    for (const [name, value] of Object.entries(current as AnyRecord)) {
      if (wanted.has(name.toLowerCase())) {
        const direct = text(value);
        if (direct) return direct;
        const nested = object(value);
        const nestedValue = text(nested.value) ?? text(nested.rawValue) ?? text(nested.originalValue);
        if (nestedValue) return nestedValue;
      }
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return null;
}

function verdictState(value: unknown): VerificationState {
  const v = String(value ?? "").toLowerCase();
  if (["accept", "accepted", "pass", "passed", "valid"].includes(v)) return "PASSED";
  if (["reject", "rejected", "fail", "failed", "invalid"].includes(v)) return "FAILED";
  if (["notperformed", "not_performed", "skipped"].includes(v)) return "NOT_PERFORMED";
  return "REVIEW";
}

function parseResponse(payload: unknown, traceId: string | null): DocumentExtraction {
  const root = object(payload);
  const extraction = root.extraction ?? root;
  const row: IntakeRow = {};
  const fullName = deepFind(extraction, ["fullName", "name"]);
  const firstName = deepFind(extraction, ["firstName", "givenName", "givenNames"]);
  const lastName = deepFind(extraction, ["lastName", "surname", "familyName"]);
  row.full_name = fullName ?? [firstName, lastName].filter(Boolean).join(" ") || null;
  row.date_of_birth = deepFind(extraction, ["dateOfBirth", "birthDate"]);
  row.street = deepFind(extraction, ["address", "street", "residentialAddress"]);
  row.city = deepFind(extraction, ["city", "placeOfResidence"]);
  row.state = deepFind(extraction, ["state", "region", "province"]);
  row.zip = deepFind(extraction, ["postalCode", "zipCode"]);
  row.email = deepFind(extraction, ["email", "emailAddress"]);
  row.phone = deepFind(extraction, ["phone", "phoneNumber"]);

  const docType = deepFind(extraction, ["documentType", "type"]);
  const country = deepFind(extraction, ["country", "countryCode", "issuingCountry"]);
  const verdict = root.verdict ?? object(root.verification).verdict;
  const auth = verdictState(verdict);
  const failedChecks = Array.isArray(root.failedChecks) ? root.failedChecks : [];
  const fields = Object.entries(row).filter(([, value]) => typeof value === "string" && value.trim()) as Array<[string, string]>;
  const evidence: DocumentFieldEvidence[] = fields.map(([field, value]) => ({
    field_name: field,
    raw_value: value,
    normalized_value: value,
    document_id: null,
    document_type: docType,
    country,
    page_index: null,
    bounding_region: null,
    source_type: "verify_v3",
    provider_name: "microblink",
    provider_version: VERSION,
    recognition_probability: null,
    validation_result: "REVIEW",
    checksum_result: "NOT_PERFORMED",
    cross_source_result: "NOT_PERFORMED",
    authenticity_result: auth,
    conflicts: failedChecks.map((check) => typeof check === "string" ? check : JSON.stringify(check)),
    review_state: auth === "FAILED" || auth === "REVIEW" ? "NEEDS_REVIEW" : "AUTO_ACCEPTED",
    reviewed_by: null,
    reviewed_at: null,
    trace_id: traceId,
  }));

  return {
    row,
    confidence: {},
    fieldEvidence: evidence,
    provider: { name: "microblink", version: VERSION },
    documentType: docType,
    country,
    quality: { overall: "REVIEW", checks: [] },
    authenticity: {
      overall: auth,
      checks: failedChecks.map((check) => ({
        type: typeof check === "string" ? check : String(object(check).type ?? "FAILED_CHECK"),
        result: "FAILED" as const,
        reason: typeof check === "string" ? null : text(object(check).message) ?? text(object(check).reason),
      })),
    },
    traceId,
  };
}

export async function microblinkExtract(args: {
  data: Uint8Array;
  mimeType: string;
  filename?: string;
  traceId?: string | null;
  consent?: { userId: string; durationDays: number; givenOn?: string } | null;
  timeoutMs?: number;
}): Promise<ProviderCall> {
  const cfg = registry.microblink();
  if (!cfg.url) {
    return { ok: false, code: "NOT_CONFIGURED", message: "Microblink BlinkID Verify is not configured", provider: "microblink" };
  }
  if (cfg.mode === "cloud" && !args.consent) {
    return { ok: false, code: "CONSENT_REQUIRED", message: "Microblink cloud verification requires recorded end-user consent", provider: "microblink" };
  }

  const base = cfg.url.replace(/\/$/, "");
  const endpoint = base.endsWith("/api/v3/verify") ? base : `${base}/api/v3/verify`;
  const form = new FormData();
  form.append("imageFirstSide", new Blob([args.data], { type: args.mimeType }), args.filename ?? "document");
  form.append("configuration", new Blob([JSON.stringify({
    verification: {
      useCase: {
        verificationPolicy: "HighAssurance",
        verificationContext: "Remote",
        manualReviewStrategy: "RejectedOnly",
      },
      settings: { rejectExpiredDocuments: true },
    },
    extraction: {
      documentCaptureModuleSettings: {
        documentImageReturnEnabled: false,
        faceImageExtractionEnabled: false,
      },
    },
  })], { type: "application/json" }), "configuration.json");
  if (cfg.mode === "cloud" && args.consent) form.append("consent", JSON.stringify(args.consent));

  const headers: Record<string, string> = {};
  if (cfg.authorization) headers.authorization = cfg.authorization;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: form,
      signal: AbortSignal.timeout(args.timeoutMs ?? 25_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = text(object(body).message) ?? text(object(body).error) ?? `Microblink HTTP ${response.status}`;
      return {
        ok: false,
        code: response.status === 415 || response.status === 422 ? "UNSUPPORTED" : "PROVIDER_ERROR",
        message,
        provider: "microblink",
      };
    }
    return { ok: true, result: parseResponse(body, args.traceId ?? null) };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      ok: false,
      code: timeout ? "TIMEOUT" : "PROVIDER_ERROR",
      message: error instanceof Error ? error.message : "Microblink request failed",
      provider: "microblink",
    };
  }
}
