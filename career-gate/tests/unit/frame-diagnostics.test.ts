import { describe, expect, it } from "vitest";
import { summarizeFrameCapture } from "../../e2e/frame-diagnostics";

describe("frame diagnostics", () => {
  it("uses the click as its origin and reports windows and overlapping long tasks", () => {
    const report = summarizeFrameCapture({
      clickTime: 1000,
      windowMs: 1200,
      frameTimes: [1008, 1024, 1040, 1070, 1510, 1526, 2220],
      longTasks: [{ startTime: 990, duration: 80 }, { startTime: 2150, duration: 100 }, { startTime: 2300, duration: 100 }],
      longTaskSupported: true,
    });
    expect(report.firstAnimationFrameDelayMs).toBe(8);
    expect(report.first500ms.frames).toBe(4);
    expect(report.first500ms.longestIntervalMs).toBe(30);
    expect(report.first500ms.intervalsAbove20ms).toBe(1);
    expect(report.remainingWindow.frames).toBe(2);
    expect(report.longTasks).toEqual({ count: 2, longestMs: 100, totalOverlapMs: 120 });
  });

  it("reports missing evidence without inventing FPS or long-task support", () => {
    const report = summarizeFrameCapture({ clickTime: 100, frameTimes: [], longTasks: [], longTaskSupported: false, windowMs: 1200 });
    expect(report.firstAnimationFrameDelayMs).toBeNull();
    expect(report.wholeWindow.observedFps).toBeNull();
    expect(report.longTasks).toBeNull();
  });
});
