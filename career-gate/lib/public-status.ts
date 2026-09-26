import "server-only";
import { timingSafeEqual } from "node:crypto";
import { sql } from "@/lib/db";
import { OPEN_APPOINTMENT } from "@/lib/domain";

/** Public-safe status. Selects only the fields the status page may show. */
export async function publicStatus(ref: string, token: string | undefined) {
  if (!/^CG-\d{4}-\d{6}$/.test(ref) || !token || !/^[0-9a-f]{48}$/.test(token)) return null;
  const db = sql();
  const [c] = await db`
    select id, ref, status_token, current_status, next_step, start_date, updated_at
    from clients where ref = ${ref}`;
  if (!c || !timingSafeEqual(Buffer.from(token), Buffer.from(c.status_token))) return null;
  const [appt] = await db`
    select scheduled_at, location from appointments
    where client_id = ${c.id} and status = any(${OPEN_APPOINTMENT as unknown as string[]}) and scheduled_at >= now()
    order by scheduled_at limit 1`;
  return {
    ref: c.ref as string,
    status: c.current_status as string,
    next_step: c.next_step as string,
    start_date: c.start_date as string | null,
    updated_at: c.updated_at as Date,
    appointment: appt ? { scheduled_at: appt.scheduled_at as Date, location: appt.location as string | null } : null,
  };
}
