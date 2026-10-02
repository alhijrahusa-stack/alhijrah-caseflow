import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";
import { DEFAULT_NEXT_STEP, type Status } from "@/lib/domain";

export type NextActionOwner = "staff" | "client" | "system" | "none";
export type NextActionUrgency = "critical" | "high" | "normal" | "none";
export type NextActionBlocker = {
  code: "requirement" | "document_reupload" | "document_review" | "overdue_task" | "overdue_followup";
  label: string;
  severity: "critical" | "high" | "medium";
};

export type ClientNextAction = {
  blockers: NextActionBlocker[];
  next_safe_action: string;
  action_owner: NextActionOwner;
  urgency: NextActionUrgency;
  due_at: string | null;
  supporting_reason: string;
  allowed_automation: null;
};

export type NextActionSnapshot = {
  current_status: Status;
  next_step: string | null;
  requirement_title: string | null;
  requirement_status: string | null;
  document_name: string | null;
  document_status: string | null;
  overdue_task_title: string | null;
  overdue_task_due_at: string | null;
  overdue_followup_reason: string | null;
  overdue_followup_due_date: string | null;
  next_appointment_at: string | null;
};

export function deriveNextAction(s: NextActionSnapshot): ClientNextAction {
  if (s.current_status === "completed" || s.current_status === "cancelled") {
    return {
      blockers: [],
      next_safe_action: s.next_step?.trim() || DEFAULT_NEXT_STEP[s.current_status],
      action_owner: "none",
      urgency: "none",
      due_at: null,
      supporting_reason: "Workflow is in a terminal state.",
      allowed_automation: null,
    };
  }

  if (s.overdue_task_title) {
    return {
      blockers: [{ code: "overdue_task", label: s.overdue_task_title, severity: "critical" }],
      next_safe_action: `Complete overdue task: ${s.overdue_task_title}`,
      action_owner: "staff",
      urgency: "critical",
      due_at: s.overdue_task_due_at,
      supporting_reason: "An open assigned task is past due.",
      allowed_automation: null,
    };
  }

  if (s.overdue_followup_reason) {
    return {
      blockers: [{ code: "overdue_followup", label: s.overdue_followup_reason, severity: "critical" }],
      next_safe_action: `Complete overdue follow-up: ${s.overdue_followup_reason}`,
      action_owner: "staff",
      urgency: "critical",
      due_at: s.overdue_followup_due_date,
      supporting_reason: "A required client follow-up is past due.",
      allowed_automation: null,
    };
  }

  if (s.requirement_title && s.requirement_status && ["missing", "rejected", "expired"].includes(s.requirement_status)) {
    return {
      blockers: [{ code: "requirement", label: s.requirement_title, severity: "high" }],
      next_safe_action: `Resolve requirement: ${s.requirement_title}`,
      action_owner: "staff",
      urgency: "high",
      due_at: null,
      supporting_reason: `Requirement is ${s.requirement_status.replace(/_/g, " ")}.`,
      allowed_automation: null,
    };
  }

  if (s.document_status === "needs_reupload") {
    return {
      blockers: [{ code: "document_reupload", label: s.document_name ?? "Document", severity: "high" }],
      next_safe_action: `Request re-upload: ${s.document_name ?? "document"}`,
      action_owner: "client",
      urgency: "high",
      due_at: null,
      supporting_reason: "The latest document cannot proceed without a replacement upload.",
      allowed_automation: null,
    };
  }

  if (s.document_status === "needs_review" || s.document_status === "rejected") {
    return {
      blockers: [{ code: "document_review", label: s.document_name ?? "Document", severity: "medium" }],
      next_safe_action: `Review document: ${s.document_name ?? "document"}`,
      action_owner: "staff",
      urgency: "normal",
      due_at: null,
      supporting_reason: `Latest document status is ${s.document_status.replace(/_/g, " ")}.`,
      allowed_automation: null,
    };
  }

  if (s.next_appointment_at) {
    return {
      blockers: [],
      next_safe_action: "Prepare for the next scheduled appointment.",
      action_owner: "staff",
      urgency: "normal",
      due_at: s.next_appointment_at,
      supporting_reason: "An upcoming appointment is already scheduled.",
      allowed_automation: null,
    };
  }

  return {
    blockers: [],
    next_safe_action: s.next_step?.trim() || DEFAULT_NEXT_STEP[s.current_status],
    action_owner: "staff",
    urgency: "normal",
    due_at: null,
    supporting_reason: "Derived from the current authoritative workflow state.",
    allowed_automation: null,
  };
}

export async function clientNextAction(session: StaffSession, clientId: string): Promise<ClientNextAction | null> {
  return withStaff(session, async (tx) => {
    const [row] = await tx`
      select
        c.current_status,
        c.next_step,
        req.title as requirement_title,
        req.status as requirement_status,
        doc.file_name as document_name,
        doc.status as document_status,
        task.title as overdue_task_title,
        task.due_at::text as overdue_task_due_at,
        followup.reason as overdue_followup_reason,
        followup.due_date::text as overdue_followup_due_date,
        appt.scheduled_at::text as next_appointment_at
      from clients c
      left join lateral (
        select r.title,r.status
        from requirements r
        where r.client_id=c.id and r.status in ('missing','rejected','expired')
        order by case r.status when 'rejected' then 0 when 'expired' then 1 else 2 end,r.due_at nulls last,r.created_at
        limit 1
      ) req on true
      left join lateral (
        select d.file_name,d.status
        from documents d
        where d.client_id=c.id and d.status in ('needs_reupload','rejected','needs_review')
        order by case d.status when 'needs_reupload' then 0 when 'rejected' then 1 else 2 end,d.uploaded_at desc,d.id desc
        limit 1
      ) doc on true
      left join lateral (
        select t.title,t.due_at
        from tasks t
        where t.client_id=c.id and t.status in ('pending','in_progress') and t.due_at is not null and t.due_at<now()
        order by t.due_at
        limit 1
      ) task on true
      left join lateral (
        select f.reason,f.due_date
        from followups f
        where f.client_id=c.id and f.status='open' and f.due_date<current_date
        order by f.due_date
        limit 1
      ) followup on true
      left join lateral (
        select a.scheduled_at
        from appointments a
        where a.client_id=c.id and a.status in ('scheduled','confirmed','rescheduled') and a.scheduled_at>=now()
        order by a.scheduled_at
        limit 1
      ) appt on true
      where c.id=${clientId} and c.deleted_at is null`;
    if (!row) return null;
    return deriveNextAction({
      current_status: row.current_status as Status,
      next_step: row.next_step as string | null,
      requirement_title: row.requirement_title as string | null,
      requirement_status: row.requirement_status as string | null,
      document_name: row.document_name as string | null,
      document_status: row.document_status as string | null,
      overdue_task_title: row.overdue_task_title as string | null,
      overdue_task_due_at: row.overdue_task_due_at as string | null,
      overdue_followup_reason: row.overdue_followup_reason as string | null,
      overdue_followup_due_date: row.overdue_followup_due_date as string | null,
      next_appointment_at: row.next_appointment_at as string | null,
    });
  });
}
