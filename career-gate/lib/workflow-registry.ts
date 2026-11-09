import type { Status } from "@/lib/domain";

const POST_HIRE_STATUSES = ["pre_hire_completed", "screening_pending", "i9_available", "post_hire_tasks", "ready_for_first_day"] as const;

/** Shared metadata for navigation, filtering and manual destinations. Urgency
 * is a separate flag and deliberately never appears in this list. */
export const WORKFLOW_DESTINATIONS = [
  { id: "new_intake", groupId: "intake", kind: "stage", label: "New Intake", labelAr: "الاستقبال والتدقيق", href: "/staff/clients?stage=new_intake", statuses: ["new_intake", "needs_review"], entryStatus: "new_intake", pipelineStage: "portal_intake" },
  { id: "account_setup", groupId: "account", kind: "stage", label: "Account Setup", labelAr: "تجهيز الحساب", href: "/staff/clients?stage=account_setup", statuses: ["ready_to_apply", "application_in_progress", "assessment_required"], entryStatus: "ready_to_apply", pipelineStage: "no_amazon_account" },
  { id: "job_ready", groupId: "job", kind: "stage", label: "Job Ready", labelAr: "جاهز للوظيفة", href: "/staff/clients?stage=job_ready", statuses: ["shift_selected", "appointment_required"], entryStatus: "shift_selected", pipelineStage: "amazon_account_waiting_job" },
  { id: "appointments", groupId: "appointments", kind: "stage", label: "Appointments", labelAr: "المواعيد والمقابلات", href: "/staff/appointments", statuses: ["appointment_scheduled"], entryStatus: "appointment_scheduled", pipelineStage: "interview_scheduled" },
  { id: "payment_required", groupId: "paperwork", kind: "stage", label: "Payment Required", labelAr: "الرسوم المطلوبة", href: "/staff/clients?stage=payment_required", statuses: POST_HIRE_STATUSES, entryStatus: "pre_hire_completed", pipelineStage: "payment_required" },
  { id: "paperwork_pending", groupId: "paperwork", kind: "stage", label: "Paperwork Pending", labelAr: "استكمال الوثائق", href: "/staff/clients?stage=paperwork_pending", statuses: POST_HIRE_STATUSES, entryStatus: "screening_pending", pipelineStage: "post_interview_completion" },
  { id: "completed", groupId: "registry", kind: "registry", label: "Confirmed Employment & Records", labelAr: "سجل المباشرة والملفات", href: "/staff/clients?view=completed", statuses: ["completed"], entryStatus: "completed", pipelineStage: "completed_files" },
  { id: "worksite_change", groupId: null, kind: "special", label: "Worksite Changes", labelAr: "تغيير موقع العمل · قسم صلاح المريسي", href: "/staff/worksite-changes", statuses: [], entryStatus: "pre_hire_completed", pipelineStage: "worksite_change" },
] as const satisfies readonly {
  id: string; groupId: string | null; kind: "stage" | "registry" | "special";
  label: string; labelAr: string; href: string; statuses: readonly Status[];
  entryStatus: Status; pipelineStage: string;
}[];

export type WorkflowDestination = (typeof WORKFLOW_DESTINATIONS)[number]["id"];
export const WORKFLOW_DESTINATION_IDS: readonly string[] = WORKFLOW_DESTINATIONS.map(destination => destination.id);
export function isWorkflowDestination(value: unknown): value is WorkflowDestination {
  return typeof value === "string" && WORKFLOW_DESTINATION_IDS.includes(value);
}

function statusesFor(destinations: readonly WorkflowDestination[]): readonly Status[] {
  return [...new Set<Status>(WORKFLOW_DESTINATIONS.filter(destination => destinations.includes(destination.id)).flatMap(destination => [...destination.statuses]))];
}

export function workflowDestination<Id extends WorkflowDestination>(id: Id) {
  const destination = WORKFLOW_DESTINATIONS.find(item => item.id === id);
  if (!destination) throw new Error(`Unknown workflow destination: ${id}`);
  return destination as Extract<(typeof WORKFLOW_DESTINATIONS)[number], { id: Id }>;
}

function singleDestination<Id extends WorkflowDestination>(id: Id) {
  const destination = workflowDestination(id);
  return { label: destination.label, labelAr: destination.labelAr, href: destination.href, destinations: [id] as const, statuses: statusesFor([id]) };
}

export const WORKFLOW_GROUPS = [
  { id: "intake", ...singleDestination("new_intake"), action: "Review new clients", sidebarOnly: false },
  { id: "account", ...singleDestination("account_setup"), action: "Manage clients missing Amazon accounts", sidebarOnly: false },
  { id: "job", ...singleDestination("job_ready"), action: "Open job-ready clients", sidebarOnly: false },
  { id: "appointments", ...singleDestination("appointments"), action: "Manage interviews", sidebarOnly: false },
  { id: "paperwork", label: "Payment & Paperwork", labelAr: "الدفع واستكمال الوثائق", href: "/staff/clients?group=paperwork", destinations: ["payment_required", "paperwork_pending"], statuses: statusesFor(["payment_required", "paperwork_pending"]), action: "Verify payments and finish paperwork", sidebarOnly: false },
  { id: "registry", ...singleDestination("completed"), action: "Review final records and confirm actual work starts", sidebarOnly: true },
] as const;

export type WorkflowGroupId = (typeof WORKFLOW_GROUPS)[number]["id"];
export const ACTIVE_WORKFLOW_GROUPS = WORKFLOW_GROUPS.filter(group => !group.sidebarOnly);
export const SPECIAL_WORKFLOW_DESTINATIONS = WORKFLOW_DESTINATIONS.filter(destination => destination.kind === "special");
export const PRIORITY_VIEW = { id: "urgent", label: "Urgent", labelAr: "أولوية قصوى", href: "/staff/clients?urgent=1" } as const;

/** Cancelled records stay in All Records, not in confirmed employment. */
export function workflowGroupForStatus(status: string): WorkflowGroupId | null {
  return WORKFLOW_GROUPS.find(group => group.statuses.includes(status as Status))?.id ?? null;
}
