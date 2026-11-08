"use client";

import { useEffect, useRef, useState } from "react";

/** A finite animation follows a saved count change, never a decorative live signal. */
export function LiveWorkflowCount({ value }: { value: number | undefined }) {
  const [display,setDisplay] = useState(value);
  const [changed,setChanged] = useState(false);
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    const from = previous.current;
    previous.current = value;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.visibilityState === "hidden";
    const start = performance.now();
    const animate = (now: number) => {
      if (value == null || from == null || reduced) { setDisplay(value); return; }
      const progress = Math.min(1,(now-start)/260);
      setDisplay(Math.round(from+(value-from)*(1-Math.pow(1-progress,3))));
      if (progress < 1) frame=requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(now => {
      if (!reduced) { setChanged(true); timer=setTimeout(()=>setChanged(false),850); } else setChanged(false);
      animate(now);
    });
    return () => { cancelAnimationFrame(frame);if(timer)clearTimeout(timer); };
  },[value]);
  return <span className="registry-live-count" data-updated={changed || undefined} aria-label={value == null ? "Count unavailable" : String(value)}>
    <span aria-hidden="true">{display == null ? "—" : display.toLocaleString("en-US")}</span>
    {changed && <i className="registry-count-pulse" aria-hidden="true"/>}
  </span>;
}
