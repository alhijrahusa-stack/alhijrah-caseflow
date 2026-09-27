import "server-only";
import type postgres from "postgres";
import { fromLocalInput, toLocalInput } from "@/lib/format";

// Deterministic scheduling in America/Detroit. No model is involved.
export type Slot = { start: string; end: string; resource_key: string };

type Window = { weekday: number; start_time: string; end_time: string; slot_minutes: number; resource_key: string; appointment_type: string | null };
type Busy = { starts_at: Date; ends_at: Date };

const pad = (n: number) => String(n).padStart(2, "0");
const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};
const weekdayOf = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const hm = (t: string) => t.slice(0, 5);

/** Pure slot generator: windows minus busy intervals, first `count` after `now`. */
export function generateSlots(args: {
  windows: Window[];
  busy: Busy[];
  now: Date;
  days: number;
  count: number;
  durationMinutes?: number;
  appointmentType?: string | null;
}): Slot[] {
  const out: Slot[] = [];
  const today = toLocalInput(args.now).slice(0, 10);
  for (let i = 0; i < args.days && out.length < args.count; i++) {
    const day = addDays(today, i);
    const wd = weekdayOf(day);
    const wins = args.windows
      .filter((w) => w.weekday === wd && (!w.appointment_type || !args.appointmentType || w.appointment_type === args.appointmentType))
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    const candidates: Slot[] = [];
    for (const w of wins) {
      const step = w.slot_minutes;
      const dur = args.durationMinutes ?? step;
      const winStart = fromLocalInput(`${day}T${hm(w.start_time)}`).getTime();
      const winEnd = fromLocalInput(`${day}T${hm(w.end_time)}`).getTime();
      for (let t = winStart; t + dur * 60_000 <= winEnd; t += step * 60_000) {
        const s = t;
        const e = t + dur * 60_000;
        if (s <= args.now.getTime()) continue;
        if (args.busy.some((b) => s < b.ends_at.getTime() && e > b.starts_at.getTime())) continue;
        candidates.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString(), resource_key: w.resource_key });
      }
    }
    candidates.sort((a, b) => a.start.localeCompare(b.start));
    for (const c of candidates) {
      if (out.length >= args.count) break;
      if (!out.some((o) => o.start === c.start && o.resource_key === c.resource_key)) out.push(c);
    }
  }
  return out;
}

async function load(db: postgres.Sql | postgres.TransactionSql, resourceKey: string, from: Date, to: Date) {
  const windows = (await db`
    select weekday, start_time::text, end_time::text, slot_minutes, resource_key, appointment_type
    from office_availability where active and resource_key = ${resourceKey}`) as unknown as Window[];
  const busy = (await db`select starts_at, ends_at from public.cg_busy_intervals(${resourceKey}, ${from}, ${to})`) as unknown as Busy[];
  return { windows, busy };
}

export async function suggestSlots(
  db: postgres.Sql | postgres.TransactionSql,
  opts: { resourceKey?: string; appointmentType?: string | null; durationMinutes?: number; days?: number; count?: number; now?: Date },
) {
  const now = opts.now ?? new Date();
  const days = opts.days ?? 14;
  const resourceKey = opts.resourceKey ?? "office";
  const { windows, busy } = await load(db, resourceKey, now, new Date(now.getTime() + (days + 1) * 86_400_000));
  return generateSlots({ windows, busy, now, days, count: opts.count ?? 3, durationMinutes: opts.durationMinutes, appointmentType: opts.appointmentType });
}

/** Re-checks a slot inside the booking transaction (the exclusion constraint is the final guard). */
export async function slotIsBookable(tx: postgres.TransactionSql, slot: { start: Date; end: Date; resourceKey: string; appointmentType: string | null }) {
  const durationMinutes = Math.round((slot.end.getTime() - slot.start.getTime()) / 60_000);
  const { windows, busy } = await load(tx, slot.resourceKey, new Date(slot.start.getTime() - 86_400_000), new Date(slot.end.getTime() + 86_400_000));
  const now = new Date(Math.min(Date.now(), slot.start.getTime() - 1));
  const slots = generateSlots({ windows, busy, now, days: 2 + Math.ceil((slot.start.getTime() - now.getTime()) / 86_400_000), count: 10_000, durationMinutes, appointmentType: slot.appointmentType });
  return slots.some((s) => s.start === slot.start.toISOString() && s.end === slot.end.toISOString());
}
