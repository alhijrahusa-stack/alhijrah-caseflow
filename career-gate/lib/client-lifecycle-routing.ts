import { canTransition, DEFAULT_NEXT_STEP, STATUSES, type Status } from "@/lib/domain";
import type { ClientStageFilter } from "@/lib/client-lifecycle-filters";

export type RoutingEvidence = {
  current_status: string;
  account_ready: boolean;
  documents_ready: boolean;
  interview_scheduled: boolean;
  interview_passed: boolean;
  payment_verified: boolean;
  paperwork_complete?: boolean;
};

export type RoutingDecision = {
  status: Status;
  pipelineStage: string;
  nextStep: string;
  transitionPath?: Status[];
};

export class LifecycleRoutingError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "LifecycleRoutingError";
  }
}

const POST_HIRE: readonly string[] = ["pre_hire_completed", "screening_pending", "i9_available", "post_hire_tasks", "ready_for_first_day"];

export function resolveLifecycleRoute(stage: ClientStageFilter, evidence: RoutingEvidence): RoutingDecision {
  const current = evidence.current_status as Status;
  if (stage === "completed") {
    if (!evidence.payment_verified || !evidence.paperwork_complete)
      throw new LifecycleRoutingError("completion_required", "Verify payment and complete every post-interview item before closing the file");
    if (current !== "ready_for_first_day" && current !== "completed")
      throw new LifecycleRoutingError("reconciliation_required", "Use Reconcile workflow to recover a completed file from an earlier stage");
    return { status: "completed", pipelineStage: "completed_files", nextStep: DEFAULT_NEXT_STEP.completed };
  }
  if (!(STATUSES as readonly string[]).includes(current) || current === "completed" || current === "cancelled") {
    throw new LifecycleRoutingError("closed_case", "Completed, cancelled, or invalid cases cannot be bulk-routed");
  }

  let target: Status = current;
  let pipelineStage: string;
  switch (stage) {
    case "new_intake":
      if (!["new_intake", "needs_review"].includes(current)) {
        throw new LifecycleRoutingError("approval_required", "Return to intake requires a verified review action");
      }
      pipelineStage = "portal_intake";
      break;
    case "account_setup":
      if (["new_intake", "needs_review"].includes(current)) target = "ready_to_apply";
      if (!["ready_to_apply", "application_in_progress", "assessment_required"].includes(target)) {
        throw new LifecycleRoutingError("approval_required", "Approve and verify the intake before account setup");
      }
      if (evidence.account_ready) {
        throw new LifecycleRoutingError("account_already_ready", "This client already has a READY Amazon account");
      }
      pipelineStage = "no_amazon_account";
      break;
    case "job_ready":
      if (!evidence.account_ready || !evidence.documents_ready) {
        throw new LifecycleRoutingError("requirements_missing", "A READY Amazon account and verified requirements are necessary for Job Ready");
      }
      if (["new_intake","needs_review","ready_to_apply","application_in_progress","assessment_required"].includes(current)) target = "shift_selected";
      if (!["shift_selected", "appointment_required"].includes(target)) {
        throw new LifecycleRoutingError("invalid_stage", "Complete application and assessment before Job Ready");
      }
      pipelineStage = "amazon_account_waiting_job";
      break;
    case "appointments":
      if (!evidence.interview_scheduled) {
        throw new LifecycleRoutingError("appointment_required", "Book an actual employment interview before moving to Appointments");
      }
      if (current === "shift_selected" || current === "appointment_required") target = "appointment_scheduled";
      if (target !== "appointment_scheduled") {
        throw new LifecycleRoutingError("invalid_stage", "The client is not eligible for an interview stage");
      }
      pipelineStage = "interview_scheduled";
      break;
    case "payment_required":
      if (!evidence.interview_passed || evidence.payment_verified) {
        throw new LifecycleRoutingError("interview_or_payment_required", "Payment Required needs a recorded Pass and an unpaid verified account");
      }
      if (current === "appointment_scheduled") target = "pre_hire_completed";
      if (target !== "pre_hire_completed") {
        throw new LifecycleRoutingError("invalid_stage", "The interview must have been completed before payment");
      }
      pipelineStage = "payment_required";
      break;
    case "paperwork_pending":
      if (!evidence.interview_passed || !POST_HIRE.includes(current)) {
        throw new LifecycleRoutingError("interview_required", "A recorded Pass is required before post-interview preparation");
      }
      if (current === "pre_hire_completed") target = "screening_pending";
      pipelineStage = "post_interview_completion";
      break;
  }
  let transitionPath:Status[]|undefined;
  if (target !== current && !canTransition(current, target)) {
    if(stage==='job_ready' && ['new_intake','needs_review','ready_to_apply'].includes(current))
      transitionPath=current==='ready_to_apply'?['application_in_progress','shift_selected']:['ready_to_apply','application_in_progress','shift_selected'];
    else throw new LifecycleRoutingError("invalid_transition", `Illegal lifecycle transition: ${current} → ${target}`);
  }
  return { status: target, pipelineStage, nextStep: target === current ? "" : DEFAULT_NEXT_STEP[target], ...(transitionPath?{transitionPath}:{}) };
}

/**
 * Authorized skip: the status each stage starts at when a manager moves a file
 * there without its prerequisites. The evidence-gated route above stays the
 * default; a skip is explicit, single-client and recorded with its reason.
 * Appointments needs a real interview booking, so a skip there goes through the
 * interview booking override instead. Closing a file is never skipped: it
 * depends on a settled ledger.
 */
const OVERRIDE_ENTRY: Record<Exclude<ClientStageFilter, "appointments" | "completed">, { status: Status; pipelineStage: string }> = {
  new_intake: { status: "new_intake", pipelineStage: "portal_intake" },
  account_setup: { status: "ready_to_apply", pipelineStage: "no_amazon_account" },
  job_ready: { status: "shift_selected", pipelineStage: "amazon_account_waiting_job" },
  payment_required: { status: "pre_hire_completed", pipelineStage: "payment_required" },
  paperwork_pending: { status: "screening_pending", pipelineStage: "post_interview_completion" },
};

export const OVERRIDE_REASON_MIN = 10;

export function resolveOverrideRoute(stage: ClientStageFilter, currentStatus: string): RoutingDecision {
  const current = currentStatus as Status;
  if (stage === "completed") {
    throw new LifecycleRoutingError("completion_not_overridable", "Closing a file cannot be skipped: it requires a settled ledger and completed post-interview items");
  }
  if (stage === "appointments") {
    throw new LifecycleRoutingError("override_requires_booking", "Moving to Appointments needs a real interview: book it with the Job Ready override");
  }
  if (!(STATUSES as readonly string[]).includes(current) || current === "completed" || current === "cancelled") {
    throw new LifecycleRoutingError("closed_case", "Completed, cancelled, or invalid cases cannot be moved");
  }
  const entry = OVERRIDE_ENTRY[stage];
  return { status: entry.status, pipelineStage: entry.pipelineStage, nextStep: entry.status === current ? "" : DEFAULT_NEXT_STEP[entry.status] };
}
