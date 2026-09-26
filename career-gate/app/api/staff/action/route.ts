import { z } from "zod";
import { findOption } from "@/lib/catalog";
import { sql } from "@/lib/db";
import {
  APPOINTMENT_STATUSES,
  CONTACT_METHODS,
  POST_HIRE_ITEMS,
  POST_HIRE_STATUSES,
  STATUSES,
  TASK_STATUSES,
} from "@/lib/domain";
import { dbErrorResponse, err, ok, staffAllowed } from "@/lib/http";
import { issuesMessage, ProfileSchema, SelectionSchema } from "@/lib/schemas";
import {
  ActionError,
  insertClient,
  insertPreference,
  logActivity,
  renumberPreferences,
  requireClient,
  requireStaffMember,
  type Tx,
} from "@/lib/service";

export const runtime = "nodejs";

const id = z.uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
// For partial updates: absent stays undefined (keep current), "" or null clears.
const keepText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : v || null));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const instant = z.iso.datetime({ offset: true });

const base = { handled_by: id };

const Action = z.discriminatedUnion("action", [
  z.object({
    ...base,
    action: z.literal("create_client"),
    profile: ProfileSchema,
    primary: z.array(SelectionSchema).max(20).default([]),
    backup: z.array(SelectionSchema).max(20).default([]),
    status: z.enum(STATUSES),
    next_step: optText(500),
    initial_note: optText(5000),
    communication_consent: z.boolean().default(false),
  }),
  z.object({ ...base, action: z.literal("update_client"), client_id: id, profile: ProfileSchema, start_date: date.nullable().optional() }),
  z.object({ ...base, action: z.literal("update_status"), client_id: id, status: z.enum(STATUSES), next_step: optText(500) }),
  z.object({ ...base, action: z.literal("set_next_step"), client_id: id, next_step: text(500) }),
  z.object({ ...base, action: z.literal("add_preference"), client_id: id, rank: z.enum(["primary", "backup"]), selection: SelectionSchema }),
  z.object({ ...base, action: z.literal("remove_preference"), client_id: id, preference_id: id }),
  z.object({
    ...base,
    action: z.literal("schedule_appointment"),
    client_id: id,
    appointment_type: text(100),
    scheduled_at: instant,
    location: optText(300),
    notes: optText(2000),
  }),
  z.object({
    ...base,
    action: z.literal("update_appointment"),
    appointment_id: id,
    appointment_type: text(100).optional(),
    scheduled_at: instant.optional(),
    location: keepText(300),
    notes: keepText(2000),
    status: z.enum(APPOINTMENT_STATUSES).optional(),
  }),
  z.object({ ...base, action: z.literal("add_note"), client_id: id, note: text(5000) }),
  z.object({
    ...base,
    action: z.literal("add_task"),
    client_id: id.nullable().optional(),
    title: text(200),
    description: optText(2000),
    assigned_to: id.nullable().optional(),
    due_at: instant.nullable().optional(),
  }),
  z.object({
    ...base,
    action: z.literal("update_task"),
    task_id: id,
    title: text(200).optional(),
    description: keepText(2000),
    assigned_to: id.nullable().optional(),
    due_at: instant.nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
  }),
  z.object({ ...base, action: z.literal("complete_task"), task_id: id }),
  z.object({ ...base, action: z.literal("assign_staff"), client_id: id, staff_id: id.nullable() }),
  z.object({
    ...base,
    action: z.literal("mark_contacted"),
    client_id: id,
    method: z.enum(CONTACT_METHODS),
    result: text(1000),
    next_action: optText(500),
    followup_date: date.nullable().optional(),
  }),
  z.object({ ...base, action: z.literal("add_followup"), client_id: id, due_date: date, reason: text(500) }),
  z.object({ ...base, action: z.literal("complete_followup"), followup_id: id, completion_note: optText(1000) }),
  z.object({ ...base, action: z.literal("verify_document"), document_id: id }),
  z.object({ ...base, action: z.literal("reject_document"), document_id: id, reason: text(500) }),
  z.object({
    ...base,
    action: z.literal("update_post_hire"),
    client_id: id,
    item: z.enum(POST_HIRE_ITEMS),
    status: z.enum(POST_HIRE_STATUSES),
    note: optText(1000),
    start_date: date.nullable().optional(),
  }),
]);

type ActionInput = z.infer<typeof Action>;

const PROFILE_COLUMNS = [
  "full_name", "phone", "email", "date_of_birth", "preferred_language", "street", "city", "state", "zip",
  "appointment_availability", "amazon_worked_before", "amazon_worked_from", "amazon_worked_to",
  "amazon_applied_before", "amazon_application_email",
] as const;

function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const oldV: Record<string, unknown> = {};
  const newV: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) {
      oldV[k] = before[k] ?? null;
      newV[k] = after[k] ?? null;
    }
  }
  return Object.keys(newV).length ? { oldV, newV } : null;
}

async function run(tx: Tx, a: ActionInput): Promise<Record<string, unknown>> {
  const by = a.handled_by;

  switch (a.action) {
    case "create_client": {
      const c = await insertClient(tx, {
        source: "office", profile: a.profile, primary: a.primary, backup: a.backup, status: a.status,
        nextStep: a.next_step, handledBy: by, communicationConsent: a.communication_consent,
      });
      if (a.initial_note) {
        const [n] = await tx`insert into notes (client_id, note, handled_by) values (${c.id}, ${a.initial_note}, ${by}) returning id`;
        await logActivity(tx, { clientId: c.id, action: "note_added", handledBy: by, entityType: "note", entityId: n.id, newValue: { note: a.initial_note } });
      }
      return { client_id: c.id, ref: c.ref };
    }

    case "update_client": {
      const before = await requireClient(tx, a.client_id);
      const p = a.profile;
      const after: Record<string, unknown> = Object.fromEntries(PROFILE_COLUMNS.map((k) => [k, p[k]]));
      if (a.start_date !== undefined) after.start_date = a.start_date;
      const changes = diff(before, after);

      const oldHistory = await tx`select company, job_title, from_date, to_date from employment_history where client_id = ${a.client_id} order by created_at`;
      const historyChanged = JSON.stringify(oldHistory.map((r) => ({ ...r }))) !== JSON.stringify(p.employment_history);

      if (changes) {
        await tx`update clients set ${tx(after as Record<string, postgres_value>)} where id = ${a.client_id}`;
      }
      if (historyChanged) {
        await tx`delete from employment_history where client_id = ${a.client_id}`;
        for (const e of p.employment_history) {
          await tx`insert into employment_history (client_id, company, job_title, from_date, to_date)
                   values (${a.client_id}, ${e.company}, ${e.job_title}, ${e.from_date}, ${e.to_date})`;
        }
      }
      if (changes || historyChanged) {
        await logActivity(tx, {
          clientId: a.client_id, action: "client_updated", handledBy: by, entityType: "client", entityId: a.client_id,
          oldValue: { ...(changes?.oldV ?? {}), ...(historyChanged ? { employment_history: oldHistory } : {}) },
          newValue: { ...(changes?.newV ?? {}), ...(historyChanged ? { employment_history: p.employment_history } : {}) },
        });
      } else {
        await tx`update clients set updated_at = now() where id = ${a.client_id}`;
      }
      return { changed: Boolean(changes || historyChanged) };
    }

    case "update_status": {
      const c = await requireClient(tx, a.client_id);
      const nextStep = a.next_step ?? c.next_step;
      if (c.current_status === a.status && nextStep === c.next_step) return { changed: false };
      await tx`update clients set current_status = ${a.status}, next_step = ${nextStep} where id = ${a.client_id}`;
      if (c.current_status !== a.status) {
        await logActivity(tx, {
          clientId: a.client_id, action: "status_changed", handledBy: by, entityType: "client", entityId: a.client_id,
          oldValue: { status: c.current_status }, newValue: { status: a.status },
        });
      }
      if (nextStep !== c.next_step) {
        await logActivity(tx, {
          clientId: a.client_id, action: "next_step_changed", handledBy: by, entityType: "client", entityId: a.client_id,
          oldValue: { next_step: c.next_step }, newValue: { next_step: nextStep },
        });
      }
      return { changed: true };
    }

    case "set_next_step": {
      const c = await requireClient(tx, a.client_id);
      if (c.next_step === a.next_step) return { changed: false };
      await tx`update clients set next_step = ${a.next_step} where id = ${a.client_id}`;
      await logActivity(tx, {
        clientId: a.client_id, action: "next_step_changed", handledBy: by, entityType: "client", entityId: a.client_id,
        oldValue: { next_step: c.next_step }, newValue: { next_step: a.next_step },
      });
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
      await tx`update clients set updated_at = now() where id = ${a.client_id}`;
      await logActivity(tx, {
        clientId: a.client_id, action: "preference_added", handledBy: by, entityType: "preference", entityId: prefId,
        newValue: { rank: a.rank, site: opt.site_name, job: opt.job_title, shift: opt.shift_code, pay: opt.pay },
      });
      return { preference_id: prefId };
    }

    case "remove_preference": {
      await requireClient(tx, a.client_id);
      const [p] = await tx`delete from client_preferences where id = ${a.preference_id} and client_id = ${a.client_id} returning *`;
      if (!p) throw new ActionError("not_found", "Preference not found", 404);
      await renumberPreferences(tx, a.client_id);
      await tx`update clients set updated_at = now() where id = ${a.client_id}`;
      await logActivity(tx, {
        clientId: a.client_id, action: "preference_removed", handledBy: by, entityType: "preference", entityId: p.id,
        oldValue: { rank: p.rank, site: p.site_name, job: p.job_title, shift: p.shift_code, pay: p.pay_snapshot },
      });
      return {};
    }

    case "schedule_appointment": {
      await requireClient(tx, a.client_id);
      const [appt] = await tx`
        insert into appointments (client_id, appointment_type, scheduled_at, location, notes, handled_by)
        values (${a.client_id}, ${a.appointment_type}, ${a.scheduled_at}, ${a.location}, ${a.notes}, ${by})
        returning *`;
      await tx`update clients set updated_at = now() where id = ${a.client_id}`;
      await logActivity(tx, {
        clientId: a.client_id, action: "appointment_created", handledBy: by, entityType: "appointment", entityId: appt.id,
        newValue: { type: a.appointment_type, scheduled_at: a.scheduled_at, location: a.location },
      });
      return { appointment_id: appt.id };
    }

    case "update_appointment": {
      const [cur] = await tx`select * from appointments where id = ${a.appointment_id} for update`;
      if (!cur) throw new ActionError("not_found", "Appointment not found", 404);
      const moved = a.scheduled_at !== undefined && new Date(a.scheduled_at).getTime() !== new Date(cur.scheduled_at).getTime();
      const next = {
        appointment_type: a.appointment_type ?? cur.appointment_type,
        scheduled_at: a.scheduled_at ? new Date(a.scheduled_at) : cur.scheduled_at,
        location: a.location !== undefined ? a.location : cur.location,
        notes: a.notes !== undefined ? a.notes : cur.notes,
        // Moving the time marks it rescheduled unless an explicit status was given.
        status: a.status ?? (moved ? "rescheduled" : cur.status),
        handled_by: by,
      };
      const changes = diff(
        { ...cur, scheduled_at: new Date(cur.scheduled_at).toISOString() },
        { ...next, scheduled_at: new Date(next.scheduled_at).toISOString(), handled_by: cur.handled_by },
      );
      if (!changes) return { changed: false };
      await tx`update appointments set ${tx(next)} where id = ${a.appointment_id}`;
      await tx`update clients set updated_at = now() where id = ${cur.client_id}`;
      const action = moved
        ? "appointment_rescheduled"
        : next.status !== cur.status && (next.status === "attended" || next.status === "missed")
          ? "appointment_completed"
          : "appointment_updated";
      await logActivity(tx, {
        clientId: cur.client_id, action, handledBy: by, entityType: "appointment", entityId: cur.id,
        oldValue: changes.oldV, newValue: changes.newV,
      });
      return { changed: true };
    }

    case "add_note": {
      await requireClient(tx, a.client_id);
      const [n] = await tx`insert into notes (client_id, note, handled_by) values (${a.client_id}, ${a.note}, ${by}) returning id`;
      await tx`update clients set updated_at = now() where id = ${a.client_id}`;
      await logActivity(tx, { clientId: a.client_id, action: "note_added", handledBy: by, entityType: "note", entityId: n.id, newValue: { note: a.note } });
      return { note_id: n.id };
    }

    case "add_task": {
      if (a.client_id) await requireClient(tx, a.client_id);
      const assignee = await requireStaffMember(tx, a.assigned_to ?? by);
      const [t] = await tx`
        insert into tasks (client_id, title, description, assigned_to, due_at, created_by)
        values (${a.client_id ?? null}, ${a.title}, ${a.description}, ${assignee}, ${a.due_at ?? null}, ${by})
        returning id`;
      if (a.client_id) {
        await tx`update clients set updated_at = now() where id = ${a.client_id}`;
        await logActivity(tx, {
          clientId: a.client_id, action: "task_added", handledBy: by, entityType: "task", entityId: t.id,
          newValue: { title: a.title, due_at: a.due_at ?? null, assigned_to: assignee },
        });
      }
      return { task_id: t.id };
    }

    case "update_task":
    case "complete_task": {
      const [cur] = await tx`select * from tasks where id = ${a.task_id} for update`;
      if (!cur) throw new ActionError("not_found", "Task not found", 404);
      const u = a.action === "update_task" ? a : { status: "completed" as const };
      const status = u.status ?? cur.status;
      if (cur.status === "completed" && status === "completed" && a.action === "complete_task") {
        throw new ActionError("already_completed", "Task is already completed", 409);
      }
      const assignee =
        a.action === "update_task" && a.assigned_to !== undefined ? await requireStaffMember(tx, a.assigned_to) : cur.assigned_to;
      const next = {
        title: a.action === "update_task" && a.title ? a.title : cur.title,
        description: a.action === "update_task" && a.description !== undefined ? a.description : cur.description,
        assigned_to: assignee,
        due_at: a.action === "update_task" && a.due_at !== undefined ? (a.due_at ? new Date(a.due_at) : null) : cur.due_at,
        status,
        completed_at: status === "completed" ? (cur.status === "completed" ? cur.completed_at : new Date()) : null,
        completed_by: status === "completed" ? (cur.status === "completed" ? cur.completed_by : by) : null,
      };
      const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
      const changes = diff(
        { ...cur, due_at: iso(cur.due_at), completed_at: iso(cur.completed_at) },
        { ...next, due_at: iso(next.due_at), completed_at: iso(next.completed_at) },
      );
      if (!changes) return { changed: false };
      await tx`update tasks set ${tx(next)} where id = ${a.task_id}`;
      if (cur.client_id) {
        await tx`update clients set updated_at = now() where id = ${cur.client_id}`;
        await logActivity(tx, {
          clientId: cur.client_id,
          action: status === "completed" && cur.status !== "completed" ? "task_completed" : "task_updated",
          handledBy: by, entityType: "task", entityId: cur.id, oldValue: changes.oldV, newValue: changes.newV,
        });
      }
      return { changed: true };
    }

    case "assign_staff": {
      const c = await requireClient(tx, a.client_id);
      await requireStaffMember(tx, a.staff_id);
      if (c.handled_by === a.staff_id) return { changed: false };
      await tx`update clients set handled_by = ${a.staff_id} where id = ${a.client_id}`;
      await logActivity(tx, {
        clientId: a.client_id, action: "staff_assigned", handledBy: by, entityType: "client", entityId: a.client_id,
        oldValue: { handled_by: c.handled_by }, newValue: { handled_by: a.staff_id },
      });
      return { changed: true };
    }

    case "mark_contacted": {
      await requireClient(tx, a.client_id);
      const [contact] = await tx`
        insert into contacts (client_id, method, result, next_action, followup_date, handled_by)
        values (${a.client_id}, ${a.method}, ${a.result}, ${a.next_action}, ${a.followup_date ?? null}, ${by})
        returning id, created_at`;
      await logActivity(tx, {
        clientId: a.client_id, action: "contact_logged", handledBy: by, entityType: "contact", entityId: contact.id,
        newValue: { method: a.method, result: a.result, next_action: a.next_action, followup_date: a.followup_date ?? null },
      });
      let followupId: string | null = null;
      if (a.followup_date) {
        const [f] = await tx`
          insert into followups (client_id, due_date, reason, contact_id, handled_by)
          values (${a.client_id}, ${a.followup_date}, ${a.next_action ?? `Follow up after ${a.method.replace("_", " ")} contact`}, ${contact.id}, ${by})
          returning id`;
        followupId = f.id;
        await logActivity(tx, {
          clientId: a.client_id, action: "followup_created", handledBy: by, entityType: "followup", entityId: f.id,
          newValue: { due_date: a.followup_date, reason: a.next_action },
        });
      }
      await tx`update clients set updated_at = now() where id = ${a.client_id}`;
      return { contact_id: contact.id, followup_id: followupId };
    }

    case "add_followup": {
      await requireClient(tx, a.client_id);
      const [f] = await tx`
        insert into followups (client_id, due_date, reason, handled_by)
        values (${a.client_id}, ${a.due_date}, ${a.reason}, ${by}) returning id`;
      await tx`update clients set updated_at = now() where id = ${a.client_id}`;
      await logActivity(tx, {
        clientId: a.client_id, action: "followup_created", handledBy: by, entityType: "followup", entityId: f.id,
        newValue: { due_date: a.due_date, reason: a.reason },
      });
      return { followup_id: f.id };
    }

    case "complete_followup": {
      const [f] = await tx`
        update followups set status = 'completed', completed_at = now(), completed_by = ${by},
               completion_note = ${a.completion_note}
        where id = ${a.followup_id} and status = 'open'
        returning id, client_id, reason`;
      if (!f) throw new ActionError("not_found", "Open follow-up not found", 404);
      await tx`update clients set updated_at = now() where id = ${f.client_id}`;
      await logActivity(tx, {
        clientId: f.client_id, action: "followup_completed", handledBy: by, entityType: "followup", entityId: f.id,
        newValue: { reason: f.reason, completion_note: a.completion_note },
      });
      return {};
    }

    case "verify_document":
    case "reject_document": {
      const [cur] = await tx`select id, client_id, status, rejection_reason from documents where id = ${a.document_id} for update`;
      if (!cur) throw new ActionError("not_found", "Document not found", 404);
      const status = a.action === "verify_document" ? "verified" : "rejected";
      const reason = a.action === "reject_document" ? a.reason : null;
      await tx`update documents set status = ${status}, reviewed_by = ${by}, reviewed_at = now(), rejection_reason = ${reason}
               where id = ${a.document_id}`;
      await tx`update clients set updated_at = now() where id = ${cur.client_id}`;
      await logActivity(tx, {
        clientId: cur.client_id, action: a.action === "verify_document" ? "document_verified" : "document_rejected",
        handledBy: by, entityType: "document", entityId: cur.id,
        oldValue: { status: cur.status, rejection_reason: cur.rejection_reason }, newValue: { status, rejection_reason: reason },
      });
      return {};
    }

    case "update_post_hire": {
      const c = await requireClient(tx, a.client_id);
      const [cur] = await tx`select status, note from post_hire_items where client_id = ${a.client_id} and item = ${a.item}`;
      await tx`
        insert into post_hire_items (client_id, item, status, note, handled_by, updated_at)
        values (${a.client_id}, ${a.item}, ${a.status}, ${a.note}, ${by}, now())
        on conflict (client_id, item) do update
          set status = excluded.status, note = excluded.note, handled_by = excluded.handled_by, updated_at = now()`;
      const oldValue: Record<string, unknown> = { status: cur?.status ?? null, note: cur?.note ?? null };
      const newValue: Record<string, unknown> = { item: a.item, status: a.status, note: a.note };
      if (a.item === "start_date" && a.start_date !== undefined) {
        await tx`update clients set start_date = ${a.start_date} where id = ${a.client_id}`;
        oldValue.start_date = c.start_date;
        newValue.start_date = a.start_date;
      } else {
        await tx`update clients set updated_at = now() where id = ${a.client_id}`;
      }
      await logActivity(tx, {
        clientId: a.client_id, action: "post_hire_updated", handledBy: by, entityType: "post_hire", entityId: a.item,
        oldValue, newValue,
      });
      return {};
    }
  }
}

type postgres_value = string | number | boolean | Date | null;

export async function POST(req: Request) {
  if (!(await staffAllowed())) return err("unauthorized", "Office access required", 401);
  const body = await req.json().catch(() => undefined);
  const parsed = Action.safeParse(body);
  if (!parsed.success) return err("invalid_input", issuesMessage(parsed.error));

  const a = parsed.data;
  if (a.action === "create_client" && a.primary.length === 0 && a.backup.length > 0) {
    return err("invalid_preferences", "Add a primary preference before backups");
  }

  try {
    const result = await sql().begin(async (tx) => {
      await requireStaffMember(tx, a.handled_by);
      return run(tx, a);
    });
    return ok({ action: a.action, ...result });
  } catch (e) {
    if (e instanceof ActionError) return err(e.code, e.message, e.status);
    return dbErrorResponse(e);
  }
}
