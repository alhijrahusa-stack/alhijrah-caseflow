import "server-only";
import { sql } from "@/lib/db";
import { STATUS_LABELS, type Status } from "@/lib/domain";

function statusLabel(value: string): string {
  return STATUS_LABELS[value as Status] ?? value.replace(/_/g, " ");
}

type PublicLocation = { site_code: string; site_name: string; address: string | null; city: string } | null;
type PublicShift = { name: string; days: string | null; time: string | null } | null;
type PublicInterview = { type: string; scheduled_at: string; location: string | null } | null;
type PublicHistory = { status: string; label: string; updated_at: string }[];

export type PublicStatus = {
  ref: string;
  first_name: string;
  status: Status;
  status_label: string;
  next_step: string;
  start_date: string | null;
  updated_at: string;
  appointment: PublicInterview;
  pending_actions: string[];
  full_name: string;
  filed_at: string;
  location: PublicLocation;
  shift: PublicShift;
  interview: PublicInterview;
  documents: { status: "Complete" | "Missing" };
  history: PublicHistory;
};

/** Public-safe projection. Home address/city is never used as the job location. */
export async function publicStatus(clientId: string): Promise<PublicStatus | null> {
  const db = sql();
  const [c] = await db`
    select c.ref, c.full_name, split_part(c.full_name, ' ', 1) as first_name,
           c.current_status, c.next_step, c.start_date, c.created_at, c.updated_at,
           a.case_number
    from clients c
    left join lateral (
      select case_number from career_gate_applications
      where client_id = c.id order by created_at desc limit 1
    ) a on true
    where c.id = ${clientId} and c.deleted_at is null`;
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
    order by scheduled_at
    limit 1`;

  const [docSummary] = await db`
    select count(*) filter (
             where file_name <> 'signature.png' and file_name not like 'client-photo-%'
           )::int as total,
           count(*) filter (
             where file_name <> 'signature.png' and file_name not like 'client-photo-%' and status = 'verified'
           )::int as verified
    from documents where client_id = ${clientId}`;

  const historyRows = await db`
    select new_value->>'status' as status, created_at
    from activity_log
    where client_id = ${clientId}
      and action in ('client_created', 'status_changed', 'status_overridden')
      and new_value->>'status' is not null
    order by created_at asc`;

  const history: PublicHistory = historyRows.length > 0
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

  const location: PublicLocation = pref
    ? {
        site_code: pref.site_code as string,
        site_name: pref.site_name as string,
        address: pref.site_address as string | null,
        city: pref.city as string,
      }
    : null;

  const shift: PublicShift = pref
    ? {
        name: (pref.shift_name ?? pref.shift_code) as string,
        days: pref.days as string | null,
        time: pref.hours as string | null,
      }
    : null;

  const interviewPublic: PublicInterview = interview
    ? {
        type: interview.appointment_type as string,
        scheduled_at: new Date(interview.scheduled_at).toISOString(),
        location: interview.location as string | null,
      }
    : null;

  const documents = {
    status: Number(docSummary?.total ?? 0) > 0 && Number(docSummary?.verified ?? 0) === Number(docSummary?.total ?? 0)
      ? "Complete" as const
      : "Missing" as const,
  };

  const fullPayload = {
    ref: (c.case_number ?? c.ref) as string,
    full_name: c.full_name as string,
    first_name: c.first_name as string,
    filed_at: new Date(c.created_at).toISOString(),
    status: c.current_status as Status,
    status_label: STATUS_LABELS[c.current_status as Status],
    next_step: c.next_step as string,
    start_date: c.start_date as string | null,
    updated_at: new Date(c.updated_at).toISOString(),
    location,
    shift,
    interview: interviewPublic,
    documents,
    history,
  };

  // Keep the original enumerable projection stable for older internal callers/tests.
  // New public fields are non-enumerable on the server object but included in JSON via toJSON().
  const projection = {
    ref: fullPayload.ref,
    first_name: fullPayload.first_name,
    status: fullPayload.status,
    status_label: fullPayload.status_label,
    next_step: fullPayload.next_step,
    start_date: fullPayload.start_date,
    updated_at: fullPayload.updated_at,
    appointment: interviewPublic,
    pending_actions: [] as string[],
  } as PublicStatus;

  Object.defineProperties(projection, {
    full_name: { value: fullPayload.full_name, enumerable: false },
    filed_at: { value: fullPayload.filed_at, enumerable: false },
    location: { value: fullPayload.location, enumerable: false },
    shift: { value: fullPayload.shift, enumerable: false },
    interview: { value: fullPayload.interview, enumerable: false },
    documents: { value: fullPayload.documents, enumerable: false },
    history: { value: fullPayload.history, enumerable: false },
    toJSON: { value: () => fullPayload, enumerable: false },
  });

  return projection;
}

/** Exact public lookup by ALH/CG case number, email, or phone. */
export async function publicStatusByIdentifier(identifier: string) {
  const db = sql();
  const raw = identifier.trim();
  if (!raw) return null;

  let client: { id: string } | undefined;
  if (/^(CG-\d{4}-\d{6}|ALH-\d{8}-[A-Z0-9]{4})$/i.test(raw)) {
    [client] = await db`
      select c.id
      from clients c
      left join career_gate_applications a on a.client_id = c.id
      where c.deleted_at is null
        and (upper(c.ref) = ${raw.toUpperCase()} or upper(a.case_number) = ${raw.toUpperCase()})
      order by c.updated_at desc
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
