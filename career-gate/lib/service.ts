import "server-only";
import type postgres from "postgres";
import { catalogVersion, resolvePreferences, type Selection } from "@/lib/catalog";
import { DEFAULT_NEXT_STEP, type Status } from "@/lib/domain";
import type { Profile } from "@/lib/schemas";

export type Tx = postgres.TransactionSql;
type Json = postgres.JSONValue;

/** Typed failure carried out of a transaction and returned to the caller. */
export class ActionError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export type ActivityAction =
  | "client_created" | "client_updated" | "client_deleted" | "preference_added" | "preference_removed"
  | "status_changed" | "status_overridden" | "next_step_changed" | "staff_assigned"
  | "document_uploaded" | "document_processing_started" | "document_processed" | "document_verified"
  | "document_rejected" | "document_reupload_requested" | "document_opened"
  | "appointment_created" | "appointment_updated" | "appointment_rescheduled" | "appointment_completed"
  | "note_added" | "task_added" | "task_updated" | "task_completed"
  | "contact_logged" | "followup_created" | "followup_completed"
  | "assessment_updated" | "post_hire_updated" | "agent_alert_created" | "agent_run"
  | "notification_queued" | "notification_sent" | "notification_failed" | "notification_not_configured"
  | "status_otp_requested" | "status_otp_verified";

export type Actor = { staffId: string | null; traceId: string };

export async function logActivity(
  tx: Tx | postgres.Sql,
  a: {
    clientId: string;
    action: ActivityAction;
    actor: Actor;
    entityType?: string;
    entityId?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
  },
) {
  await tx`
    insert into activity_log (client_id, action, staff_id, entity_type, entity_id, old_value, new_value, trace_id)
    values (${a.clientId}, ${a.action}, ${a.actor.staffId}, ${a.entityType ?? null}, ${a.entityId ?? null},
            ${a.oldValue === undefined ? null : tx.json(a.oldValue as Json)},
            ${a.newValue === undefined ? null : tx.json(a.newValue as Json)}, ${a.actor.traceId})`;
}

export async function requireClient(tx: Tx, id: string) {
  const [row] = await tx`select * from clients where id = ${id} for update`;
  if (!row) throw new ActionError("not_found", "Client not found", 404);
  return row;
}

export async function requireStaffMember(tx: Tx, id: string | null | undefined) {
  if (!id) return null;
  const [row] = await tx`select id from staff where id = ${id} and active`;
  if (!row) throw new ActionError("invalid_staff", "Unknown or inactive staff member");
  return id;
}

export type NewClientInput = {
  source: "public_intake" | "staff_manual";
  profile: Profile;
  primary: Selection[];
  backup: Selection[];
  status: Status;
  nextStep: string | null;
  assignedStaff: string | null;
  createdBy: string | null;
  communicationConsent: boolean;
};

export type ClientIdentityMatch = {
  id: string;
  ref: string;
  created_at: Date;
  pipeline_stage: string | null;
  assigned_staff: string | null;
  owner: string | null;
};

export function normalizeClientEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

export function normalizeClientPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits || null;
}

/** Serializes identity decisions using the same keys enforced by the database duplicate guard. */
export async function lockClientIdentity(tx: Tx, emailInput: string | null | undefined, phoneInput: string | null | undefined) {
  const email = normalizeClientEmail(emailInput);
  const phone = normalizeClientPhone(phoneInput);
  if (email) await tx`select pg_advisory_xact_lock(hashtextextended(${`cg-email:${email}`}, 0))`;
  if (phone) await tx`select pg_advisory_xact_lock(hashtextextended(${`cg-phone:${phone}`}, 0))`;
  return { email, phone };
}

/** Canonical active-client identity lookup used by every intake adapter. */
export async function findClientIdentityMatches(
  tx: Tx,
  emailInput: string | null | undefined,
  phoneInput: string | null | undefined,
  opts: { lock?: boolean; forUpdate?: boolean } = {},
): Promise<ClientIdentityMatch[]> {
  const identity = opts.lock
    ? await lockClientIdentity(tx, emailInput, phoneInput)
    : { email: normalizeClientEmail(emailInput), phone: normalizeClientPhone(phoneInput) };
  if (!identity.email && !identity.phone) return [];

  const lockClause = opts.forUpdate ? " for update" : "";
  const rows = await tx.unsafe(
    `select c.id,c.ref,c.created_at,c.pipeline_stage,c.assigned_staff,s.display_name as owner
       from clients c
       left join staff s on s.id=c.assigned_staff
      where c.deleted_at is null
        and (($1::text is not null and lower(trim(coalesce(c.email,'')))=$1)
          or ($2::text is not null and regexp_replace(coalesce(c.phone,''),'\\D','','g')=$2))
      order by c.created_at${lockClause}`,
    [identity.email, identity.phone],
  );
  return rows as unknown as ClientIdentityMatch[];
}

/** Inserts the client, history and preferences in the caller's transaction. */
export async function insertClient(tx: Tx, input: NewClientInput, actor: Actor) {
  const prefs = resolvePreferences(input.primary, input.backup);
  if (!prefs.ok) throw new ActionError("invalid_preferences", prefs.error);

  const p = input.profile;
  const duplicate = (await findClientIdentityMatches(tx, p.email, p.phone, { lock: true }))[0] ?? null;
  if (duplicate) {
    if (actor.staffId) {
      throw new ActionError(
        "duplicate_client",
        `تنبيه النظام: الملف ${duplicate.ref} مسجل حالياً في قسم ${String(duplicate.pipeline_stage).replace(/_/g, " ")} ويتبع الموظف ${duplicate.owner ?? "Unassigned"}. افتح الملف الحالي أو اطلب نقل الملكية بدلاً من إنشاء نسخة جديدة.`,
        409,
      );
    }
    throw new ActionError(
      "duplicate_application",
      "An application already exists for this phone number or email. Use Track Status or contact the office instead of submitting another application.",
      409,
    );
  }

  const [client] = await tx`
    insert into clients (
      source, full_name, phone, email, date_of_birth, preferred_language, english_proficiency,
      street, city, state, zip, appointment_availability,
      amazon_worked_before, amazon_worked_from, amazon_worked_to,
      amazon_applied_before, amazon_application_email, currently_amazon, via_agency,
      communication_consent, current_status, next_step, assigned_staff, created_by
    ) values (
      ${input.source}, ${p.full_name}, ${p.phone}, ${p.email}, ${p.date_of_birth},
      ${p.preferred_language}, ${p.english_proficiency}, ${p.street}, ${p.city}, ${p.state}, ${p.zip}, ${p.appointment_availability},
      ${p.amazon_worked_before}, ${p.amazon_worked_from}, ${p.amazon_worked_to},
      ${p.amazon_applied_before}, ${p.amazon_application_email}, ${p.currently_amazon}, ${p.via_agency},
      ${input.communicationConsent}, ${input.status},
      ${input.nextStep?.trim() || DEFAULT_NEXT_STEP[input.status]}, ${input.assignedStaff}, ${input.createdBy}
    )
    returning id, ref, created_at`;

  await insertEmployment(tx, client.id, p.employment_history);
  for (const r of prefs.rows) await insertPreference(tx, client.id, r);

  await logActivity(tx, {
    clientId: client.id, action: "client_created", actor, entityType: "client", entityId: client.id,
    newValue: { source: input.source, ref: client.ref, status: input.status, preferences: prefs.rows.length },
  });
  return client as { id: string; ref: string; created_at: Date };
}

export async function insertEmployment(tx: Tx, clientId: string, rows: Profile["employment_history"]) {
  for (const e of rows) {
    await tx`insert into employment_history (client_id, employment_kind, company, job_title, from_date, to_date)
             values (${clientId}, ${e.employment_kind}, ${e.company}, ${e.job_title}, ${e.from_date}, ${e.to_date})`;
  }
}

type PrefRow = Extract<ReturnType<typeof resolvePreferences>, { ok: true }>["rows"][number];

export async function insertPreference(tx: Tx, clientId: string, r: PrefRow) {
  const [row] = await tx`
    insert into client_preferences (
      client_id, rank, preference_order, city, site_code, site_name, site_address, job_id, job_title,
      employment_type, shift_code, days, hours, pay_snapshot, availability_snapshot, catalog_source,
      catalog_verified_at, catalog_version, amazon_job_id, shift_name, source_url, source_verified_at, pay_detail
    ) values (
      ${clientId}, ${r.rank}, ${r.preference_order}, ${r.city}, ${r.site_code}, ${r.site_name}, ${r.site_address},
      ${r.job_id}, ${r.job_title}, ${r.employment_type}, ${r.shift_code}, ${r.days}, ${r.hours}, ${r.pay},
      ${r.availability}, ${r.source}, ${r.last_verified_at}, ${catalogVersion}, ${r.job_id}, ${r.shift_name},
      ${r.source_url}, ${r.last_verified_at}, ${tx.json(r.pay_detail as never)}
    ) returning id`;
  return row.id as string;
}

/** Renumbers preferences so primaries come first, preserving relative order. */
export async function renumberPreferences(tx: Tx, clientId: string) {
  await tx`
    with ordered as (
      select id, row_number() over (order by case rank when 'primary' then 0 else 1 end, preference_order, created_at) as n
      from client_preferences where client_id = ${clientId}
    )
    update client_preferences p set preference_order = o.n from ordered o where p.id = o.id`;
}

export async function touchClient(tx: Tx, clientId: string) {
  await tx`update clients set updated_at = now() where id = ${clientId}`;
}
