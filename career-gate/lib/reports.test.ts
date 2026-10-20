import { describe, expect, it } from "vitest";
import { deriveInsights, parseReportPeriod, percentChange, STALL_DAYS, type ReportKpis } from "@/lib/reports";

const quiet: ReportKpis = {
  newCurrent: 10, newPrevious: 10, last30: 10, completedCurrent: 0, completedPrevious: 0,
  collectedCurrent: 100, collectedPrevious: 100, receivables: 0, active: 5, unassignedActive: 0,
  stalled: 0, medianDaysToComplete: null, documentsAwaitingReview: 0, urgentAlerts: 0,
};

describe("report period", () => {
  it("accepts only the offered periods and defaults to 30 days", () => {
    expect(parseReportPeriod("7")).toBe(7);
    expect(parseReportPeriod(["90", "7"])).toBe(90);
    expect(parseReportPeriod("365")).toBe(30);
    expect(parseReportPeriod(undefined)).toBe(30);
    expect(parseReportPeriod("abc")).toBe(30);
  });
});

describe("percent change", () => {
  it("has no value without a prior base", () => {
    expect(percentChange(5, 0)).toBeNull();
  });
  it("rounds the relative change", () => {
    expect(percentChange(15, 10)).toBe(50);
    expect(percentChange(5, 10)).toBe(-50);
    expect(percentChange(10, 10)).toBe(0);
  });
});

describe("findings", () => {
  it("reports a clear state when nothing needs attention", () => {
    const out = deriveInsights(quiet, [], 30);
    expect(out).toHaveLength(1);
    expect(out[0].tone).toBe("neutral");
  });

  it("states the figures behind every exception and links to where the work is done", () => {
    const out = deriveInsights(
      { ...quiet, urgentAlerts: 2, stalled: 4, unassignedActive: 3, documentsAwaitingReview: 1 },
      [{ status: "needs_review", n: 3, oldest_days: 40 }, { status: "new_intake", n: 1, oldest_days: 15 }],
      30,
    );
    const texts = out.map((i) => i.text).join("\n");
    expect(texts).toContain("2 high or critical audit alerts are open.");
    expect(texts).toContain(`4 active files have had no update for ${STALL_DAYS}+ days.`);
    expect(texts).toContain("Needs Review (3, oldest 40 days)");
    expect(texts).toContain("3 active files have no assigned owner.");
    expect(texts).toContain("1 document awaits staff review.");
    expect(out.map((i) => i.href)).toEqual(["/staff/audit-alerts", "/staff/pipeline", "/staff/staff?tab=assignments", "/staff"]);
    expect(out.every((i) => i.tone === "attention")).toBe(true);
  });

  it("reports trend changes of 20% or more, in either direction, with both figures", () => {
    const up = deriveInsights({ ...quiet, newCurrent: 15, newPrevious: 10 }, [], 7);
    expect(up[0]).toMatchObject({ tone: "positive", text: "New applications are up 50% against the previous 7 days (15 vs 10)." });
    const down = deriveInsights({ ...quiet, collectedCurrent: 50, collectedPrevious: 100 }, [], 30);
    expect(down[0]).toMatchObject({ tone: "attention", text: "Collections are down 50% against the previous 30 days." });
    const small = deriveInsights({ ...quiet, newCurrent: 11, newPrevious: 10 }, [], 30);
    expect(small[0].tone).toBe("neutral");
  });

  it("reports completions with the median duration only when one exists", () => {
    const out = deriveInsights({ ...quiet, completedCurrent: 3, medianDaysToComplete: 12 }, [], 90);
    expect(out[0].text).toBe("3 files completed in the last 90 days; median 12 days from intake to completion.");
    expect(deriveInsights({ ...quiet, completedCurrent: 3, medianDaysToComplete: null }, [], 90)[0].tone).toBe("neutral");
  });
});
