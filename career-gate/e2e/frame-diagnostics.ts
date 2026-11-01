export type FrameCapture = {
  clickTime: number;
  frameTimes: number[];
  longTasks: { startTime: number; duration: number }[];
  longTaskSupported: boolean;
  windowMs: number;
};

export function summarizeFrameCapture(capture: FrameCapture) {
  const offsets = capture.frameTimes.map(time => time - capture.clickTime).filter(time => time >= 0 && time <= capture.windowMs);
  const windows = (from: number, to: number) => {
    const frames = offsets.filter(time => time >= from && time <= to);
    const gaps = frames.slice(1).map((time, index) => time - frames[index]);
    const sorted = [...gaps].sort((a, b) => a - b);
    const duration = frames.length > 1 ? frames.at(-1)! - frames[0] : 0;
    return {
      frames: frames.length,
      observedFps: duration > 0 ? gaps.length * 1000 / duration : null,
      intervalP95Ms: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : null,
      longestIntervalMs: sorted.at(-1) ?? null,
      intervalsAbove20ms: gaps.filter(gap => gap > 20).length,
    };
  };
  const longTasks = capture.longTasks.filter(task => task.startTime < capture.clickTime + capture.windowMs && task.startTime + task.duration > capture.clickTime);
  return {
    windowMs: capture.windowMs,
    firstAnimationFrameDelayMs: offsets[0] ?? null,
    first500ms: windows(0, 500),
    remainingWindow: windows(500, capture.windowMs),
    wholeWindow: windows(0, capture.windowMs),
    longTasks: capture.longTaskSupported ? {
      count: longTasks.length,
      longestMs: longTasks.length ? Math.max(...longTasks.map(task => task.duration)) : null,
      totalOverlapMs: longTasks.reduce((sum, task) => sum + Math.max(0, Math.min(task.startTime + task.duration, capture.clickTime + capture.windowMs) - Math.max(task.startTime, capture.clickTime)), 0),
    } : null,
  };
}
