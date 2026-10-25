import { STATUSES, type Status } from "@/lib/domain";

export const G3_STAGES = [
  {
    id: "intake",
    label: "New Intake",
    labelAr: "الاستقبال والتدقيق",
    statuses: ["new_intake", "needs_review"],
    href: "/staff/clients?stage=new_intake",
    action: "Review new clients",
  },
  {
    id: "account",
    label: "Account Setup",
    labelAr: "تجهيز الحساب",
    statuses: ["ready_to_apply", "application_in_progress", "assessment_required"],
    href: "/staff/clients?stage=account_setup",
    action: "Manage clients missing Amazon accounts",
  },
  {
    id: "job",
    label: "Job Ready",
    labelAr: "جاهز للوظيفة",
    statuses: ["shift_selected", "appointment_required"],
    href: "/staff/clients?stage=job_ready",
    action: "Open job-ready clients",
  },
  {
    id: "appointments",
    label: "Appointments",
    labelAr: "المواعيد والمقابلات",
    statuses: ["appointment_scheduled"],
    href: "/staff/appointments",
    action: "Manage interviews",
  },
  {
    id: "paperwork",
    label: "Payment & Paperwork",
    labelAr: "الدفع واستكمال الوثائق",
    statuses: ["pre_hire_completed", "screening_pending", "i9_available", "post_hire_tasks", "ready_for_first_day"],
    href: "/staff/clients?stage=payment_required",
    action: "Verify payments and finish paperwork",
  },
  {
    id: "registry",
    label: "Master Registry",
    labelAr: "السجل والأرشيف",
    statuses: ["completed", "cancelled"],
    href: "/staff/clients?view=all",
    action: "Open full registry",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  labelAr: string;
  statuses: readonly Status[];
  href: string;
  action: string;
}>;

export type G3StageId = (typeof G3_STAGES)[number]["id"];

const statusToStage = new Map<Status, G3StageId>(
  G3_STAGES.flatMap(stage => stage.statuses.map(status => [status, stage.id] as const)),
);

if (statusToStage.size !== STATUSES.length) {
  throw new Error("G3 stage mapping must classify every canonical status exactly once");
}

export function g3StageForStatus(status: string): G3StageId | null {
  return statusToStage.get(status as Status) ?? null;
}

export function g3Counts(statusCounts: readonly { status: string; total: number }[]) {
  return G3_STAGES.map(stage => ({
    ...stage,
    total: statusCounts.reduce((total, item) => total + (g3StageForStatus(item.status) === stage.id ? item.total : 0), 0),
  }));
}
