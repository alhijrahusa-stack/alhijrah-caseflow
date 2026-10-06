import { describe, expect, it } from "vitest";
import { COMMISSION_OWNER_FIELD, commissionAmount, resolveCommissionOwner } from "@/lib/accounting-commission";

/**
 * LOCKED BUSINESS RULE — COMMISSION_OWNER = APPLICATION_COMPLETED_BY
 *
 * These tests fix the rule in place: the owner comes from the recorded
 * application completion and from nothing else, whatever other staff
 * identifiers are present on the record.
 */
describe("commission ownership", () => {
  it("names application_completed_by as the only owner field", () => {
    expect(COMMISSION_OWNER_FIELD).toBe("application_completed_by");
  });

  it("resolves the owner from the recorded application completion", () => {
    expect(resolveCommissionOwner({ application_completed_by: "staff-A" })).toEqual({ employeeId: "staff-A" });
  });

  it("refuses to fall back to any other staff identifier on the record", () => {
    const decoys = {
      application_completed_by: null,
      assigned_staff: "staff-B",
      commission_staff_id: "staff-C",
      recorded_by: "staff-D",
      receipt_uploaded_by: "staff-E",
      updated_by: "staff-F",
      session_staff_id: "staff-G",
    };
    const resolved = resolveCommissionOwner(decoys);
    expect(resolved).toEqual({ employeeId: null, reason: "APPLICATION_NOT_COMPLETED" });
  });

  it("reports no owner rather than guessing when nothing is recorded", () => {
    for (const input of [null, undefined, {}, { application_completed_by: null }, { application_completed_by: "" }]) {
      expect(resolveCommissionOwner(input), JSON.stringify(input)).toEqual({
        employeeId: null,
        reason: "APPLICATION_NOT_COMPLETED",
      });
    }
  });

  it("calculates the commission from the net fee the client actually owes", () => {
    expect(commissionAmount({ commission_type: "fixed", commission_value: 25 }, 120)).toBe(25);
    expect(commissionAmount({ commission_type: "percent", commission_value: 10 }, 150)).toBe(15);
    // A discount reduces the basis, so the commission follows the money.
    expect(commissionAmount({ commission_type: "percent", commission_value: 10 }, 120)).toBe(12);
    expect(commissionAmount({ commission_type: "percent", commission_value: 12.5 }, 150)).toBe(18.75);
  });
});
