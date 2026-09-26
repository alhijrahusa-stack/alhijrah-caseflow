import { describe, expect, it } from "vitest";
import { allowedTransitions, guardTransition, sideEffectsFor, STAGES, TERMINAL } from "./engine";

const facts = { verifiedDocuments: 1, scheduledAppointments: 1 };

describe("workflow engine", () => {
  it("allows no transitions out of terminal stages", () => {
    for (const s of TERMINAL) expect(allowedTransitions(s)).toEqual([]);
  });

  it("allows withdrawal from every open stage", () => {
    for (const s of STAGES.filter((s) => !TERMINAL.has(s))) {
      expect(allowedTransitions(s)).toContain("withdrawn");
    }
  });

  it("rejects skipping stages", () => {
    expect(guardTransition("new", "hired", facts)).toMatch(/Cannot move/);
  });

  it("requires a verified document before documents_verified", () => {
    expect(guardTransition("documents_pending", "documents_verified", { ...facts, verifiedDocuments: 0 }))
      .toMatch(/verified/);
    expect(guardTransition("documents_pending", "documents_verified", facts)).toBeNull();
  });

  it("requires a scheduled appointment before appointment_scheduled", () => {
    expect(guardTransition("documents_verified", "appointment_scheduled", { ...facts, scheduledAppointments: 0 }))
      .toMatch(/appointment/);
  });

  it("queues a follow-up task when documents are requested", () => {
    expect(sideEffectsFor("documents_pending").task?.title).toMatch(/Collect/);
  });
});
