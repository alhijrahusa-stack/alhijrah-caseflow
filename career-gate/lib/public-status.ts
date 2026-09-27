import "server-only";
import { sql } from "@/lib/db";
import { STATUS_LABELS, type Status } from "@/lib/domain";

function statusLabel(value: string): string {
  return STATUS_LABELS[value as Status] ?? value.replace(/_/g, " ");
}

/** Public-safe projection. Selects only fields the public status page may show. */
export async function publicStatus(clientId: string) {
  const db = sql();
  const [c] = await db`
    select ref, full_name, split_part(full_name, ' ', 1) as first_name,
           current_status, next_step, start_date, created_at, updated_at, city, state
    from clients where id = ${clientId} and deleted_at is null`;
  if (!c) return null;

  const [pref] = await db`
    select city, site_code, site_name, site_address, job_title, shift_name, shift_code, days, hours
    from client_preferences
    where client_id = ${clientId}
    order by case rank when 'primary' then 0 else 1 end, preference_order, created_at
    limit 1`;

  const [interview] = await db`
    select appointment_type, scheduled_at, location, timezone
    from appointments
    where client_id = ${clientId}
      and status in ('scheduled', 'confirmed', 'rescheduled')
      and ends_at >= now()
      and lower(appointment_type) like '%interview%'
    order by scheduled_at
    limit 1`;

  const [docSummary] = await db`
    select count(*)::int as total,
           count(*) filter (where status in ('needs_reupload', 'rejected'))::int as problem
    from documents where client_id = ${clientId}`;

  const historyRows = await db`
    select new_value->>'status' as status, created_at
    from activity_log
    where client_id = ${clientId}
      and action in ('client_created', 'status_changed', 'status_overridden')
      and new_value->>'status' is not null
    order by created_at asc`;

  const history = historyRows.length > 0
    ? historyRows.map((r) => ({
        status: String(r.status),
        label: statusLabel(String(r.status)),
        updated_at: new Date(r.created_at).toISOString(),
      }))
    : [{
        status: String(c.current_status),
        label: statusLabel(String(c.current_status)),
        updated_at: new Date(c.created_at).toISOString(),
      }];

  const fallbackLocation = [c.city, c.state].filter(Boolean).join(", ") || null;

  return {
    ref: c.ref as string,
    full_name: c.full_name as string,
    first_name: c.first_name as string,
    filed_at: new Date(c.created_at).toISOString(),
    status: c.current_status as Status,
    status_label: STATUS_LABELS[c.current_status as Status],
    next_step: c.next_step as string,
    start_date: c.start_date as string | null,
    updated_at: new Date(c.updated_at).toISOString(),
    location: pref
      ? {
          site_code: pref.site_code as string,
          site_name: pref.site_name as string,
          address: pref.site_address as string | null,
          city: pref.city as string,
        }
      : fallbackLocation
        ? { site_code: null, site_name: fallbackLocation, address: null, city: c.city as string | null }
        : null,
    shift: pref
      ? {
          name: (pref.shift_name ?? pref.shift_code) as string,
          days: pref.days as string | null,
          time: pref.hours as string | null,
        }
      : null,
    interview: interview
      ? {
          type: interview.appointment_type as string,
          scheduled_at: new Date(interview.scheduled_at).toISOString(),
          location: interview.location as string | null,
        }
      : null,
    documents: {
      status: Number(docSummary?.total ?? 0) > 0 && Number(docSummary?.problem ?? 0) === 0 ? "Complete" as const : "Missing" as const,
    },
    history,
  };
}

/** Exact public lookup by Career Gate reference, email, or phone. */
export async function publicStatusByIdentifier(identifier: string) {
  const db = sql();
  const raw = identifier.trim();
  if (!raw) return null;

  let client: { id: string } | undefined;
  if (/^CG-\d{4}-\d{6}$/i.test(raw)) {
    [client] = await db`
      select id from clients
      where upper(ref) = ${raw.toUpperCase()} and deleted_at is null
      limit 1` as unknown as [{ id: string }?];
  } else if (raw.includes("@")) {
    [client] = await db`
      select id from clients
      where lower(email) = ${raw.toLowerCase()} and deleted_at is null
      order by updated_at desc
      limit 1` as unknown as [{ id: string }?];
  } else {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 7) return null;
    [client] = await db`
      select id from clients
      where regexp_replace(phone, '\\D', '', 'g') = ${digits} and deleted_at is null
      order by updated_at desc
      limit 1` as unknown as [{ id: string }?];
  }

  return client ? publicStatus(client.id) : null;
}

export type PublicStatus = NonNullable<Awaited<ReturnType<typeof publicStatus>>>;
