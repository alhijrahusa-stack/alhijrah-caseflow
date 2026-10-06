import { z } from "zod";
import { SMART_FIELDS } from "@/components/staff/smart/field-contract";
import { normalizePreparedDraft, type PreparedImportDraft } from "@/lib/smart-client-import-core";

/**
 * Smart Review approval readiness.
 *
 * Smart Review is an administrative intake stage, not the final business-completeness
 * gate. Approval is therefore blocked only by conditions that would make the write
 * itself unsafe:
 *
 *   A  technical persistence failure (the canonical Client cannot be written)
 *   B  authorization / session failure (decided server-side, passed in)
 *   C  canonical type or database-constraint failure for a value that must persist
 *   D  destructive system conflict (duplicate identity, concurrency)
 *
 * Nothing else blocks. A missing, unset, unreviewed or REVIEW-state optional field is
 * a warning carried forward to downstream administrative review.
 *
 * `public.clients` constrains, as of migration 032:
 *   full_name  NOT NULL, length(trim(..)) > 0
 *   phone      NOT NULL
 *   preferred_language    nullable (031 dropped the default and NOT NULL), value-checked
 *   english_proficiency   nullable, value-checked
 *   shift_days            nullable, value-checked against the canonical day codes
 * Everything else in the reviewed contract is nullable and unconstrained by value.
 */

/** Canonical identity the clients row cannot be written without. */
export const REQUIRED_IDENTITY_FIELDS = Object.freeze(["full_name", "phone"] as const);

export type ApprovalReadiness = "READY_TO_APPROVE" | "APPROVE_WITH_WARNINGS" | "BLOCKED";

export type ApprovalBlocker = {
  /** Which of the four permitted blocking classes this is. */
  code: "PERSISTENCE" | "AUTHORIZATION" | "CANONICAL_TYPE" | "SYSTEM_CONFLICT";
  field: string | null;
  message: string;
};

export type ApprovalWarning = {
  field: string;
  state: "MISSING" | "REVIEW";
  message: string;
};

export type ApprovalAssessment = {
  readiness: ApprovalReadiness;
  blockers: ApprovalBlocker[];
  warnings: ApprovalWarning[];
  /**
   * The draft that can actually be persisted: identical to the reviewed draft except
   * that optional values which cannot satisfy their canonical type have been cleared.
   * Null when required canonical identity could not be established.
   */
  draft: PreparedImportDraft | null;
};

const FIELD_LABEL = new Map(SMART_FIELDS.map((field) => [field.key, field.label]));
const labelFor = (key: string) => FIELD_LABEL.get(key) ?? key;

/** Clearing a field is only safe when the column is nullable. */
function clearable(field: string) {
  return !(REQUIRED_IDENTITY_FIELDS as readonly string[]).includes(field);
}

function clone(value: unknown): Record<string, unknown> {
  return structuredClone((value && typeof value === "object" ? value : {}) as Record<string, unknown>);
}

/** The reviewed-field scope a key belongs to, so it is cleared in the right place. */
function scopeOf(field: string): "profile" | "review_fields" | null {
  const entry = SMART_FIELDS.find((item) => item.key === field);
  return entry ? entry.scope : null;
}

function clearField(draft: Record<string, unknown>, field: string) {
  const scope = scopeOf(field);
  // Fields outside the reviewed contract (employment history, Amazon history) are
  // cleared on the profile, which is where the schema reports them.
  const target = scope === "review_fields" ? "review_fields" : "profile";
  const section = clone(draft[target]);
  if (!(field in section) && target === "profile") {
    // Nothing to clear; signal failure so the caller does not loop forever.
    return false;
  }
  section[field] = null;
  draft[target] = section;
  return true;
}

/** The field a normalization error refers to, from either a Zod issue or a thrown Error. */
function offendingFields(error: unknown): string[] {
  if (error instanceof z.ZodError) {
    return [...new Set(error.issues.map((issue) => String(issue.path[0] ?? "")))].filter(Boolean);
  }
  const message = error instanceof Error ? error.message : "";
  const match = message.match(/^([a-z_]+):/);
  return match ? [match[1]] : [];
}

/**
 * Normalizes the reviewed draft into something persistable, clearing only optional
 * values that cannot satisfy their canonical type. Each cleared field is reported so
 * the reviewer sees it and its source evidence is still the record of what arrived.
 */
export function buildPersistableDraft(mappedDraft: unknown): {
  draft: PreparedImportDraft | null;
  cleared: string[];
  blocked: ApprovalBlocker[];
} {
  let candidate = clone(mappedDraft);
  const cleared: string[] = [];

  // One pass per reviewed field at most; the loop always either clears a field or stops.
  for (let guard = 0; guard <= SMART_FIELDS.length + 8; guard += 1) {
    try {
      return { draft: normalizePreparedDraft(candidate), cleared, blocked: [] };
    } catch (error) {
      const fields = offendingFields(error);
      const unclearable = fields.filter((field) => !clearable(field));
      if (fields.length === 0 || unclearable.length > 0) {
        const blocked: ApprovalBlocker[] = (unclearable.length ? unclearable : ["profile"]).map((field) => ({
          code: "CANONICAL_TYPE",
          field: field === "profile" ? null : field,
          message: field === "profile"
            ? `This file cannot be saved as a Client yet: ${error instanceof Error ? error.message : "the reviewed data is not valid"}.`
            : `${labelFor(field)} is required to create the Client and is missing or invalid.`,
        }));
        return { draft: null, cleared, blocked };
      }
      let progressed = false;
      for (const field of fields) {
        if (clearField(candidate, field)) {
          cleared.push(field);
          progressed = true;
        }
      }
      if (!progressed) {
        return {
          draft: null,
          cleared,
          blocked: [{
            code: "CANONICAL_TYPE",
            field: null,
            message: `This file cannot be saved as a Client yet: ${error instanceof Error ? error.message : "the reviewed data is not valid"}.`,
          }],
        };
      }
      candidate = clone(candidate);
    }
  }

  return {
    draft: null,
    cleared,
    blocked: [{ code: "CANONICAL_TYPE", field: null, message: "The reviewed data could not be normalized into a Client." }],
  };
}

function readField(draft: PreparedImportDraft, key: string) {
  const scope = scopeOf(key);
  const section = scope === "review_fields" ? draft.review_fields : draft.profile;
  return (section as Record<string, unknown>)[key] ?? null;
}

function isEmpty(value: unknown) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return String(value).trim().length === 0;
}

/**
 * Assesses one reviewed case. `conflicts` and `authorization` come from the server;
 * everything else is derived from data the review surface already has, so the UI needs
 * no extra request to know whether approval is available.
 */
export function assessApproval(args: {
  mappedDraft: unknown;
  /** Blocking conflicts the server already determined (duplicate identity, concurrency). */
  conflicts?: readonly unknown[];
  /** False when the server will refuse this approval for the current session. */
  authorized?: boolean;
  /** Set when the persistence target itself is unavailable, e.g. a missing column. */
  persistenceError?: string | null;
  /** The reviewer the approval will be recorded against; required by the case constraint. */
  reviewerAssigned?: boolean;
  /**
   * Whether the reviewer has recorded both the document-status and information-match
   * confirmations. `client_import_cases_approved_ck` requires both on an approved row,
   * so this is a database-constraint blocker, not a completeness check.
   */
  confirmationsRecorded?: boolean;
}): ApprovalAssessment {
  const blockers: ApprovalBlocker[] = [];
  const warnings: ApprovalWarning[] = [];

  if (args.authorized === false) {
    blockers.push({ code: "AUTHORIZATION", field: null, message: "Your session is not authorized to approve this file." });
  }
  if (args.persistenceError) {
    blockers.push({ code: "PERSISTENCE", field: null, message: args.persistenceError });
  }

  const { draft, cleared, blocked } = buildPersistableDraft(args.mappedDraft);
  blockers.push(...blocked);

  const conflictCount = (args.conflicts ?? []).length;
  if (conflictCount > 0) {
    blockers.push({
      code: "SYSTEM_CONFLICT",
      field: null,
      message: `${conflictCount} blocking conflict${conflictCount === 1 ? "" : "s"} must be resolved; approving now could create or overwrite the wrong Client.`,
    });
  }

  // The import case constraint requires a reviewer on an approved file.
  if (args.reviewerAssigned === false) {
    blockers.push({ code: "CANONICAL_TYPE", field: null, message: "Select the reviewer this approval is recorded against." });
  }
  if (args.confirmationsRecorded === false) {
    blockers.push({
      code: "CANONICAL_TYPE",
      field: null,
      message: "Record both the document-status and information-match confirmations; an approved file cannot be stored without them.",
    });
  }

  if (draft) {
    for (const field of cleared) {
      warnings.push({
        field,
        state: "REVIEW",
        message: `${labelFor(field)} could not be read as a valid value and was left unset. The original source is preserved for review.`,
      });
    }
    const clearedSet = new Set(cleared);
    for (const field of SMART_FIELDS) {
      if (clearedSet.has(field.key)) continue;
      if ((REQUIRED_IDENTITY_FIELDS as readonly string[]).includes(field.key)) continue;
      if (isEmpty(readField(draft, field.key))) {
        warnings.push({ field: field.key, state: "MISSING", message: `${field.label} is not set and can be completed later.` });
      }
    }
  }

  const readiness: ApprovalReadiness = blockers.length > 0
    ? "BLOCKED"
    : warnings.length > 0 ? "APPROVE_WITH_WARNINGS" : "READY_TO_APPROVE";

  return { readiness, blockers, warnings, draft: blockers.length ? null : draft };
}

/** Short, truthful summary for the action rail. */
export function readinessSummary(assessment: ApprovalAssessment) {
  if (assessment.readiness === "BLOCKED") {
    return assessment.blockers[0]?.message ?? "Approval is blocked.";
  }
  if (assessment.readiness === "READY_TO_APPROVE") return "Ready to approve.";
  const count = assessment.warnings.length;
  return `${count} field${count === 1 ? "" : "s"} can be completed later.`;
}
