import "server-only";
import { sql } from "@/lib/db";
import { STATUS_LABELS, type Status } from "@/lib/domain";

/** Public-safe projection. Selects only fields the status page may show. */
export async function publicStatus(clientId: string) {
  const db = sql();
  const [c] = await db`
    select ref, split_part(full_name, ' ', 1) as first_name, current_status, next_step, start_date, updated_at
    from clients where id = ${clientId} and deleted_at is null`;
  if (!c) return null;
  const [appt] = await db`
    select scheduled_at, location, timezone from appointments
    where client_id = ${clientId} and status in ('scheduled', 'confirmed', 'rescheduled') and ends_at >= now()
    order by scheduled_at limit 1`;
  const pendingDocs = await db`
    select doc_type from documents where client_id = ${clientId} and status = 'needs_reupload'`;
  const pending: string[] = pendingDocs.map((d) => `Upload a clearer copy of your ${String(d.doc_type).replace(/_/g, " ")}`);
  return {
    ref: c.ref as string,
    first_name: c.first_name as string,
    status: c.current_status as Status,
    status_label: STATUS_LABELS[c.current_status as Status],
    next_step: c.next_step as string,
    start_date: c.start_date as string | null,
    updated_at: new Date(c.updated_at).toISOString(),
    appointment: appt ? { scheduled_at: new Date(appt.scheduled_at).toISOString(), location: appt.location as string | null } : null,
    pending_actions: pending,
  };
}
export type PublicStatus = NonNullable<Awaited<ReturnType<typeof publicStatus>>>;
