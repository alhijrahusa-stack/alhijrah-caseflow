import "server-only";
import { sql } from "@/lib/db";
import { log } from "@/lib/obs";

// Career Gate policy limits (not provider limits). Persistent in Postgres so
// they hold across serverless instances.
export const LIMITS = {
  intake_attempt_hour: { window: 3600, limit: 5 },
  intake_accept_5min: { window: 300, limit: 1 },
  status_lookup_15min: { window: 900, limit: 5 },
  status_lookup_hour: { window: 3600, limit: 20 },
  otp_send_hour: { window: 3600, limit: 5 },
  status_verify_15min: { window: 900, limit: 20 },
  staff_action_minute: { window: 60, limit: 100 },
  staff_action_hour: { window: 3600, limit: 1000 },
  login_failed_15min: { window: 900, limit: 5 },
  login_send_15min: { window: 900, limit: 5 },
  document_upload_hour: { window: 3600, limit: 10 },
} as const;

export type LimitName = keyof typeof LIMITS;

/** Records a hit; returns false when over the limit. */
export async function hit(name: LimitName, keyHash: string): Promise<boolean> {
  const { window, limit } = LIMITS[name];
  const [r] = await sql()`select public.rate_limit_hit(${name}, ${keyHash}, ${window}, ${limit}) as ok`;
  return r.ok as boolean;
}

/** Checks the current count without recording a hit. */
export async function remaining(name: LimitName, keyHash: string): Promise<number> {
  const { window, limit } = LIMITS[name];
  const [r] = await sql()`select public.rate_limit_count(${name}, ${keyHash}, ${window}) as n`;
  return limit - (r.n as number);
}

/** Checks several limits, recording a hit on each; false if any is exceeded. */
export async function hitAll(names: LimitName[], keyHash: string) {
  let ok = true;
  for (const n of names) if (!(await hit(n, keyHash))) ok = false;
  return ok;
}

export async function securityEvent(e: {
  event: string;
  staffId?: string | null;
  ipHash?: string | null;
  route?: string;
  detail?: Record<string, unknown>;
  traceId?: string;
}) {
  log("warn", { security_event: e.event, route: e.route, trace_id: e.traceId, staff_id: e.staffId ?? null });
  await sql()`
    insert into security_events (event, staff_id, ip_hash, route, detail, trace_id)
    values (${e.event}, ${e.staffId ?? null}, ${e.ipHash ?? null}, ${e.route ?? null},
            ${sql().json((e.detail ?? {}) as never)}, ${e.traceId ?? null})`;
}
