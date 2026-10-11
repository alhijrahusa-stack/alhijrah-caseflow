import "server-only";

import type { IntakeRow } from "@/lib/intake-file";
import { registry } from "@/lib/providers/config";
import type {
  BoundingRegion,
  DocumentExtraction,
  DocumentFieldEvidence,
  ProviderCall,
  VerificationState,
} from "@/lib/providers/document-intelligence-types";

const VERSION = "9.9";

type AnyRecord = Record<string, unknown>;

function object(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function checkResult(value: unknown): VerificationState {
  if (value === 1 || value === "OK" || value === "VERIFIED" || value === "COMPARE_MATCH") return "PASSED";
  if (value === 0 || value === "ERROR" || value === "NOT_VERIFIED" || value === "COMPARE_NOT_MATCH") return "FAILED";
  if (value === 2 || value === "WAS_NOT_DONE" || value === "DISABLED") return "NOT_PERFORMED";
  return "REVIEW";
}

function rect(value: unknown): BoundingRegion | null {
  const r = object(value);
  const left = number(r.left);
  const top = number(r.top);
  const right = number(r.right);
  const bottom = number(r.bottom);
  return left == null || top == null || right == null || bottom == null ? null : { left, top, right, bottom };
}

function key(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const FIELD_ALIASES: Record<string, keyof IntakeRow> = {
  "full name": "full_name",
  "surname and given names": "full_name",
  "surname given names": "full_name",
  "date of birth": "date_of_birth",
  "birth date": "date_of_birth",
  "phone": "phone",
  "phone number": "phone",
  "mobile phone": "phone",
  "email": "email",
  "email address": "email",
  "address": "street",
  "street": "street",
  "street address": "street",
  "city": "city",
  "residence city": "city",
  "state": "state",
  "province": "state",
  "postal code": "zip",
  "zip code": "zip",
  "postcode": "zip",
};

function mappedField(fieldName: string): keyof IntakeRow | null {
  const normalized = key(fieldName);
  if (FIELD_ALIASES[normalized]) return FIELD_ALIASES[normalized];
  if (normalized.includes("date of birth")) return "date_of_birth";
  if (normalized === "e mail" || normalized.includes("email")) return "email";
  if (normalized.includes("phone") || normalized.includes("telephone")) return "phone";
  if (normalized.includes("postal code") || normalized.includes("zip code")) return "zip";
  return null;
}

function candidateDocument(containers: AnyRecord[]) {
  for (const container of containers) {
    const candidate = object(container.OneCandidate);
    const name = text(candidate.DocumentName) ?? text(candidate.documentName);
    const country = text(candidate.ICAOCode) ?? text(candidate.CountryName) ?? text(candidate.countryName);
    if (name || country) return { name, country };
  }
  return { name: null, country: null };
}

function statusFromContainers(containers: AnyRecord[]) {
  for (const container of containers) {
    const status = object(container.Status);
    if (Object.keys(status).length) return status;
  }
  return {};
}

function authenticityFromContainers(containers: AnyRecord[]) {
  const checks: DocumentExtraction["authenticity"]["checks"] = [];
  for (const container of containers) {
    const authenticity = object(container.AuthenticityCheckList);
    const lists = array(authenticity.List);
    if (!lists.length && !Object.keys(authenticity).length) continue;
    for (const item of lists) {
      const check = object(item);
      checks.push({
        type: String(check.Type ?? check.type ?? "AUTHENTICITY"),
        result: checkResult(check.Result ?? check.result ?? check.ElementResult),
        reason: text(check.ElementDiagnose) ?? text(check.reason),
      });
    }
    if (!checks.length) {
      checks.push({
        type: "AUTHENTICITY",
        result: checkResult(authenticity.Result ?? authenticity.result),
        reason: null,
      });
    }
  }
  const failed = checks.some((entry) => entry.result === "FAILED");
  const passed = checks.some((entry) => entry.result === "PASSED");
  return {
    overall: failed ? "FAILED" as const : passed ? "PASSED" as const : checks.length ? "NOT_PERFORMED" as const : "UNSUPPORTED" as const,
    checks,
  };
}

function qualityFromContainers(containers: AnyRecord[]) {
  const checks: DocumentExtraction["quality"]["checks"] = [];
  for (const container of containers) {
    const quality = object(container.ImageQualityCheckList);
    for (const item of array(quality.List)) {
      const check = object(item);
      const areasContainer = object(check.areas);
      const regions = array(areasContainer.List).map(rect).filter((value): value is BoundingRegion => Boolean(value));
      checks.push({
        type: String(check.type ?? check.Type ?? "IMAGE_QUALITY"),
        result: checkResult(check.result ?? check.Result),
        probability: number(check.probability),
        regions,
      });
    }
  }
  const failed = checks.some((entry) => entry.result === "FAILED");
  const passed = checks.some((entry) => entry.result === "PASSED");
  return {
    overall: failed ? "FAILED" as const : passed ? "PASSED" as const : checks.length ? "NOT_PERFORMED" as const : "UNSUPPORTED" as const,
    checks,
  };
}

function parseResponse(payload: unknown, traceId: string | null): DocumentExtraction | null {
  const root = object(payload);
  const containerList = object(root.ContainerList);
  const containers = array(containerList.List).map(object);
  if (!containers.length) return null;

  const document = candidateDocument(containers);
  const status = statusFromContainers(containers);
  const detailsOptical = object(status.detailsOptical);
  const authenticity = authenticityFromContainers(containers);
  const quality = qualityFromContainers(containers);
  const row: IntakeRow = {};
  const confidence: Record<string, number> = {};
  const evidence: DocumentFieldEvidence[] = [];
  let givenNames: string | null = null;
  let surname: string | null = null;

  for (const container of containers) {
    const textResult = object(container.Text);
    for (const rawField of array(textResult.fieldList)) {
      const field = object(rawField);
      const fieldName = text(field.fieldName) ?? String(field.fieldType ?? "UNKNOWN");
      const values = array(field.valueList).map(object);
      const preferred = values.find((value) => text(value.value)) ?? {};
      const rawValue = text(field.value) ?? text(preferred.value);
      if (!rawValue) continue;

      const normalizedName = key(fieldName);
      if (normalizedName === "given names" || normalizedName === "given name" || normalizedName === "first name") givenNames = rawValue;
      if (normalizedName === "surname" || normalizedName === "last name" || normalizedName === "family name") surname = rawValue;

      const canonical = mappedField(fieldName);
      if (!canonical) continue;
      if (row[canonical] == null || String(row[canonical]).trim() === "") row[canonical] = rawValue;

      const probability = number(preferred.probability);
      if (probability != null) confidence[String(canonical)] = probability;
      const validation = checkResult(field.validityStatus ?? field.status);
      const cross = checkResult(field.comparisonStatus);
      const source = text(preferred.source);
      const checksum = source && /mrz/i.test(source) ? validation : "NOT_PERFORMED";
      const authState = authenticity.overall;

      evidence.push({
        field_name: String(canonical),
        raw_value: rawValue,
        normalized_value: rawValue,
        document_id: null,
        document_type: document.name,
        country: document.country,
        page_index: number(preferred.pageIndex),
        bounding_region: rect(preferred.fieldRect),
        source_type: source,
        provider_name: "regula",
        provider_version: VERSION,
        recognition_probability: probability,
        validation_result: validation,
        checksum_result: checksum,
        cross_source_result: cross,
        authenticity_result: authState,
        conflicts: [],
        review_state: validation === "FAILED" || cross === "FAILED" || authState === "FAILED" ? "NEEDS_REVIEW" : "AUTO_ACCEPTED",
        reviewed_by: null,
        reviewed_at: null,
        trace_id: traceId,
      });
    }
  }

  if (!row.full_name && (givenNames || surname)) {
    row.full_name = [givenNames, surname].filter(Boolean).join(" ");
  }

  const securityStatus = checkResult(detailsOptical.security);
  const finalAuthenticity = authenticity.overall === "UNSUPPORTED" && securityStatus !== "REVIEW"
    ? { ...authenticity, overall: securityStatus }
    : authenticity;

  return {
    row,
    confidence,
    fieldEvidence: evidence,
    provider: { name: "regula", version: VERSION },
    documentType: document.name,
    country: document.country,
    quality,
    authenticity: finalAuthenticity,
    traceId,
  };
}

export async function regulaExtract(args: {
  data: Uint8Array;
  mimeType: string;
  traceId?: string | null;
  timeoutMs?: number;
}): Promise<ProviderCall> {
  const cfg = registry.regula();
  if (!cfg.url) {
    return { ok: false, code: "NOT_CONFIGURED", message: "Regula Document Reader Web Service is not configured", provider: "regula" };
  }

  const endpoint = cfg.url.replace(/\/$/, "").endsWith("/api/process")
    ? cfg.url.replace(/\/$/, "")
    : `${cfg.url.replace(/\/$/, "")}/api/process`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.authorization) headers.authorization = cfg.authorization;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        processParam: {
          scenario: "FullAuth",
          doublePageSpread: true,
          dateFormat: "yyyy-MM-dd",
          resultTypeOutput: [9, 20, 30, 33, 36, 61, 62, 85],
        },
        List: [{ ImageData: { image: Buffer.from(args.data).toString("base64") } }],
        passBackObject: { traceId: args.traceId ?? null },
      }),
      signal: AbortSignal.timeout(args.timeoutMs ?? 20_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = text(object(body).message) ?? text(object(body).error) ?? `Regula HTTP ${response.status}`;
      return {
        ok: false,
        code: response.status === 415 || response.status === 422 ? "UNSUPPORTED" : "PROVIDER_ERROR",
        message,
        provider: "regula",
      };
    }
    const parsed = parseResponse(body, args.traceId ?? null);
    if (!parsed) return { ok: false, code: "INVALID_RESPONSE", message: "Regula returned no process containers", provider: "regula" };
    return { ok: true, result: parsed };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      ok: false,
      code: timeout ? "TIMEOUT" : "PROVIDER_ERROR",
      message: error instanceof Error ? error.message : "Regula request failed",
      provider: "regula",
    };
  }
}
