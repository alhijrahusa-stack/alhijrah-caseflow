import { describe, expect, it } from "vitest";
import { STATUSES, type Status } from "@/lib/domain";
import { G3_STAGES, g3Counts, g3StageForStatus } from "@/lib/g3-stages";

describe("canonical six-stage G3 lifecycle", () => {
  it("classifies all fifteen statuses in exactly one operational station", () => {
    expect(G3_STAGES).toHaveLength(6);
    const statuses = G3_STAGES.flatMap(stage => [...stage.statuses]);
    expect(statuses).toHaveLength(STATUSES.length);
    expect(new Set(statuses).size).toBe(STATUSES.length);
    expect([...statuses].sort()).toEqual([...STATUSES].sort());
    for (const status of STATUSES) expect(g3StageForStatus(status)).not.toBeNull();
    expect(g3StageForStatus("invalid_status")).toBeNull();
  });

  it("counts canonical files exactly once across six stations", () => {
    const values = STATUSES.map((status: Status, index) => ({ status, total: index + 1 }));
    const buckets = g3Counts(values);
    expect(buckets.reduce((sum, stage) => sum + stage.total, 0))
      .toBe(values.reduce((sum, row) => sum + row.total, 0));
    expect(buckets.find(stage => stage.id === "appointments")?.total).toBe(
      values.find(item => item.status === "appointment_scheduled")?.total,
    );
    expect(g3Counts([{ status: "unknown", total: 9 }]).every(stage => stage.total === 0)).toBe(true);
  });

  it("uses safe existing workflow destinations for stage command ribbons", () => {
    for (const stage of G3_STAGES) {
      expect(stage.href).toMatch(/^\/staff\//);
      expect(stage.action.length).toBeGreaterThan(3);
    }
  });
});
