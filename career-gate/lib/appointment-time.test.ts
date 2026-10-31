import { describe, expect, it } from "vitest";
import { appointmentInstant, toLocalInput } from "./format";

describe("Detroit appointment time validation", () => {
  it.each([
    ["2026-01-15T09:30", "2026-01-15T14:30:00.000Z"],
    ["2026-07-15T09:30", "2026-07-15T13:30:00.000Z"],
    ["2026-03-08T03:30", "2026-03-08T07:30:00.000Z"],
    ["2026-11-01T02:30", "2026-11-01T07:30:00.000Z"],
  ])("interprets %s using Detroit offsets", (local, expected) => {
    const instant = appointmentInstant(local);
    expect(instant?.toISOString()).toBe(expected);
    expect(toLocalInput(instant)).toBe(local);
  });

  it.each(["", "bad", "2026-02-30T10:00", "2026-13-01T10:00", "2026-10-29T25:00", "2026-10-29T10:99", "2026-03-08T02:30", "2026-11-01T01:30"])("rejects invalid or ambiguous wall-clock time %s", local => {
    expect(appointmentInstant(local)).toBeNull();
  });
});
