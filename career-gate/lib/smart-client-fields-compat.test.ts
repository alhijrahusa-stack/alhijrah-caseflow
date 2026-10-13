import { describe, expect, it } from "vitest";
import { normalizeShiftDays, normalizeShiftTime, parseShiftRange } from "@/lib/smart-client-fields";

/**
 * Shared-normalizer compatibility.
 *
 * `lib/smart-client-fields.ts` is reachable from the protected Application Intake
 * path through `lib/service.ts`, so adding Arabic readings must leave every existing
 * ASCII reading byte-identical. Each case here is the behaviour as it was before the
 * Arabic support was added, locked so a later widening cannot change it silently.
 */

describe("existing day readings are unchanged", () => {
  it.each([
    ["Thu-Mon", ["THU", "FRI", "SAT", "SUN", "MON"]],
    ["thu - mon", ["THU", "FRI", "SAT", "SUN", "MON"]],
    ["Monday through Friday", ["MON", "TUE", "WED", "THU", "FRI"]],
    ["Mon, Wed, Fri", ["MON", "WED", "FRI"]],
    ["MON/TUE", ["MON", "TUE"]],
    ["MON TUE WED", ["MON", "TUE", "WED"]],
    ["weekdays", ["MON", "TUE", "WED", "THU", "FRI"]],
    ["weekend", ["SAT", "SUN"]],
    ["daily", ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]],
    ["SUN", ["SUN"]],
  ])("reads %s exactly as before", (source, expected) => {
    expect(normalizeShiftDays(source)).toEqual(expected);
  });

  it("still reads a mixed list exactly as it always did", () => {
    // A hyphen has never been a list separator, so "wed-thu" was never a day and the
    // result has always been MON and FRI. The widened range pattern matches this
    // string but cannot resolve it, and must fall through rather than return null.
    expect(normalizeShiftDays("Mon Wed-Thu Fri")).toEqual(["MON", "FRI"]);
  });

  it("falls through to the list when a range-shaped value names no real day", () => {
    expect(normalizeShiftDays("Mon Tue-garbage Fri")).toEqual(["MON", "FRI"]);
  });

  it.each([null, undefined, "", "   ", "not a day", "13"])("still writes nothing for %s", (source) => {
    expect(normalizeShiftDays(source as string | null | undefined)).toBeNull();
  });

  it("still accepts an array of codes", () => {
    expect(normalizeShiftDays(["mon", "FRI"])).toEqual(["MON", "FRI"]);
    expect(normalizeShiftDays([])).toBeNull();
  });
});

describe("existing time readings are unchanged", () => {
  it.each([
    ["6pm", "18:00"],
    ["6PM", "18:00"],
    ["6:30 pm", "18:30"],
    ["12am", "00:00"],
    ["12pm", "12:00"],
    ["18:00", "18:00"],
    ["04:30", "04:30"],
    ["0:00", "00:00"],
    ["23:59", "23:59"],
  ])("reads %s exactly as before", (source, expected) => {
    expect(normalizeShiftTime(source)).toBe(expected);
  });

  it.each([null, undefined, "", "99pm", "13pm", "24:00", "18:60", "noon", "6"])("still writes nothing for %s", (source) => {
    expect(normalizeShiftTime(source as string | null | undefined)).toBeNull();
  });
});

describe("existing range readings are unchanged", () => {
  it.each([
    ["6pm-4:30am", { start: "18:00", end: "04:30", overnight: true }],
    ["6:00 PM to 4:30 AM", { start: "18:00", end: "04:30", overnight: true }],
    ["09:00 - 17:00", { start: "09:00", end: "17:00", overnight: false }],
  ])("reads %s exactly as before", (source, expected) => {
    expect(parseShiftRange(source)).toEqual(expected);
  });

  it.each([null, undefined, "", "6pm", "6pm to", "a to b"])("still writes nothing for %s", (source) => {
    expect(parseShiftRange(source as string | null | undefined)).toBeNull();
  });
});
