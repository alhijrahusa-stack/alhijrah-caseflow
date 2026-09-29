"use client";

import { useEffect } from "react";

/** Presentation-only tactile feedback. Does not mutate application data or session state. */
export function ExecutiveTactileFX() {
  useEffect(() => {
    function play() {
      try {
        const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(210, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(48, ctx.currentTime + 0.024);
        gain.gain.setValueAtTime(0.025, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.026);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.028);
        window.setTimeout(() => void ctx.close(), 80);
      } catch {
        // Browser audio policies may suppress feedback; the control remains fully functional.
      }
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-executive-tactile='true']")) return;
      play();
    }

    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return null;
}
