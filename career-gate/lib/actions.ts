import "server-only";
import { z } from "zod";
import { findOption } from "@/lib/catalog";
import {
  APPOINTMENT_STATUSES,
  ASSESSMENT_SOURCES,
  ASSESSMENT_STATUSES,
  canTransition,
  CONTACT_METHODS,
  DOC_TYPES,
  ENTRY_STATUSES,
  LANGUAGES,
  POST_HIRE_ITEMS,
  POST_HIRE_STATUSES,
  ROLES,
  STANDARD_ASSESSMENT_ITEMS,
  STATUS_LABELS,
  STATUSES,
  TASK_STATUSES,
  type Status,
} from "@/lib/domain";
import { enqueue } from "@/lib/jobs";
import { channelConfigured } from "@/lib/notify";
import { inviteUser } from "@/lib/providers/supabase-auth";
import { sendEmail, sendSms } from "@/lib/providers/messaging";
import { Phone, ProfileSchema, SelectionSchema } from "@/lib/schemas";
import { slotIsBookable } from "@/lib/scheduling";
import {
  ActionError,
  type Actor,
  insertClient,
  insertEmployment,
  insertPreference,
  logActivity,
  renumberPreferences,
  requireClient,
  requireStaffMember,
  touchClient,
  type Tx,
} from "@/lib/service";

const id = z.uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
// Partial updates: absent stays undefined (keep current), "" or null clears.
const keepText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : v || null));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const instant = z.iso.datetime({ offset: true });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const resource = z.string().regex(/^(office|staff:[0-9a-f-]{36})$/, "Invalid resource");

/** Inline-editable fields and their validators. */
export const PATCHABLE = {
  full_name: text(160).refine((v) => v.length >= 2, "Full name is required"),
  phone: Phone,
  email: z.email("Invalid email").max(200).nullable().or(z.literal("")).transform((v) => (v ? v.toLowerCase() : null)),
  date_of_birth: date.nullable().or(z.literal("")).transform((v) => v || null),
  preferred_language: z.enum(Object.keys(LANGUAGES) as [keyof typeof LANGUAGES]),
  street: optText(200),
  city: optText(100),
  state: optText(40),
  zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "ZIP must be 5 digits").nullable().or(z.literal("")).transform((v) => v || null),
  appointment_availability: optText(1000),
  next_step: text(500),
} as const;
export type PatchField = keyof typeof PATCHABLE;

export const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_client"),
    profile: ProfileSchema,
    primary: z.array(SelectionSchema).max(20).default([]),
    backup: z.array(SelectionSchema).max(20).default([]),
    status: z.enum(STATUSES),
    next_step: optText(500),
    initial_note: optText(5000),
    assigned_staff: id.nullable().optional(),
    communication_consent: z.boolean().default(false),
  }),
  z.object({ action: z.literal("update_client"), client_id: id, profile: ProfileSchema }),
  z.object({ action: z.literal("patch_client"), client_id: id, field: z.enum(Object.keys(PATCHABLE) as [PatchField]), value: z.unknown() }),
  z.object({ action: z.literal("update_status"), client_id: id, status: z.enum(STATUSES), next_step: optText(500) }),
  z.object({ action: z.literal("override_status"), client_id: id, status: z.enum(STATUSES), reason: text(500), next_step: optText(500) }),
  z.object({ action: z.literal("set_next_step"), client_id: id, next_step: text(500) }),
  z.object({ action: z.literal("add_preference"), client_id: id, rank: z.enum(["primary", "backup"]), selection: SelectionSchema }),
  z.object({ action: z.literal("remove_preference"), client_id: id, preference_id: id }),
  z.object({
    action: z.literal("schedule_appointment"),
    client_id: id,
    appointment_type: text(100),
    scheduled_at: instant,
    duration_minutes: z.number().int().min(5).max(480).default(30),
    resource_key: resource.default("office"),
    location: optText(300),
    notes: optText(2000),
  }),
  z.object({
    action: z.literal("book_slot"),
    client_id: id,
    start: instant,
    end: instant,
    resource_key: resource,
    appointment_type: text(100),
    location: optText(300),
    notes: optText(2000),
  }),
  z.object({
    action: z.literal("update_appointment"),
    appointment_id: id,
    appointment_type: text(100).optional(),
    scheduled_at: instant.optional(),
    duration_minutes: z.number().int().min(5).max(480).optional(),
    location: keepText(300),
    notes: keepText(2000),
    status: z.enum(APPOINTMENT_STATUSES).optional(),
  }),
  z.object({ action: z.literal("add_note"), client_id: id, note: text(5000) }),
  z.object({
    action: z.literal("add_task"),
    client_id: id.nullable().optional(),
    title: text(200),
    description: optText(2000),
    assigned_to: id.nullable().optional(),
    due_at: instant.nullable().optional(),
  }),
  z.object({
    action: z.literal("update_task"),
    task_id: id,
    title: text(200).optional(),
    description: keepText(2000),
    assigned_to: id.nullable().optional(),
    due_at: instant.nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
  }),
  z.object({ action: z.literal("complete_task"), task_id: id }),
  z.object({ action: z.literal("assign_staff"), client_id: id, staff_id: id.nullable() }),
  z.object({
    action: z.literal("mark_contacted"),
    client_id: id,
    method: z.enum(CONTACT_METHODS),
    result: text(1000),
    next_action: optText(500),
    followup_date: date.nullable().optional(),
  }),
  z.object({ action: z.literal("add_followup"), client_id: id, due_date: date, reason: text(500) }),
  z.object({ action: z.literal("complete_followup"), followup_id: id, completion_note: optText(1000) }),
  z.object({ action: z.literal("verify_document"), document_id: id, review_note: optText(1000) }),
  z.object({ action: z.literal("reject_document"), document_id: id, reason: text(500) }),
  z.object({ action: z.literal("request_reupload"), document_id: id, reason: text(500) }),
  z.object({ action: z.literal("process_document"), document_id: id }),
  z.object({
    action: z.literal("update_assessment"),
    client_id: id,
    assessment_type: text(100),
    item_key: text(100),
    prompt_reference: optText(500),
    confirmed_answer: optText(2000),
    status: z.enum(ASSESSMENT_STATUSES),
    source: z.enum(ASSESSMENT_SOURCES).nullable().optional(),
    notes: optText(2000),
  }),
  z.object({ action: z.literal("add_standard_assessments"), client_id: id }),
  z.object({
    action: z.literal("update_post_hire"),
    client_id: id,
    item: z.enum(POST_HIRE_ITEMS),
    status: z.enum(POST_HIRE_STATUSES),
    note: optText(1000),
    start_date: date.nullable().optional(),
  }),
  z.object({ action: z.literal("run_intake_agent"), client_id: id }),
  z.object({ action: z.literal("send_notification"), client_id: id, channel: z.enum(["sms", "email"]), message: text(1500) }),
  z.object({ action: z.literal("soft_delete_client"), client_id: id, reason: text(500) }),
  z.object({ action: z.literal("create_staff"), display_name: text(120), email: z.email().max(200).nullable().optional(), role: z.enum(ROLES) }),
  z.object({ action: z.literal("update_staff_role"), staff_id: id, role: z.enum(ROLES) }),
  z.object({ action: z.literal("disable_staff"), staff_id: id }),
  z.object({ action: z.literal("reactivate_staff"), staff_id: id }),
  z.object({ action: z.literal("invite_staff"), staff_id: id }),
  z.object({
    action: z.literal("upsert_availability"),
    id: id.optional(),
    resource_key: resource.default("office"),
    weekday: z.number().int().min(0).max(6),
    start_time: time,
    end_time: time,
    slot_minutes: z.number().int().min(5).max(480).default(30),
    appointment_type: optText(100),
    active: z.boolean().default(true),
  }),
  z.object({ action: z.literal("delete_availability"), id }),
  z.object({ action: z.literal("add_blocked_period"), resource_key: resource.default("office"), starts_at: instant, ends_at: instant, reason: text(300) }),
  z.object({ action: z.literal("remove_blocked_period"), id }),
  z.object({ action: z.literal("resolve_alert"), alert_id: id, note: optText(1000) }),
  z.object({ action: z.literal("ignore_alert"), alert_id: id, reason: text(1000) }),
  z.object({ action: z.literal("run_audit_scan"), client_id: id.nullable().optional() }),
]);
export type ActionInput = z.infer<typeof ActionSchema>;

/** Client (if any) an action targets, for scope checks. */
export function directClientId(a: ActionInput): string | null {
  return "client_id" in a && typeof a.client_id === "string" ? a.client_id : null;
}
export function entityRef(a: ActionInput):
  | { table: "tasks" | "appointments" | "documents" | "followups" | "audit_alerts"; id: string }
  | null {
  if ("task_id" in a) return { table: "tasks", id: a.task_id };
  if ("appointment_id" in a) return { table: "appointments", id: a.appointment_id };
  if ("document_id" in a) return { table: "documents", id: a.document_id };
  if ("followup_id" in a) return { table: "followups", id: a.followup_id };
  if ("alert_id" in a) return { table: "audit_alerts", id: a.alert_id };
  return null;
}

const PROFILE_COLUMNS = [
  "full_name", "phone", "email", "date_of_birth", "preferred_language", "street", "city", "state", "zip",
  "appointment_availability", "amazon_worked_before", "amazon_worked_from", "amazon_worked_to",
  "amazon_applied_before", "amazon_application_email", "currently_amazon", "via_agency",
] as const;

function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const oldV: Record<string, unknown> = {};
  const newV: Record<string, unknown> = {};
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);
  for (const k of Object.keys(after)) {
    if (JSON.stringify(norm(before[k])) !== JSON.stringify(norm(after[k]))) {
      oldV[k] = norm(before[k]);
      newV[k] = norm(after[k]);
    }
  }
  return Object.keys(newV).length ? { oldV, newV } : null;
}

type Ctx = { tx: Tx; actor: Actor & { staffId: string }; role: (typeof ROLES)[number]; semantic: { source: "note" | "task" | "contact" | "followup"; id: string }[] };
type Result = Record<string, unknown>;

async function setStatus(ctx: Ctx, clientId: string, to: Status, nextStep: string | null, override: string | null) {
  const { tx, actor } = ctx;
  const c = await requireClient(tx, clientId);
  const from = c.current_status as Status;
  const step = nextStep ?? c.next_step;
  if (from === to && step === c.next_step) return { changed: false };
  if (from !== to && !override && !canTransition(from, to)) {
    throw new ActionError("invalid_transition", `Cannot move from ${STATUS_LABELS[from]} to ${STATUS_LABELS[to]}`, 409);
  }
  if (override) await tx`select set_config('cg.status_override', ${override}, true)`;
  await tx`update clients set current_status = ${to}, next_step = ${step} where id = ${clientId}`;
  if (override) await tx`select set_config('cg.status_override', '', true)`;
  if (from !== to) {
    await logActivity(tx, {
      clientId, action: override ? "status_overridden" : "status_changed", actor, entityType: "client", entityId: clientId,
      oldValue: { status: from }, newValue: { status: to, ...(override ? { reason: override } : {}) },
    });
  }
  if (step !== c.next_step) {
    await logActivity(tx, { clientId, action: "next_step_changed", actor, entityType: "client", entityId: clientId, oldValue: { next_step: c.next_step }, newValue: { next_step: step } });
  }
  return { changed: true };
}

async function lastAdminGuard(tx: Tx, staffId: string) {
  const [{ n }] = await tx`select count(*)::int as n from staff where role = 'admin' and active and id <> ${staffId}`;
  if (n === 0) throw new ActionError("last_admin", "At least one active admin must remain", 409);
}

export async function runAction(ctx: Ctx, a: ActionInput): Promise<Result> {
  const { tx, actor } = ctx;
  const by = actor.staffId;

  switch (a.action) {
    case "create_client": {
      if (!ENTRY_STATUSES.includes(a.status)) {
        throw new ActionError("invalid_transition", "A new client must start as New Intake, Needs Review or Ready to Apply", 400);
      }
      if (a.primary.length === 0 && a.backup.length > 0) throw new ActionError("invalid_preferences", "Add a primary preference before backups");
      await requireStaffMember(tx, a.assigned_staff);
      const c = await insertClient(tx, {
        source: "staff_manual", profile: a.profile, primary: a.primary, backup: a.backup, status: a.status,
        nextStep: a.next_step, assignedStaff: a.assigned_staff ?? null, createdBy: by, communicationConsent: a.communication_consent,
      }, actor);
      if (a.initial_note) {
        const [n] = await tx`insert into notes (client_id, note, staff_id) values (${c.id}, ${a.initial_note}, ${by}) returning id`;
        await logActivity(tx, { clientId: c.id, action: "note_added", actor, entityType: "note", entityId: n.id, newValue: { note: a.initial_note } });
        ctx.semantic.push({ source: "note", id: n.id });
      }
      await enqueue(tx, { type: "intake_analysis", entityId: c.id, dedupeKey: `intake:${c.id}`, traceId: actor.traceId });
      return { client_id: c.id, ref: c.ref };
    }

    case "update_client": {
      const before = await requireClient(tx, a.client_id);
      const p = a.profile;
      const after: Record<string, unknown> = Object.fromEntries(PROFILE_COLUMNS.map((k) => [k, p[k]]));
      const changes = diff(before, after);
      const oldHistory = await tx`select employment_kind, company, job_title, from_date, to_date from employment_history where client_id = ${a.client_id} order by created_at`;
      const historyChanged = JSON.stringify(oldHistory.map((r) => ({ ...r }))) !== JSON.stringify(p.employment_history);
      if (changes) await tx`update clients set ${tx(after as Record<string, string | boolean | null>)} where id = ${a.client_id}`;
      if (historyChanged) {
        await tx`delete from employment_history where client_id = ${a.client_id}`;
        await insertEmployment(tx, a.client_id, p.employment_history);
      }
      if (!changes && !historyChanged) return { changed: false };
      if (!changes) await touchClient(tx, a.client_id);
      await logActivity(tx, {
        clientId: a.client_id, action: "client_updated", actor, entityType: "client", entityId: a.client_id,
        oldValue: { ...(changes?.oldV ?? {}), ...(historyChanged ? { employment_history: oldHistory } : {}) },
        newValue: { ...(changes?.newV ?? {}), ...(historyChanged ? { employment_history: p.employment_history } : {}) },
      });
      return { changed: true };
    }

    case "patch_client": {
      const parsed = PATCHABLE[a.field].safeParse(a.value);
      if (!parsed.success) throw new ActionError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid value");
      const value = parsed.data as string | null;
      const before = await requireClient(tx, a.client_id);
      const old = before[a.field] instanceof Date ? (before[a.field] as Date).toISOString() : before[a.field];
      if ((old ?? null) === value) return { changed: false, value };
      await tx`update clients set ${tx({ [a.field]: value })} where id = ${a.client_id}`;
      await logActivity(tx, {
        clientId: a.client_id, action: a.field === "next_step" ? "next_step_changed" : "client_updated", actor, entityType: "client",
        entityId: a.client_id, oldValue: { [a.field]: old ?? null }, newValue: { [a.field]: value },
      });
      return { changed: true, value };
    }

    case "update_status":
      return setStatus(ctx, a.client_id, a.status, a.next_step, null);

    case "override_status":
      return setStatus(ctx, a.client_id, a.status, a.next_step, a.reason);

    case "set_next_step": {
      const c = await requireClient(tx, a.client_id);
      if (c.next_step === a.next_step) return { changed: false };
      await tx`update clients set next_step = ${a.next_step} where id = ${a.client_id}`;
      await logActivity(tx, { clientId: a.client_id, action: "next_step_changed", actor, entityType: "client", entityId: a.client_id, oldValue: { next_step: c.next_step }, newValue: { next_step: a.next_step } });
      return { changed: true };
    }

    case "add_preference": {
      await requireClient(tx, a.client_id);
      const opt = findOption(a.selection);
      if (!opt) throw new ActionError("invalid_preferences", "Not an active catalog option");
      const [dup] = await tx`select id from client_preferences where client_id = ${a.client_id}
        and site_code = ${opt.site_code} and job_id = ${opt.job_id} and shift_code = ${opt.shift_code}`;
      if (dup) throw new ActionError("duplicate_preference", "This site, job and shift is already a preference");
      const [{ n }] = await tx`select coalesce(max(preference_order), 0)::int + 1 as n from client_preferences where client_id = ${a.client_id}`;
      const prefId = await insertPreference(tx, a.client_id, { ...opt, rank: a.rank, preference_order: n });
      await renumberPreferences(tx, a.client_id);
      await touchClient(tx, a.client_id);
      await logActivity(tx, { clientId: a.client_id, action: "preference_added", actor, entityType: "preference", entityId: prefId, newValue: { rank: a.rank, site: opt.site_name, job: opt.job_title, shift: opt.shift_code, pay: opt.pay } });
      return { preference_id: prefId };
    }

    case "remove_preference": {
      await requireClient(tx, a.client_id);
      const [p] = await tx`delete from client_preferences where id = ${a.preference_id} and client_id = ${a.client_id} returning *`;
      if (!p) throw new ActionError("not_found", "Preference not found", 404);
      await renumberPreferences(tx, a.client_id);
      await touchClient(tx, a.client_id);
      await logActivity(tx, { clientId: a.client_id, action: "preference_removed", actor, entityType: "preference", entityId: p.id, oldValue: { rank: p.rank, site: p.site_name, job: p.job_title, shift: p.shift_code, pay: p.pay_snapshot } });
      return {};
    }

    case "schedule_appointment":
    case "book_slot": {
      await requireClient(tx, a.client_id);
      const start = new Date(a.action === "book_slot" ? a.start : a.scheduled_at);
      const end = a.action === "book_slot" ? new Date(a.end) : new Date(start.getTime() + a.duration_minutes * 60_000);
      if (end <= start) throw new ActionError("invalid_input", "End must be after start");
      if (a.action === "book_slot" && !(await slotIsBookable(tx, { start, end, resourceKey: a.resource_key, appointmentType: a.appointment_type }))) {
        throw new ActionError("slot_taken", "That slot is no longer available", 409);
      }
      const staffResource = a.resource_key.startsWith("staff:") ? a.resource_key.slice(6) : null;
      const [appt] = await tx`
        insert into appointments (client_id, appointment_type, scheduled_at, ends_at, resource_key, assigned_staff, location, notes, created_by_staff)
        values (${a.client_id}, ${a.appointment_type}, ${start}, ${end}, ${a.resource_key}, ${staffResource}, ${a.location}, ${a.notes}, ${by})
        returning id`;
      await touchClient(tx, a.client_id);
      await logActivity(tx, { clientId: a.client_id, action: "appointment_created", actor, entityType: "appointment", entityId: appt.id, newValue: { type: a.appointment_type, scheduled_at: start.toISOString(), ends_at: end.toISOString(), resource: a.resource_key, location: a.location } });
      return { appointment_id: appt.id };
    }

    case "update_appointment": {
      const [cur] = await tx`select * from appointments where id = ${a.appointment_id} for update`;
      if (!cur) throw new ActionError("not_found", "Appointment not found", 404);
      const start = a.scheduled_at ? new Date(a.scheduled_at) : new Date(cur.scheduled_at);
      const duration = a.duration_minutes ?? Math.round((new Date(cur.ends_at).getTime() - new Date(cur.scheduled_at).getTime()) / 60_000);
      const moved = start.getTime() !== new Date(cur.scheduled_at).getTime() || a.duration_minutes !== undefined;
      const next = {
        appointment_type: a.appointment_type ?? cur.appointment_type,
        scheduled_at: start,
        ends_at: new Date(start.getTime() + duration * 60_000),
        location: a.location !== undefined ? a.location : cur.location,
        notes: a.notes !== undefined ? a.notes : cur.notes,
        status: a.status ?? (moved ? "rescheduled" : cur.status),
      };
      const changes = diff(cur, next);
      if (!changes) return { changed: false };
      await tx`update appointments set ${tx(next)} where id = ${a.appointment_id}`;
      await touchClient(tx, cur.client_id);
      const action = moved ? "appointment_rescheduled" : next.status !== cur.status && (next.status === "attended" || next.status === "missed") ? "appointment_completed" : "appointment_updated";
      await logActivity(tx, { clientId: cur.client_id, action, actor, entityType: "appointment", entityId: cur.id, oldValue: changes.oldV, newValue: changes.newV });
      return { changed: true };
    }

    case "add_note": {
      await requireClient(tx, a.client_id);
      const [n] = await tx`insert into notes (client_id, note, staff_id) values (${a.client_id}, ${a.note}, ${by}) returning id`;
      await touchClient(tx, a.client_id);
      await logActivity(tx, { clientId: a.client_id, action: "note_added", actor, entityType: "note", entityId: n.id, newValue: { note: a.note } });
      ctx.semantic.push({ source: "note", id: n.id });
      return { note_id: n.id };
    }

    case "add_task": {
      if (a.client_id) await requireClient(tx, a.client_id);
      const assignee = await requireStaffMember(tx, a.assigned_to ?? by);
      const [t] = await tx`
        insert into tasks (client_id, title, description, assigned_to, due_at, created_by)
        values (${a.client_id ?? null}, ${a.title}, ${a.description}, ${assignee}, ${a.due_at ?? null}, ${by}) returning id`;
      if (a.client_id) {
        await touchClient(tx, a.client_id);
        await logActivity(tx, { clientId: a.client_id, action: "task_added", actor, entityType: "task", entityId: t.id, newValue: { title: a.title, due_at: a.due_at ?? null, assigned_to: assignee } });
        ctx.semantic.push({ source: "task", id: t.id });
      }
      return { task_id: t.id };
    }

    case "update_task":
    case "complete_task": {
      const [cur] = await tx`select * from tasks where id = ${a.task_id} for update`;
      if (!cur) throw new ActionError("not_found", "Task not found", 404);
      if (ctx.role === "staff" && cur.client_id === null && cur.assigned_to !== by && cur.created_by !== by) {
        throw new ActionError("forbidden", "You can only change office tasks assigned to you", 403);
      }
      const upd = a.action === "update_task" ? a : null;
      const status = upd?.status ?? (a.action === "complete_task" ? "completed" : cur.status);
      if (a.action === "complete_task" && cur.status === "completed") throw new ActionError("already_completed", "Task is already completed", 409);
      const next = {
        title: upd?.title ?? cur.title,
        description: upd && upd.description !== undefined ? upd.description : cur.description,
        assigned_to: upd && upd.assigned_to !== undefined ? await requireStaffMember(tx, upd.assigned_to) : cur.assigned_to,
        due_at: upd && upd.due_at !== undefined ? (upd.due_at ? new Date(upd.due_at) : null) : cur.due_at,
        status,
        completed_at: status === "completed" ? (cur.status === "completed" ? cur.completed_at : new Date()) : null,
        completed_by: status === "completed" ? (cur.status === "completed" ? cur.completed_by : by) : null,
      };
      const changes = diff(cur, next);
      if (!changes) return { changed: false };
      await tx`update tasks set ${tx(next)} where id = ${a.task_id}`;
      if (cur.client_id) {
        await touchClient(tx, cur.client_id);
        await logActivity(tx, {
          clientId: cur.client_id, action: status === "completed" && cur.status !== "completed" ? "task_completed" : "task_updated",
          actor, entityType: "task", entityId: cur.id, oldValue: changes.oldV, newValue: changes.newV,
        });
      }
      return { changed: true };
    }

    case "assign_staff": {
      const c = await requireClient(tx, a.client_id);
      await requireStaffMember(tx, a.staff_id);
      if (c.assigned_staff === a.staff_id) return { changed: false };
      await tx`update clients set assigned_staff = ${a.staff_id} where id = ${a.client_id}`;
      await logActivity(tx, { clientId: a.client_id, action: "staff_assigned", actor, entityType: "client", entityId: a.client_id, oldValue: { assigned_staff: c.assigned_staff }, newValue: { assigned_staff: a.staff_id } });
      return { changed: true };
    }

    case "mark_contacted": {
      await requireClient(tx, a.client_id);
      const [contact] = await tx`
        insert into contacts (client_id, method, result, next_action, followup_date, staff_id)
        values (${a.client_id}, ${a.method}, ${a.result}, ${a.next_action}, ${a.followup_date ?? null}, ${by}) returning id`;
      await logActivity(tx, { clientId: a.client_id, action: "contact_logged", actor, entityType: "contact", entityId: contact.id, newValue: { method: a.method, result: a.result, next_action: a.next_action, followup_date: a.followup_date ?? null } });
      ctx.semantic.push({ source: "contact", id: contact.id });
      let followupId: string | null = null;
      if (a.followup_date) {
        const [f] = await tx`
          insert into followups (client_id, due_date, reason, contact_id, created_by)
          values (${a.client_id}, ${a.followup_date}, ${a.next_action ?? `Follow up after ${a.method.replace("_", " ")} contact`}, ${contact.id}, ${by}) returning id`;
        followupId = f.id;
        await logActivity(tx, { clientId: a.client_id, action: "followup_created", actor, entityType: "followup", entityId: f.id, newValue: { due_date: a.followup_date, reason: a.next_action } });
        ctx.semantic.push({ source: "followup", id: f.id });
      }
      await touchClient(tx, a.client_id);
      return { contact_id: contact.id, followup_id: followupId };
    }

    case "add_followup": {
      await requireClient(tx, a.client_id);
      const [f] = await tx`insert into followups (client_id, due_date, reason, created_by) values (${a.client_id}, ${a.due_date}, ${a.reason}, ${by}) returning id`;
      await touchClient(tx, a.client_id);
      await logActivity(tx, { clientId: a.client_id, action: "followup_created", actor, entityType: "followup", entityId: f.id, newValue: { due_date: a.due_date, reason: a.reason } });
      ctx.semantic.push({ source: "followup", id: f.id });
      return { followup_id: f.id };
    }

    case "complete_followup": {
      const [f] = await tx`
        update followups set status = 'completed', completed_at = now(), completed_by = ${by}, completion_note = ${a.completion_note}
        where id = ${a.followup_id} and status = 'open' returning id, client_id, reason`;
      if (!f) throw new ActionError("not_found", "Open follow-up not found", 404);
      await touchClient(tx, f.client_id);
      await logActivity(tx, { clientId: f.client_id, action: "followup_completed", actor, entityType: "followup", entityId: f.id, newValue: { reason: f.reason, completion_note: a.completion_note } });
      return {};
    }

    case "verify_document":
    case "reject_document":
    case "request_reupload": {
      const [cur] = await tx`select id, client_id, status, rejection_reason from documents where id = ${a.document_id} for update`;
      if (!cur) throw new ActionError("not_found", "Document not found", 404);
      if (cur.status === "processing") throw new ActionError("document_processing", "Wait for processing to finish before reviewing", 409);
      const status = a.action === "verify_document" ? "verified" : a.action === "reject_document" ? "rejected" : "needs_reupload";
      const reason = a.action === "verify_document" ? null : a.reason;
      await tx`
        update documents set status = ${status}, reviewed_by = ${by}, reviewed_at = now(),
          rejection_reason = ${a.action === "reject_document" ? reason : null},
          review_note = ${a.action === "verify_document" ? a.review_note : reason}
        where id = ${a.document_id}`;
      await touchClient(tx, cur.client_id);
      await logActivity(tx, {
        clientId: cur.client_id,
        action: a.action === "verify_document" ? "document_verified" : a.action === "reject_document" ? "document_rejected" : "document_reupload_requested",
        actor, entityType: "document", entityId: cur.id, oldValue: { status: cur.status }, newValue: { status, reason },
      });
      return {};
    }

    case "process_document": {
      const [d] = await tx`select id, client_id, status from documents where id = ${a.document_id}`;
      if (!d) throw new ActionError("not_found", "Document not found", 404);
      if (["verified", "rejected"].includes(d.status)) throw new ActionError("document_final", "Document already has a final review", 409);
      await enqueue(tx, { type: "document_extraction", entityId: d.id, dedupeKey: `extract:${d.id}:${Date.now()}`, traceId: actor.traceId, maxAttempts: 3 });
      return { queued: true };
    }

    case "update_assessment": {
      await requireClient(tx, a.client_id);
      if (a.status === "completed" && (!a.confirmed_answer || !a.source)) {
        throw new ActionError("unconfirmed_answer", "A completed item needs the answer the client confirmed and its source");
      }
      const [cur] = await tx`select * from assessments where client_id = ${a.client_id} and assessment_type = ${a.assessment_type} and item_key = ${a.item_key}`;
      const [row] = await tx`
        insert into assessments (client_id, assessment_type, item_key, prompt_reference, confirmed_answer, status, source, notes, updated_by)
        values (${a.client_id}, ${a.assessment_type}, ${a.item_key}, ${a.prompt_reference}, ${a.confirmed_answer}, ${a.status}, ${a.source ?? null}, ${a.notes}, ${by})
        on conflict (client_id, assessment_type, item_key) do update set
          prompt_reference = coalesce(excluded.prompt_reference, assessments.prompt_reference),
          confirmed_answer = excluded.confirmed_answer, status = excluded.status, source = excluded.source,
          notes = excluded.notes, updated_by = excluded.updated_by
        returning id`;
      await touchClient(tx, a.client_id);
      await logActivity(tx, {
        clientId: a.client_id, action: "assessment_updated", actor, entityType: "assessment", entityId: row.id,
        oldValue: cur ? { status: cur.status, confirmed_answer: cur.confirmed_answer, source: cur.source } : null,
        newValue: { item: `${a.assessment_type}/${a.item_key}`, status: a.status, confirmed_answer: a.confirmed_answer, source: a.source ?? null },
      });
      return { assessment_id: row.id };
    }

    case "add_standard_assessments": {
      await requireClient(tx, a.client_id);
      let added = 0;
      for (const item of STANDARD_ASSESSMENT_ITEMS) {
        const r = await tx`
          insert into assessments (client_id, assessment_type, item_key, prompt_reference, status, updated_by)
          values (${a.client_id}, ${item.assessment_type}, ${item.item_key}, ${item.prompt_reference}, 'unresolved', ${by})
          on conflict do nothing returning id`;
        added += r.length;
      }
      if (added) {
        await touchClient(tx, a.client_id);
        await logActivity(tx, { clientId: a.client_id, action: "assessment_updated", actor, entityType: "assessment", newValue: { added_unresolved: added } });
      }
      return { added };
    }

    case "update_post_hire": {
      const c = await requireClient(tx, a.client_id);
      const [cur] = await tx`select status, note from post_hire_items where client_id = ${a.client_id} and item = ${a.item}`;
      await tx`
        insert into post_hire_items (client_id, item, status, note, staff_id, updated_at)
        values (${a.client_id}, ${a.item}, ${a.status}, ${a.note}, ${by}, now())
        on conflict (client_id, item) do update set status = excluded.status, note = excluded.note, staff_id = excluded.staff_id, updated_at = now()`;
      const oldValue: Record<string, unknown> = { status: cur?.status ?? null, note: cur?.note ?? null };
      const newValue: Record<string, unknown> = { item: a.item, status: a.status, note: a.note };
      if (a.item === "start_date" && a.start_date !== undefined) {
        await tx`update clients set start_date = ${a.start_date} where id = ${a.client_id}`;
        oldValue.start_date = c.start_date;
        newValue.start_date = a.start_date;
      } else await touchClient(tx, a.client_id);
      await logActivity(tx, { clientId: a.client_id, action: "post_hire_updated", actor, entityType: "post_hire", entityId: a.item, oldValue, newValue });
      return {};
    }

    case "run_intake_agent":
      // Runs outside the transaction (network call); see route.
      return { deferred: "intake_agent" };

    case "send_notification": {
      const c = await requireClient(tx, a.client_id);
      if (!c.communication_consent) throw new ActionError("no_consent", "The client has not agreed to be contacted", 409);
      if (a.channel === "email" && !c.email) throw new ActionError("no_contact", "No email on file", 409);
      const configured = channelConfigured(a.channel);
      const [n] = await tx`
        insert into notifications (client_id, channel, template, payload, status)
        values (${a.client_id}, ${a.channel}, 'staff_message', ${tx.json({ length: a.message.length })}, ${configured ? "sending" : "not_configured"})
        returning id`;
      if (!configured) {
        await logActivity(tx, { clientId: a.client_id, action: "notification_not_configured", actor, entityType: "notification", entityId: n.id, newValue: { channel: a.channel } });
        return { notification_id: n.id, status: "not_configured" };
      }
      const r = a.channel === "sms" ? await sendSms(c.phone, a.message) : await sendEmail(c.email, "Career Gate", a.message);
      if (r.status === "sent") {
        await tx`update notifications set status = 'sent', provider = ${r.provider}, provider_id = ${r.provider_id}, sent_at = now(), attempts = 1 where id = ${n.id}`;
        await logActivity(tx, { clientId: a.client_id, action: "notification_sent", actor, entityType: "notification", entityId: n.id, newValue: { channel: a.channel, provider: r.provider } });
      } else {
        const error = r.status === "failed" ? r.error : "not configured";
        await tx`update notifications set status = ${r.status === "failed" ? "failed" : "not_configured"}, error = ${error}, attempts = 1 where id = ${n.id}`;
        await logActivity(tx, { clientId: a.client_id, action: "notification_failed", actor, entityType: "notification", entityId: n.id, newValue: { channel: a.channel, error } });
      }
      return { notification_id: n.id, status: r.status };
    }

    case "soft_delete_client": {
      const c = await requireClient(tx, a.client_id);
      if (c.deleted_at) throw new ActionError("already_deleted", "Client is already deleted", 409);
      await tx`update clients set deleted_at = now(), deleted_by = ${by}, delete_reason = ${a.reason} where id = ${a.client_id}`;
      await logActivity(tx, { clientId: a.client_id, action: "client_deleted", actor, entityType: "client", entityId: a.client_id, newValue: { reason: a.reason } });
      return {};
    }

    case "create_staff": {
      const [s] = await tx`insert into staff (display_name, email, role) values (${a.display_name}, ${a.email ?? null}, ${a.role}) returning id`;
      return { staff_id: s.id };
    }
    case "update_staff_role": {
      const [s] = await tx`select id, role from staff where id = ${a.staff_id} for update`;
      if (!s) throw new ActionError("not_found", "Staff member not found", 404);
      if (s.role === "admin" && a.role !== "admin") await lastAdminGuard(tx, a.staff_id);
      await tx`update staff set role = ${a.role} where id = ${a.staff_id}`;
      return { changed: s.role !== a.role };
    }
    case "disable_staff":
    case "reactivate_staff": {
      const [s] = await tx`select id, role, active from staff where id = ${a.staff_id} for update`;
      if (!s) throw new ActionError("not_found", "Staff member not found", 404);
      if (a.action === "disable_staff" && s.role === "admin") await lastAdminGuard(tx, a.staff_id);
      await tx`update staff set active = ${a.action === "reactivate_staff"} where id = ${a.staff_id}`;
      return {};
    }
    case "invite_staff": {
      const [s] = await tx`select id, email, auth_user_id from staff where id = ${a.staff_id}`;
      if (!s) throw new ActionError("not_found", "Staff member not found", 404);
      if (!s.email) throw new ActionError("no_email", "Add the staff member's real email first", 409);
      if (s.auth_user_id) throw new ActionError("already_linked", "Already linked to a sign-in account", 409);
      const r = await inviteUser(s.email);
      if (!r.ok) throw new ActionError(r.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "invite_failed", r.message, r.code === "NOT_CONFIGURED" ? 503 : 502);
      await tx`update staff set auth_user_id = ${r.data.id} where id = ${a.staff_id}`;
      return { invited: true };
    }

    case "upsert_availability": {
      if (a.end_time <= a.start_time) throw new ActionError("invalid_input", "End time must be after start time");
      const row = {
        resource_key: a.resource_key, staff_id: a.resource_key.startsWith("staff:") ? a.resource_key.slice(6) : null,
        weekday: a.weekday, start_time: a.start_time, end_time: a.end_time, slot_minutes: a.slot_minutes,
        appointment_type: a.appointment_type, active: a.active,
      };
      if (a.id) {
        const r = await tx`update office_availability set ${tx(row)} where id = ${a.id} returning id`;
        if (!r.length) throw new ActionError("not_found", "Availability window not found", 404);
        return { id: a.id };
      }
      const [r] = await tx`insert into office_availability ${tx(row)} returning id`;
      return { id: r.id };
    }
    case "delete_availability": {
      const r = await tx`delete from office_availability where id = ${a.id} returning id`;
      if (!r.length) throw new ActionError("not_found", "Availability window not found", 404);
      return {};
    }
    case "add_blocked_period": {
      if (new Date(a.ends_at) <= new Date(a.starts_at)) throw new ActionError("invalid_input", "End must be after start");
      const [r] = await tx`insert into blocked_periods (resource_key, starts_at, ends_at, reason, created_by)
                           values (${a.resource_key}, ${a.starts_at}, ${a.ends_at}, ${a.reason}, ${by}) returning id`;
      return { id: r.id };
    }
    case "remove_blocked_period": {
      const r = await tx`delete from blocked_periods where id = ${a.id} returning id`;
      if (!r.length) throw new ActionError("not_found", "Blocked period not found", 404);
      return {};
    }

    case "resolve_alert":
    case "ignore_alert": {
      const status = a.action === "resolve_alert" ? "resolved" : "ignored";
      const note = a.action === "resolve_alert" ? a.note : a.reason;
      const r = await tx`update audit_alerts set status = ${status}, resolved_by = ${by}, resolved_at = now(), resolution_note = ${note}
                         where id = ${a.alert_id} and status = 'open' returning id`;
      if (!r.length) throw new ActionError("not_found", "Open alert not found", 404);
      return {};
    }

    case "run_audit_scan":
      return { deferred: "audit_scan" };
  }
}

export { DOC_TYPES };
