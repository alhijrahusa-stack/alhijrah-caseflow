import { describe, expect, it } from "vitest";
import {
  REQUIRED_IDENTITY_FIELDS,
  assessApproval,
  buildPersistableDraft,
  readinessSummary,
} from "@/lib/smart-approval-readiness";
import { prepareImportDraft } from "@/lib/smart-client-import-core";

/** A reviewed draft carrying only the canonical identity the clients row requires. */
function baseDraft(overrides: { profile?: Record<string, unknown>; review_fields?: Record<string, unknown> } = {}) {
  const draft = prepareImportDraft({ full_name: "QA Synthetic Verification 20261006", phone: "3135550199" });
  return {
    ...draft,
    profile: { ...draft.profile, ...(overrides.profile ?? {}) },
    review_fields: { ...draft.review_fields, ...(overrides.review_fields ?? {}) },
  };
}

describe("Smart Review approval readiness", () => {
  it("names only the canonical identity the clients row cannot be written without", () => {
    expect([...REQUIRED_IDENTITY_FIELDS]).toEqual(["full_name", "phone"]);
  });

  // TEST A — optional missing data must not withhold approval.
  it("TEST A: approves with warnings when every optional field is unset", () => {
    const assessment = assessApproval({ mappedDraft: baseDraft(), reviewerAssigned: true });
    expect(assessment.readiness).toBe("APPROVE_WITH_WARNINGS");
    expect(assessment.blockers).toEqual([]);
    expect(assessment.draft).not.toBeNull();

    const warned = assessment.warnings.map((warning) => warning.field);
    for (const field of ["preferred_language", "english_proficiency", "location_option_1", "location_option_2", "shift_days", "shift_start_time", "shift_end_time"]) {
      expect(warned, field).toContain(field);
    }
    for (const warning of assessment.warnings) expect(warning.state).toBe("MISSING");
    expect(readinessSummary(assessment)).toMatch(/can be completed later/);
  });

  it("TEST A2: a complete reviewed file reports READY_TO_APPROVE", () => {
    const assessment = assessApproval({
      mappedDraft: baseDraft({
        profile: {
          email: "qa.synthetic.20261006@example.com",
          date_of_birth: "1990-01-15",
          preferred_language: "ar",
          english_proficiency: "GOOD",
          street: "28772 GOODSON ST",
          city: "DETROIT",
          state: "MI",
          zip: "48212-3768",
        },
        review_fields: {
          preferred_location: "Romulus",
          location_option_1: "Detroit",
          location_option_2: "Dearborn",
          shift_days: ["THU", "FRI", "SAT", "SUN", "MON"],
          shift_start_time: "18:00",
          shift_end_time: "04:30",
        },
      }),
      reviewerAssigned: true,
    });
    expect(assessment.readiness).toBe("READY_TO_APPROVE");
    expect(assessment.warnings).toEqual([]);
    expect(readinessSummary(assessment)).toBe("Ready to approve.");
  });

  // TEST B — REVIEW / UNVERIFIED / NOT SET states are warnings, never gates.
  it("TEST B: several optional fields in a review state still allow approval", () => {
    const assessment = assessApproval({
      mappedDraft: baseDraft({
        profile: { preferred_language: null, english_proficiency: null },
        review_fields: { preferred_location: "Romulus" },
      }),
      reviewerAssigned: true,
    });
    expect(assessment.readiness).toBe("APPROVE_WITH_WARNINGS");
    expect(assessment.blockers).toEqual([]);
    expect(assessment.draft?.review_fields.preferred_location).toBe("Romulus");
  });

  // TEST C — a real persistence failure must block, with no fake success.
  it("TEST C: a persistence failure blocks approval and is reported verbatim", () => {
    const message = 'Unable to save the Client: column "english_proficiency" of relation "clients" does not exist';
    const assessment = assessApproval({ mappedDraft: baseDraft(), reviewerAssigned: true, persistenceError: message });
    expect(assessment.readiness).toBe("BLOCKED");
    expect(assessment.draft).toBeNull();
    expect(assessment.blockers.some((blocker) => blocker.code === "PERSISTENCE" && blocker.message === message)).toBe(true);
    expect(readinessSummary(assessment)).toBe(message);
  });

  it("TEST C2: an authorization failure blocks approval", () => {
    const assessment = assessApproval({ mappedDraft: baseDraft(), reviewerAssigned: true, authorized: false });
    expect(assessment.readiness).toBe("BLOCKED");
    expect(assessment.blockers.some((blocker) => blocker.code === "AUTHORIZATION")).toBe(true);
  });

  // TEST D — an invalid optional value is never fabricated, and never blocks.
  it("TEST D: an unparseable optional value is cleared, warned about, and does not block", () => {
    const assessment = assessApproval({
      mappedDraft: baseDraft({ profile: { date_of_birth: "1000-01-01", zip: "not-a-zip", email: "not-an-email" } }),
      reviewerAssigned: true,
    });
    expect(assessment.readiness).toBe("APPROVE_WITH_WARNINGS");
    expect(assessment.blockers).toEqual([]);
    // Cleared rather than fabricated.
    expect(assessment.draft?.profile.date_of_birth).toBeNull();
    expect(assessment.draft?.profile.zip).toBeNull();
    expect(assessment.draft?.profile.email).toBeNull();
    for (const field of ["date_of_birth", "zip", "email"]) {
      expect(assessment.warnings.find((warning) => warning.field === field)?.state).toBe("REVIEW");
    }
    expect(assessment.warnings.find((warning) => warning.field === "date_of_birth")?.message).toMatch(/original source is preserved/);
  });

  it("TEST D2: an invalid optional shift value is cleared without inventing hours or days", () => {
    const assessment = assessApproval({
      mappedDraft: baseDraft({ review_fields: { shift_days: ["SOMEDAY"], shift_start_time: "99:99" } }),
      reviewerAssigned: true,
    });
    expect(assessment.readiness).toBe("APPROVE_WITH_WARNINGS");
    expect(assessment.blockers).toEqual([]);
    expect(assessment.draft?.review_fields.shift_days).toBeNull();
    expect(assessment.draft?.review_fields.shift_start_time).toBeNull();
  });

  it("TEST D3: an out-of-domain value on a value-checked column is cleared, not persisted", () => {
    const assessment = assessApproval({
      mappedDraft: baseDraft({ profile: { preferred_language: "em", english_proficiency: "SORT OF" } }),
      reviewerAssigned: true,
    });
    expect(assessment.readiness).toBe("APPROVE_WITH_WARNINGS");
    expect(assessment.draft?.profile.preferred_language).toBeNull();
    expect(assessment.draft?.profile.english_proficiency).toBeNull();
  });

  // Required canonical identity is still a real blocker.
  it("blocks when canonical identity cannot be established", () => {
    for (const bad of [{ full_name: "" }, { phone: "" }, { phone: "123" }]) {
      const assessment = assessApproval({ mappedDraft: baseDraft({ profile: bad }), reviewerAssigned: true });
      expect(assessment.readiness, JSON.stringify(bad)).toBe("BLOCKED");
      expect(assessment.draft).toBeNull();
      expect(assessment.blockers.some((blocker) => blocker.code === "CANONICAL_TYPE")).toBe(true);
    }
  });

  // TEST E — manual authority is preserved and is not an approval requirement.
  it("TEST E: a manually reviewed value is carried through untouched and approval stays open", () => {
    const assessment = assessApproval({
      mappedDraft: baseDraft({ review_fields: { location_option_2: "Taylor" } }),
      reviewerAssigned: true,
    });
    expect(assessment.readiness).toBe("APPROVE_WITH_WARNINGS");
    expect(assessment.blockers).toEqual([]);
    expect(assessment.draft?.review_fields.location_option_2).toBe("Taylor");
    // No warning is raised for a field the reviewer has filled.
    expect(assessment.warnings.some((warning) => warning.field === "location_option_2")).toBe(false);
  });

  it("does not require a manual edit, a completed review or field completeness to approve", () => {
    const assessment = assessApproval({ mappedDraft: baseDraft(), reviewerAssigned: true, confirmationsRecorded: true });
    expect(assessment.readiness).toBe("APPROVE_WITH_WARNINGS");
    expect(assessment.blockers).toEqual([]);
  });

  it("blocks when the reviewer confirmations are not recorded, because the approved row requires both", () => {
    const assessment = assessApproval({ mappedDraft: baseDraft(), reviewerAssigned: true, confirmationsRecorded: false });
    expect(assessment.readiness).toBe("BLOCKED");
    expect(assessment.blockers.some((blocker) => /confirmation/i.test(blocker.message))).toBe(true);
  });

  // TEST F — a destructive conflict blocks, protecting duplicate safety.
  it("TEST F: a duplicate-identity conflict blocks approval", () => {
    const assessment = assessApproval({
      mappedDraft: baseDraft(),
      conflicts: [{ type: "IDENTITY", client_id: "00000000-0000-4000-8000-000000000001" }],
      reviewerAssigned: true,
    });
    expect(assessment.readiness).toBe("BLOCKED");
    expect(assessment.blockers.some((blocker) => blocker.code === "SYSTEM_CONFLICT")).toBe(true);
    expect(readinessSummary(assessment)).toMatch(/blocking conflict/);
  });

  it("blocks when no reviewer is assigned, because the approved case requires one", () => {
    const assessment = assessApproval({ mappedDraft: baseDraft(), reviewerAssigned: false });
    expect(assessment.readiness).toBe("BLOCKED");
    expect(assessment.blockers.some((blocker) => /reviewer/i.test(blocker.message))).toBe(true);
  });

  it("clears only what it must and reports exactly which fields it cleared", () => {
    const outcome = buildPersistableDraft(baseDraft({ profile: { zip: "bad", city: "DETROIT" } }));
    expect(outcome.draft?.profile.city).toBe("DETROIT");
    expect(outcome.draft?.profile.zip).toBeNull();
    expect(outcome.cleared).toEqual(["zip"]);
    expect(outcome.blocked).toEqual([]);
  });

  it("never reports a readiness it cannot back with a draft", () => {
    const blocked = assessApproval({ mappedDraft: { profile: {} }, reviewerAssigned: true });
    expect(blocked.readiness).toBe("BLOCKED");
    expect(blocked.draft).toBeNull();
  });
});
