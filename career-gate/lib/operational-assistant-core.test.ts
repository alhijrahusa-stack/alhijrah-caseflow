import { describe, expect, it } from "vitest";
import { assistantIntent, projectFlow } from "@/lib/operational-assistant-core";

describe("operational questions and capacity projections", () => {
  it("understands the requested payment question in both interface languages", () => {
    expect(assistantIntent("Who passed this month and has not paid?")).toBe("unpaid_interviews");
    expect(assistantIntent("كم عميلاً نجح هذا الشهر ولم يدفع؟")).toBe("unpaid_interviews");
    expect(assistantIntent("أين اختناق مسار العمل؟")).toBe("flow_forecast");
    expect(assistantIntent("اعرض حمل الفريق الحالي")).toBe("team_load");
    expect(assistantIntent("Which documents need attention?")).toBe("document_blockers");
  });
  it("does not invent an answer for an unsupported question", () => {
    expect(assistantIntent("Write a job offer for this client")).toBe("help");
  });
  it("withholds forecasts for an insufficient historical sample", () => {
    const rows = projectFlow([{ stage: "account", queued: 40, exits_28d: 4, exits_7d: 4 }]);
    expect(rows.find((row) => row.stage === "account")).toMatchObject({ queued: 40, exits_28d: 4, estimated_clearance_days: null, beyond_week_capacity: null, sample: "insufficient" });
    expect(rows.find((row) => row.stage === "job")).toMatchObject({ queued: 0, exits_28d: 0, sample: "insufficient" });
    expect(rows.some((row) => row.stage === "registry")).toBe(false);
  });
  it("projects an explicitly bounded queue from actual stage exit throughput", () => {
    const [row] = projectFlow([{ stage: "intake", queued: 20, exits_28d: 28, exits_7d: 4 }]);
    expect(row).toMatchObject({ queued: 20, exits_28d: 28, exits_7d: 4, estimated_clearance_days: 20, beyond_week_capacity: 13, sample: "sufficient" });
    expect(row).not.toHaveProperty("overdue");
    expect(projectFlow([{ stage: "intake", queued: 0, exits_28d: 28, exits_7d: 7 }])[0]).toMatchObject({ estimated_clearance_days: 0, beyond_week_capacity: 0 });
  });
});
