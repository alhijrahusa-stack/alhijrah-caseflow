/**
 * Dispatch period of a client's primary shift preference — the single
 * definition shared by the pipeline board and the SQL that groups and counts
 * on the server (`DISPATCH_PERIOD_SQL` in `lib/operational-pipeline.ts`).
 * A parity test holds the two to the same answer for the same input.
 */

export const DISPATCH_PERIODS = ["morning", "evening", "night", "needs_manual_review"] as const;
export type DispatchPeriod = (typeof DISPATCH_PERIODS)[number];

/** First "H:MM" in the text with an optional Arabic or Latin meridiem marker. */
export const SHIFT_HOURS_PATTERN = "([0-9]{1,2}):[0-9]{2}\\s*(ص|م|AM|PM|am|pm)?";
const SHIFT_HOURS_RE = new RegExp(SHIFT_HOURS_PATTERN);

export function legacyShiftPeriod(hours: string | null): DispatchPeriod {
  if (!hours) return "needs_manual_review";
  const meridiem = hours.match(SHIFT_HOURS_RE);
  if (!meridiem) return "needs_manual_review";
  let hour = Number(meridiem[1]);
  const marker = (meridiem[2] ?? "").toLowerCase();
  if (marker === "م" || marker === "pm") {
    if (hour < 12) hour += 12;
  } else if ((marker === "ص" || marker === "am") && hour === 12) {
    hour = 0;
  }
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 22) return "evening";
  if (hour >= 0 && hour <= 23) return "night";
  return "needs_manual_review";
}

export function dispatchPeriod(client: { shift_code: string | null; shift_period: string | null; shift_hours: string | null }): DispatchPeriod {
  if (client.shift_code === "night") return "night";
  if (client.shift_code === "morning") return "morning";
  const value = client.shift_period;
  if (value === "morning" || value === "evening" || value === "night" || value === "needs_manual_review") return value;
  if (value === "unspecified") return "needs_manual_review";
  return legacyShiftPeriod(client.shift_hours);
}
