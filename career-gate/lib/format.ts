import { OFFICE } from "@/lib/office";

const tz = OFFICE.timeZone;
// The locale and office zone are fixed. Reuse their ICU formatters instead of
// rebuilding them for every row in a client timeline or task list.
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: tz });
const dateOnlyFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const timeFormatter = new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: tz });
const localInputFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const fullDateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: tz });

export function dateTime(v: Date | string | null | undefined) {
  if (!v) return "—";
  return dateTimeFormatter.format(new Date(v));
}

export function dateOnly(v: string | null | undefined) {
  if (!v) return "—";
  const [y, m, d] = v.split("-").map(Number);
  return dateOnlyFormatter.format(new Date(Date.UTC(y, m - 1, d)));
}

export function timeOnly(v: Date | string) {
  return timeFormatter.format(new Date(v));
}

export function formatPhone(digits: string | null | undefined) {
  if (!digits) return "—";
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : digits;
}

/** YYYY-MM-DDTHH:mm in office time, for datetime-local inputs. */
export function toLocalInput(v: Date | string | null | undefined) {
  if (!v) return "";
  const parts = localInputFormatter.formatToParts(new Date(v));
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Interprets a datetime-local value as office (Detroit) wall-clock time. */
export function fromLocalInput(local: string): Date {
  const [datePart, timePart] = local.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // Offset of the office zone at that instant, applied twice to settle DST edges.
  const offset = (t: number) => {
    const s = toLocalInput(new Date(t));
    const [dp, tp] = s.split("T");
    const [yy, mm, dd] = dp.split("-").map(Number);
    const [hh, mn] = tp.split(":").map(Number);
    return Date.UTC(yy, mm - 1, dd, hh, mn) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t);
}

export function todayInOffice() {
  return toLocalInput(new Date()).slice(0, 10);
}

export function dateOfInstant(v: Date | string) {
  return fullDateFormatter.format(new Date(v));
}
