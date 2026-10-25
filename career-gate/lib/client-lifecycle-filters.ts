export const CLIENT_STAGES = [
  { id: "new_intake", label: "New Intake", labelAr: "العملاء الجدد", href: "/staff/clients?stage=new_intake" },
  { id: "account_setup", label: "Account Setup", labelAr: "بلا حساب Amazon جاهز", href: "/staff/clients?stage=account_setup" },
  { id: "job_ready", label: "Job Ready", labelAr: "مؤهل للوظيفة", href: "/staff/clients?stage=job_ready" },
  { id: "appointments", label: "Appointments", labelAr: "المقابلات", href: "/staff/appointments" },
  { id: "payment_required", label: "Payment Required", labelAr: "رسوم المكتب", href: "/staff/clients?stage=payment_required" },
  { id: "paperwork_pending", label: "Paperwork Pending", labelAr: "الوثائق النهائية", href: "/staff/clients?stage=paperwork_pending" },
] as const;

export type ClientStageFilter = (typeof CLIENT_STAGES)[number]["id"];
export const CLIENT_STAGE_IDS: readonly string[] = CLIENT_STAGES.map(stage => stage.id);

export function isClientStageFilter(value: unknown): value is ClientStageFilter {
  return typeof value === "string" && CLIENT_STAGE_IDS.includes(value);
}

export const ACCOUNT_SETUP_STATUSES = ["ready_to_apply", "application_in_progress", "assessment_required", "shift_selected", "appointment_required"] as const;
export const JOB_READY_STATUSES = ["shift_selected", "appointment_required"] as const;
export const PAPERWORK_STATUSES = ["pre_hire_completed", "screening_pending", "i9_available", "post_hire_tasks", "ready_for_first_day"] as const;

export const BULK_STAGE_LABELS: Record<ClientStageFilter, string> = Object.fromEntries(
  CLIENT_STAGES.map(stage => [stage.id, stage.label])
) as Record<ClientStageFilter, string>;
