import { canTransition, type Status } from "@/lib/domain";

const OVERRIDABLE_EARLY_STATUSES: readonly string[] = [
  "new_intake", "needs_review", "ready_to_apply", "application_in_progress", "assessment_required",
];

export function appointmentLifecycleDecision(status: string, reason?: string | null): "normal" | "override" | "reason_required" | "ineligible" {
  if (status === "appointment_scheduled" || canTransition(status as Status, "appointment_scheduled")) return "normal";
  if (!OVERRIDABLE_EARLY_STATUSES.includes(status)) return "ineligible";
  return reason && reason.trim().length >= 5 ? "override" : "reason_required";
}
