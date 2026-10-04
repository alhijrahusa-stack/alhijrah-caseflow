export const STAFF_PERMISSION_REGISTRY = [
  { key: "create_client", label: "Create client", group: "Clients" },
  { key: "update_client", label: "Update client", group: "Clients" },
  { key: "patch_client", label: "Edit client fields", group: "Clients" },
  { key: "update_status", label: "Update workflow status", group: "Workflow" },
  { key: "override_status", label: "Override workflow status", group: "Workflow" },
  { key: "set_next_step", label: "Set next step", group: "Workflow" },
  { key: "add_preference", label: "Add client preference", group: "Clients" },
  { key: "remove_preference", label: "Remove client preference", group: "Clients" },
  { key: "schedule_appointment", label: "Schedule appointment", group: "Scheduling" },
  { key: "book_slot", label: "Book appointment slot", group: "Scheduling" },
  { key: "update_appointment", label: "Update appointment", group: "Scheduling" },
  { key: "add_note", label: "Add note", group: "Operations" },
  { key: "add_task", label: "Add task", group: "Operations" },
  { key: "update_task", label: "Update task", group: "Operations" },
  { key: "complete_task", label: "Complete task", group: "Operations" },
  { key: "assign_staff", label: "Assign staff", group: "Operations" },
  { key: "mark_contacted", label: "Record contact", group: "Operations" },
  { key: "add_followup", label: "Add follow-up", group: "Operations" },
  { key: "complete_followup", label: "Complete follow-up", group: "Operations" },
  { key: "verify_document", label: "Verify document", group: "Document Review" },
  { key: "reject_document", label: "Reject document", group: "Document Review" },
  { key: "request_reupload", label: "Request document re-upload", group: "Document Review" },
  { key: "process_document", label: "Process/review document", group: "Document Review" },
  { key: "update_assessment", label: "Update assessment", group: "Assessment" },
  { key: "add_standard_assessments", label: "Add standard assessments", group: "Assessment" },
  { key: "update_post_hire", label: "Update post-hire item", group: "Post-Hire" },
  { key: "run_intake_agent", label: "Run intake analysis", group: "Automation" },
  { key: "send_notification", label: "Send notification", group: "Communications" },
  { key: "record_transaction", label: "Record financial transaction", group: "Finance" },
  { key: "approve_commission", label: "Approve commission", group: "Finance" },
  { key: "pay_commission", label: "Mark commission paid", group: "Finance" },
  { key: "cancel_commission", label: "Cancel commission", group: "Finance" },
  { key: "reverse_commission", label: "Reverse commission", group: "Finance" },
  { key: "soft_delete_client", label: "Soft-delete client", group: "Clients" },
  { key: "create_staff", label: "Create staff account", group: "Staff Administration" },
  { key: "update_staff_role", label: "Change staff role", group: "Staff Administration" },
  { key: "disable_staff", label: "Disable staff account", group: "Staff Administration" },
  { key: "reactivate_staff", label: "Reactivate staff account", group: "Staff Administration" },
  { key: "invite_staff", label: "Invite staff", group: "Staff Administration" },
  { key: "manage_staff_permissions", label: "Manage staff permissions", group: "Staff Administration" },
  { key: "upsert_availability", label: "Manage availability", group: "Scheduling" },
  { key: "delete_availability", label: "Delete availability", group: "Scheduling" },
  { key: "add_blocked_period", label: "Add blocked period", group: "Scheduling" },
  { key: "remove_blocked_period", label: "Remove blocked period", group: "Scheduling" },
  { key: "resolve_alert", label: "Resolve audit alert", group: "Audit" },
  { key: "ignore_alert", label: "Ignore audit alert", group: "Audit" },
  { key: "run_audit_scan", label: "Run audit scan", group: "Audit" },
  { key: "upload_document", label: "Upload document", group: "Documents" },
  { key: "view_document", label: "View document", group: "Documents" },
] as const;

export type StaffPermission = (typeof STAFF_PERMISSION_REGISTRY)[number]["key"];
export type PermissionMode = "full" | "custom";

export const STAFF_PERMISSION_KEYS = STAFF_PERMISSION_REGISTRY.map((entry) => entry.key) as StaffPermission[];
const STAFF_PERMISSION_SET = new Set<string>(STAFF_PERMISSION_KEYS);

export function isStaffPermission(value: string): value is StaffPermission {
  return STAFF_PERMISSION_SET.has(value);
}

export function normalizePermissions(values: readonly string[]): StaffPermission[] {
  return [...new Set(values.filter(isStaffPermission))].sort() as StaffPermission[];
}

export function permissionAllows(mode: PermissionMode, selected: readonly string[], permission: StaffPermission): boolean {
  return mode === "full" || selected.includes(permission);
}

export function effectivePermissions(mode: PermissionMode, selected: readonly string[]): StaffPermission[] {
  return mode === "full" ? [...STAFF_PERMISSION_KEYS] : normalizePermissions(selected);
}
