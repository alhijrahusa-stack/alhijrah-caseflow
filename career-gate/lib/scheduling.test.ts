import { describe, expect, it } from "vitest";
import { generateSlots } from "./scheduling";

// Monday 2030-01-07 08:00 Detroit (13:00Z).
const now = new Date("2030-01-07T13:00:00Z");
const monday = { weekday: 1, start_time: "09:00:00", end_time: "11:00:00", slot_minutes: 30, resource_key: "office", appointment_type: null };

describe("deterministic scheduling", () => {
  it("returns the first three slots in office time", () => {
    const s = generateSlots({ windows: [monday], busy: [], now, days: 7, count: 3 });
    expect(s.map((x) => x.start)).toEqual(["2030-01-07T14:00:00.000Z", "2030-01-07T14:30:00.000Z", "2030-01-07T15:00:00.000Z"]);
  });

  it("subtracts appointments and blocked periods", () => {
    const busy = [{ starts_at: new Date("2030-01-07T14:00:00Z"), ends_at: new Date("2030-01-07T15:00:00Z") }];
    const s = generateSlots({ windows: [monday], busy, now, days: 8, count: 3 });
    expect(s[0].start).toBe("2030-01-07T15:00:00.000Z");
    // Next Monday continues after today's window is exhausted.
    expect(s[2].start).toBe("2030-01-14T14:00:00.000Z");
  });

  it("never offers past slots and respects duration", () => {
    const later = new Date("2030-01-07T14:40:00Z");
    const s = generateSlots({ windows: [monday], busy: [], now: later, days: 1, count: 5, durationMinutes: 60 });
    expect(s.map((x) => x.start)).toEqual(["2030-01-07T15:00:00.000Z"]);
  });

  it("handles DST (America/Detroit)", () => {
    // 2030-03-11 is the Monday after DST starts (UTC-4).
    const s = generateSlots({ windows: [monday], busy: [], now: new Date("2030-03-11T11:00:00Z"), days: 1, count: 1 });
    expect(s[0].start).toBe("2030-03-11T13:00:00.000Z");
  });

  it("returns nothing when no availability is configured", () => {
    expect(generateSlots({ windows: [], busy: [], now, days: 14, count: 3 })).toEqual([]);
  });
});
