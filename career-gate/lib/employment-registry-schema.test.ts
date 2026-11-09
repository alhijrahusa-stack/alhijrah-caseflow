import { describe, expect, it } from "vitest";
import { EmploymentConfirmationInput, isCalendarDate } from "@/lib/employment-registry-schema";
import { WORKSITE_OPTIONS } from "@/lib/worksite-change-schema";

describe("explicit actual employment attestation", () => {
  it.each(["2026-11-08", "2024-02-29", "2026-01-31"])("accepts a real calendar day %s", value => {
    expect(isCalendarDate(value)).toBe(true);
  });
  it.each(["2026-02-29", "2026-02-31", "2026-13-01", "2026-00-10", "0000-01-01", "2026-1-01", "2026-11-08T00:00:00Z"])("rejects an invalid or non-date value %s", value => {
    expect(isCalendarDate(value)).toBe(false);
  });
  it("requires an affirmative attestation and a known system location", () => {
    const body = { client_id: "c4313f4e-5762-4343-8729-310da40302b4", operation_id: "d46ccf3e-3650-42e0-90e9-2db1fe14f837",
      expected_updated_at: "2026-11-08 10:30:00+00", actual_start_date: "2026-11-01", site_code: WORKSITE_OPTIONS[0].code, confirmation: true };
    expect(EmploymentConfirmationInput.safeParse(body).success).toBe(true);
    expect(EmploymentConfirmationInput.safeParse({ ...body, confirmation: false }).success).toBe(false);
    expect(EmploymentConfirmationInput.safeParse({ ...body, site_code: "UNKNOWN" }).success).toBe(false);
  });
});
