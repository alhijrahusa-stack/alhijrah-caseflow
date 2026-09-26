import { describe, expect, it } from "vitest";
import fixture from "@/e2e/fixtures/job-catalog.test.json";
import { activeOptions, resolvePreferences } from "./catalog";
import { STATUSES } from "./domain";
import { normalizePhone, ProfileSchema } from "./schemas";

const opts = activeOptions(fixture as never);

describe("catalog", () => {
  it("lists only active site → job → shift combinations", () => {
    expect(opts.map((o) => o.key).sort()).toEqual(["TST1|J-A|S1", "TST1|J-A|S2", "TST2|J-B|S9"]);
  });

  it("keeps catalog facts verbatim and leaves missing facts null", () => {
    const s1 = opts.find((o) => o.key === "TST1|J-A|S1")!;
    expect(s1.pay).toBe("$1.11/hr (fixture)");
    expect(s1.hours).toBe("07:00 – 17:30");
    const s9 = opts.find((o) => o.key === "TST2|J-B|S9")!;
    expect(s9.pay).toBeNull();
    expect(s9.hours).toBeNull();
  });

  it("orders primary before backup with global preference_order", () => {
    const r = resolvePreferences(
      [{ site_code: "TST1", job_id: "J-A", shift_code: "S2" }, { site_code: "TST1", job_id: "J-A", shift_code: "S1" }],
      [{ site_code: "TST2", job_id: "J-B", shift_code: "S9" }],
      opts,
    );
    expect(r.ok && r.rows.map((x) => [x.rank, x.preference_order, x.shift_code])).toEqual([
      ["primary", 1, "S2"], ["primary", 2, "S1"], ["backup", 3, "S9"],
    ]);
  });

  it("rejects cross-site job combinations, inactive shifts and duplicates", () => {
    expect(resolvePreferences([{ site_code: "TST2", job_id: "J-A", shift_code: "S1" }], [], opts).ok).toBe(false);
    expect(resolvePreferences([{ site_code: "TST1", job_id: "J-A", shift_code: "S3" }], [], opts).ok).toBe(false);
    expect(resolvePreferences([{ site_code: "TST3", job_id: "J-C", shift_code: "S1" }], [], opts).ok).toBe(false);
    const dup = { site_code: "TST1", job_id: "J-A", shift_code: "S1" };
    expect(resolvePreferences([dup], [dup], opts).ok).toBe(false);
  });
});

describe("profile validation", () => {
  const base = { full_name: "Test Person", phone: "(313) 555-0100", employment_history: [] };

  it("normalizes US phone numbers", () => {
    expect(normalizePhone("+1 313 555 0100")).toBe("3135550100");
    expect(normalizePhone("555-0100")).toBeNull();
  });

  it("drops conditional Amazon answers when the parent answer is No", () => {
    const p = ProfileSchema.parse({ ...base, amazon_worked_before: false, amazon_worked_from: "2020-01-01", amazon_applied_before: false, amazon_application_email: "a@b.co" });
    expect(p.amazon_worked_from).toBeNull();
    expect(p.amazon_application_email).toBeNull();
  });

  it("rejects reversed employment dates", () => {
    const r = ProfileSchema.safeParse({ ...base, employment_history: [{ company: "X", job_title: "Y", from_date: "2024-01-01", to_date: "2023-01-01" }] });
    expect(r.success).toBe(false);
  });

  it("has exactly the fifteen required statuses", () => {
    expect(STATUSES).toHaveLength(15);
  });
});
