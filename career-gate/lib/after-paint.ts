/**
 * Runs `fn` after the browser has presented the next frame: the animation
 * frame callback runs just before that frame paints, and the task it queues
 * runs after. Work started here cannot delay the paint that answers the
 * interaction which scheduled it. Returns a cancel function.
 */
export function afterNextPaint(fn: () => void): () => void {
  let timer: number | undefined;
  const frame = window.requestAnimationFrame(() => {
    timer = window.setTimeout(fn, 0);
  });
  return () => {
    window.cancelAnimationFrame(frame);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
