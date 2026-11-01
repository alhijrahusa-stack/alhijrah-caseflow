import { describe, expect, it } from "vitest";
import { formatClient360Date } from "./client360-date";

describe("Client 360 office dates", () => {
  it("preserves Detroit wall time across the daylight-saving transition", () => {
    expect(formatClient360Date("2026-11-01T05:30:00Z")).toBe("Nov 1, 2026, 1:30 AM");
    expect(formatClient360Date("2026-11-01T07:30:00Z")).toBe("Nov 1, 2026, 2:30 AM");
  });

  it("preserves missing and invalid values", () => {
    expect(formatClient360Date(undefined)).toBe("—");
    expect(formatClient360Date("")).toBe("—");
    expect(formatClient360Date("not a date")).toBe("not a date");
  });
});
