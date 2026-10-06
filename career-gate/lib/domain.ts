export const STATUSES = [
  "new_intake",
  "needs_review",
  "ready_to_apply",
  "application_in_progress",
  "assessment_required",
  "shift_selected",
  "appointment_required",
  "appointment_scheduled",
  "pre_hire_completed",
  "screening_pending",
  "i9_available",
  "post_hire_tasks",
  "ready_for_first_day",
  "completed",
  "cancelled",
] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  new_intake: "New Intake",
  needs_review: "Needs Review",
  ready_to_apply: "Ready to Apply",
  application_in_progress: "Application in Progress",
  assessment_required: "Assessment Required",
  shift_selected: "Shift Selected",
  appointment_required: "Appointment Required",
  appointment_scheduled: "Appointment Scheduled",
  pre_hire_completed: "Pre-Hire Completed",
  screening_pending: "Screening Pending",
  i9_available: "I-9 Available",
  post_hire_tasks: "Post-Hire Tasks",
  ready_for_first_day: "Ready for First Day",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Allowed transitions. Mirrors public.status_transitions (verified by tests). */
export const TRANSITIONS: Record<Status, Status[]> = {
  new_intake: ["needs_review", "ready_to_apply", "cancelled"],
  needs_review: ["ready_to_apply", "cancelled"],
  ready_to_apply: ["application_in_progress", "needs_review", "cancelled"],
  application_in_progress: ["assessment_required", "shift_selected", "appointment_required", "needs_review", "cancelled"],
  assessment_required: ["shift_selected", "application_in_progress", "cancelled"],
  shift_selected: ["appointment_required", "appointment_scheduled", "cancelled"],
  appointment_required: ["appointment_scheduled", "cancelled"],
  appointment_scheduled: ["pre_hire_completed", "appointment_required", "cancelled"],
  pre_hire_completed: ["screening_pending", "cancelled"],
  screening_pending: ["i9_available", "cancelled"],
  i9_available: ["post_hire_tasks", "cancelled"],
  post_hire_tasks: ["ready_for_first_day", "cancelled"],
  ready_for_first_day: ["completed", "post_hire_tasks", "cancelled"],
  completed: [],
  cancelled: ["needs_review"],
};
export const ENTRY_STATUSES: Status[] = ["new_intake", "needs_review", "ready_to_apply"];

/** Main path used to draw the expected-next part of the status timeline. */
export const MAIN_PATH: Status[] = [
  "new_intake", "needs_review", "ready_to_apply", "application_in_progress", "assessment_required",
  "shift_selected", "appointment_required", "appointment_scheduled", "pre_hire_completed",
  "screening_pending", "i9_available", "post_hire_tasks", "ready_for_first_day", "completed",
];

export function canTransition(from: Status, to: Status) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Suggested next step when a status is chosen; staff may overwrite it. */
export const DEFAULT_NEXT_STEP: Record<Status, string> = {
  new_intake: "Office will review your application.",
  needs_review: "Office will review your information and documents.",
  ready_to_apply: "Office will submit your application.",
  application_in_progress: "Your application is being submitted.",
  assessment_required: "Complete the employer assessment.",
  shift_selected: "Wait for pre-hire appointment details.",
  appointment_required: "Office will schedule your appointment.",
  appointment_scheduled: "Attend your scheduled appointment.",
  pre_hire_completed: "Wait for screening results.",
  screening_pending: "Wait for screening results.",
  i9_available: "Complete your I-9 documents.",
  post_hire_tasks: "Complete remaining post-hire tasks.",
  ready_for_first_day: "Report for your first day.",
  completed: "No further action needed.",
  cancelled: "No further action needed.",
};

export const APPOINTMENT_STATUSES = ["scheduled", "confirmed", "attended", "missed", "rescheduled", "cancelled"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
/** Statuses that still represent an upcoming visit. */
export const OPEN_APPOINTMENT: readonly AppointmentStatus[] = ["scheduled", "confirmed", "rescheduled"];

export const TASK_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export const CONTACT_METHODS = ["call", "whatsapp", "email", "in_person"] as const;
export const CONTACT_LABELS: Record<(typeof CONTACT_METHODS)[number], string> = {
  call: "Call",
  whatsapp: "WhatsApp",
  email: "Email",
  in_person: "In Person",
};

export const DOC_STATUSES = ["pending", "processing", "needs_reupload", "needs_review", "verified", "rejected"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];
export const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  pending: "Pending",
  processing: "Processing",
  needs_reupload: "Needs re-upload",
  needs_review: "Needs review",
  verified: "Verified",
  rejected: "Rejected",
};

export const DOC_TYPES = ["photo_id", "work_authorization", "social_security_card", "resume", "other"] as const;
export const DOC_LABELS: Record<(typeof DOC_TYPES)[number], string> = {
  photo_id: "Photo ID",
  work_authorization: "Work authorization",
  social_security_card: "Social Security card",
  resume: "Resume",
  other: "Other",
};
export const DOC_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
/** Under Vercel's 4.5 MB request body limit. */
export const DOC_MAX_BYTES = 4 * 1024 * 1024;

export const POST_HIRE_ITEMS = [
  "assessment",
  "shift_selection",
  "pre_hire_appointment",
  "screening",
  "i9_available",
  "i9_completion",
  "safety_shoes",
  "employment_paperwork",
  "a_to_z",
  "start_date",
  "ready_for_first_day",
] as const;
export const POST_HIRE_LABELS: Record<(typeof POST_HIRE_ITEMS)[number], string> = {
  assessment: "Assessment",
  shift_selection: "Shift Selection",
  pre_hire_appointment: "Pre-Hire Appointment",
  screening: "Screening",
  i9_available: "I-9 Available",
  i9_completion: "I-9 Assistance / Completion",
  safety_shoes: "Safety Shoes",
  employment_paperwork: "Employment Paperwork",
  a_to_z: "A to Z",
  start_date: "Start Date",
  ready_for_first_day: "Ready for First Day",
};
export const POST_HIRE_STATUSES = ["not_started", "pending", "confirmed", "completed", "not_required", "blocked"] as const;
export const POST_HIRE_STATUS_LABELS: Record<(typeof POST_HIRE_STATUSES)[number], string> = {
  not_started: "Not started",
  pending: "Pending",
  confirmed: "Confirmed",
  completed: "Completed",
  not_required: "Not required",
  blocked: "Blocked",
};

export const ENGLISH_PROFICIENCY_VALUES = ["EXCELLENT", "GOOD", "FAIR", "WEAK", "NONE"] as const;

export const LANGUAGES = { en: "English", ar: "العربية", es: "Español" } as const;

export const ROLES = ["admin", "manager", "staff"] as const;
export type Role = (typeof ROLES)[number];

export const ASSESSMENT_STATUSES = ["pending", "in_progress", "completed", "unresolved", "not_required"] as const;
export const ASSESSMENT_SOURCES = ["client_confirmed", "client_document", "staff_observed"] as const;
export const ASSESSMENT_SOURCE_LABELS: Record<(typeof ASSESSMENT_SOURCES)[number], string> = {
  client_confirmed: "Client confirmed",
  client_document: "Client document",
  staff_observed: "Staff observed",
};

/** Standard items staff can add as UNRESOLVED until the client confirms them. */
export const STANDARD_ASSESSMENT_ITEMS: { assessment_type: string; item_key: string; prompt_reference: string }[] = [
  { assessment_type: "application_profile", item_key: "education", prompt_reference: "Highest education completed" },
  { assessment_type: "application_profile", item_key: "friends_family_at_amazon", prompt_reference: "Friends or family working at Amazon" },
  { assessment_type: "application_profile", item_key: "time_not_working", prompt_reference: "Time not working" },
  { assessment_type: "application_profile", item_key: "job_title_type", prompt_reference: "Most recent job title / type" },
  { assessment_type: "amazon_assessment", item_key: "item_10", prompt_reference: "Assessment item 10" },
  { assessment_type: "amazon_assessment", item_key: "item_22", prompt_reference: "Assessment item 22" },
];

export const CHANNELS = ["whatsapp", "sms", "email"] as const;
export type Channel = (typeof CHANNELS)[number];
