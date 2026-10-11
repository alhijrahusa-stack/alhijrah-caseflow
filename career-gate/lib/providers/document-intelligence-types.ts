import type { IntakeRow } from "@/lib/intake-file";

export type DocumentProviderName = "regula" | "microblink";
export type VerificationState = "PASSED" | "FAILED" | "NOT_PERFORMED" | "UNSUPPORTED" | "REVIEW";

export type BoundingRegion = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type DocumentFieldEvidence = {
  field_name: string;
  raw_value: string;
  normalized_value: string;
  document_id: string | null;
  document_type: string | null;
  country: string | null;
  page_index: number | null;
  bounding_region: BoundingRegion | null;
  source_type: string | null;
  provider_name: DocumentProviderName;
  provider_version: string;
  recognition_probability: number | null;
  validation_result: VerificationState;
  checksum_result: VerificationState;
  cross_source_result: VerificationState;
  authenticity_result: VerificationState;
  conflicts: string[];
  review_state: "AUTO_ACCEPTED" | "NEEDS_REVIEW";
  reviewed_by: string | null;
  reviewed_at: string | null;
  trace_id: string | null;
};

export type DocumentQuality = {
  overall: VerificationState;
  checks: Array<{
    type: string;
    result: VerificationState;
    probability: number | null;
    regions: BoundingRegion[];
  }>;
};

export type DocumentAuthenticity = {
  overall: VerificationState;
  checks: Array<{
    type: string;
    result: VerificationState;
    reason: string | null;
  }>;
};

export type DocumentExtraction = {
  row: IntakeRow;
  /** Raw provider probability by canonical field. No invented or rescaled values. */
  confidence: Record<string, number>;
  fieldEvidence: DocumentFieldEvidence[];
  provider: {
    name: DocumentProviderName;
    version: string;
  };
  documentType: string | null;
  country: string | null;
  quality: DocumentQuality;
  authenticity: DocumentAuthenticity;
  traceId: string | null;
};

export type ProviderFailureCode =
  | "NOT_CONFIGURED"
  | "UNSUPPORTED"
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  | "CONSENT_REQUIRED"
  | "INVALID_RESPONSE";

export type ProviderCall =
  | { ok: true; result: DocumentExtraction }
  | { ok: false; code: ProviderFailureCode; message: string; provider: DocumentProviderName };
