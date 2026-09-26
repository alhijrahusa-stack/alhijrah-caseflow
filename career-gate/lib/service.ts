import "server-only";
import type postgres from "postgres";
import { resolvePreferences, type Selection } from "@/lib/catalog";
import { DEFAULT_NEXT_STEP, type Status } from "@/lib/domain";
import type { Profile } from "@/lib/schemas";

export type Tx = postgres.TransactionSql;

/** Typed failure carried out of a transaction and returned to the caller. */
export class ActionError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export type ActivityAction =
  | "client_created" | "client_updated" | "preference_added" | "preference_removed"
  | "status_changed" | "next_step_changed" | "staff_assigned"
  | "document_uploaded" | "document_verified" | "document_rejected" | "document_opened"
  | "appointment_created" | "appointment_updated" | "appointment_rescheduled" | "appointment_completed"
  | "note_added" | "task_added" | "task_updated" | "task_completed"
  | "contact_logged" | "followup_created" | "followup_completed" | "post_hire_updated";

type Json = postgres.JSONValue;

export async function logActivity(
  tx: Tx,
  a: {
    clientId: string;
    action: ActivityAction;
    handledBy: string | null;
    entityType?: string;
    entityId?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
  },
) {
  await tx`
    insert into activity_log (client_id, action, handled_by, entity_type, entity_id, old_value, new_value)
    values (${a.clientId}, ${a.action}, ${a.handledBy}, ${a.entityType ?? null}, ${a.entityId ?? null},
            ${a.oldValue === undefined ? null : tx.json(a.oldValue as Json)},
            ${a.newValue === undefined ? null : tx.json(a.newValue as Json)})`;
}

export async function requireStaffMember(tx: Tx | postgres.Sql, id: string | null | undefined) {
  if (!id) return null;
  const [row] = await tx`select id from staff_directory where id = ${id} and active`;
  if (!row) throw new ActionError("invalid_staff", "Unknown or inactive staff member");
  return id;
}

export async function requireClient(tx: Tx, id: string) {
  const [row] = await tx`select * from clients where id = ${id} for update`;
  if (!row) throw new ActionError("not_found", "Client not found", 404);
  return row;
}

export type NewClientInput = {
  source: "public" | "office";
  profile: Profile;
  primary: Selection[];
  backup: Selection[];
  status: Status;
  nextStep: string | null;
  handledBy: string | null;
  communicationConsent: boolean;
  idempotencyKey?: string | null;
};

/** Inserts the client, history and preferences in the caller's transaction. */
export async function insertClient(tx: Tx, input: NewClientInput) {
  const prefs = resolvePreferences(input.primary, input.backup);
  if (!prefs.ok) throw new ActionError("invalid_preferences", prefs.error);

  const p = input.profile;
  const [client] = await tx`
    insert into clients (
      source, idempotency_key, full_name, phone, email, date_of_birth, preferred_language,
      street, city, state, zip, appointment_availability,
      amazon_worked_before, amazon_worked_from, amazon_worked_to,
      amazon_applied_before, amazon_application_email,
      communication_consent, current_status, next_step, handled_by
    ) values (
      ${input.source}, ${input.idempotencyKey ?? null}, ${p.full_name}, ${p.phone}, ${p.email}, ${p.date_of_birth},
      ${p.preferred_language}, ${p.street}, ${p.city}, ${p.state}, ${p.zip}, ${p.appointment_availability},
      ${p.amazon_worked_before}, ${p.amazon_worked_from}, ${p.amazon_worked_to},
      ${p.amazon_applied_before}, ${p.amazon_application_email},
      ${input.communicationConsent}, ${input.status},
      ${input.nextStep?.trim() || DEFAULT_NEXT_STEP[input.status]}, ${input.handledBy}
    )
    returning id, ref, status_token`;

  for (const e of p.employment_history) {
    await tx`insert into employment_history (client_id, company, job_title, from_date, to_date)
             values (${client.id}, ${e.company}, ${e.job_title}, ${e.from_date}, ${e.to_date})`;
  }
  for (const r of prefs.rows) {
    await insertPreference(tx, client.id, r);
  }

  await logActivity(tx, {
    clientId: client.id, action: "client_created", handledBy: input.handledBy,
    entityType: "client", entityId: client.id,
    newValue: { source: input.source, ref: client.ref, status: input.status, preferences: prefs.rows.length },
  });

  return client as { id: string; ref: string; status_token: string };
}

export async function insertPreference(
  tx: Tx,
  clientId: string,
  r: ReturnType<typeof resolvePreferences> extends infer R ? R extends { ok: true; rows: (infer X)[] } ? X : never : never,
) {
  const [row] = await tx`
    insert into client_preferences (
      client_id, rank, preference_order, city, site_code, site_name, site_address, job_id, job_title,
      employment_type, shift_code, days, hours, pay_snapshot, catalog_source, catalog_verified_at
    ) values (
      ${clientId}, ${r.rank}, ${r.preference_order}, ${r.city}, ${r.site_code}, ${r.site_name}, ${r.site_address},
      ${r.job_id}, ${r.job_title}, ${r.employment_type}, ${r.shift_code}, ${r.days}, ${r.hours}, ${r.pay},
      ${r.source}, ${r.last_verified_at}
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

export function statusUrl(origin: string, ref: string, token: string) {
  return `${origin}/status/${ref}?t=${token}`;
}
