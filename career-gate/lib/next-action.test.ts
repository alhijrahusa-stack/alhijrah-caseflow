import { describe, expect, it } from "vitest";
import { deriveNextAction, type NextActionSnapshot } from "@/lib/next-action";

const base: NextActionSnapshot = {
  current_status: "needs_review",
  next_step: "Review client information.",
  requirement_title: null,
  requirement_status: null,
  document_name: null,
  document_status: null,
  overdue_task_title: null,
  overdue_task_due_at: null,
  overdue_followup_reason: null,
  overdue_followup_due_date: null,
  next_appointment_at: null,
};

describe("deriveNextAction", () => {
  it("prioritizes overdue work before lower-priority blockers", () => {
    const action = deriveNextAction({
      ...base,
      overdue_task_title: "Call client",
      overdue_task_due_at: "2026-10-01T12:00:00Z",
      requirement_title: "Photo ID",
      requirement_status: "missing",
    });
    expect(action).toMatchObject({ action_owner: "staff", urgency: "critical", next_safe_action: "Complete overdue task: Call client" });
    expect(action.blockers[0]?.code).toBe("overdue_task");
  });

  it("derives missing requirement action deterministically", () => {
    const action = deriveNextAction({ ...base, requirement_title: "Work authorization", requirement_status: "missing" });
    expect(action).toMatchObject({ action_owner: "staff", urgency: "high", next_safe_action: "Resolve requirement: Work authorization" });
  });

  it("assigns re-upload action to the client", () => {
    const action = deriveNextAction({ ...base, document_name: "id.jpg", document_status: "needs_reupload" });
    expect(action).toMatchObject({ action_owner: "client", urgency: "high", next_safe_action: "Request re-upload: id.jpg" });
  });

  it("uses authoritative workflow next step when no blocker exists", () => {
    const action = deriveNextAction(base);
    expect(action).toMatchObject({ action_owner: "staff", urgency: "normal", next_safe_action: "Review client information." });
    expect(action.blockers).toEqual([]);
  });

  it("does not assign work for terminal states", () => {
    const action = deriveNextAction({ ...base, current_status: "completed", next_step: null });
    expect(action.action_owner).toBe("none");
    expect(action.urgency).toBe("none");
  });
});
