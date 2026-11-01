import { describe, expect, it } from "vitest";
import { appointmentLifecycleDecision } from "@/lib/appointment-lifecycle";

describe("appointment lifecycle guard", () => {
  it("preserves the normal transition from Job Ready", () => {
    expect(appointmentLifecycleDecision("shift_selected")).toBe("normal");
    expect(appointmentLifecycleDecision("appointment_required")).toBe("normal");
    expect(appointmentLifecycleDecision("appointment_scheduled")).toBe("normal");
  });
  it("requires a substantive reason to skip the Job Ready condition", () => {
    expect(appointmentLifecycleDecision("application_in_progress")).toBe("reason_required");
    expect(appointmentLifecycleDecision("needs_review", "    ")).toBe("reason_required");
    expect(appointmentLifecycleDecision("new_intake", "Client already has interview")).toBe("override");
  });
  it("never sends closed or later-stage cases backwards", () => {
    for (const status of ["completed", "cancelled", "pre_hire_completed", "ready_for_first_day", "unknown"])
      expect(appointmentLifecycleDecision(status, "Client already has interview")).toBe("ineligible");
  });
});
