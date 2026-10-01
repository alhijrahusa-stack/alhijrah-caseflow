"use client";

import { useEffect } from "react";

let sharedAudioContext: AudioContext | null = null;

function audioContext() {
  if (sharedAudioContext) return sharedAudioContext;
  const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  sharedAudioContext = new AudioCtx();
  return sharedAudioContext;
}

/** Presentation-only tactile feedback. Visual feedback is CSS-first; audio is explicit opt-in. */
export function ExecutiveTactileFX() {
  useEffect(() => {
    async function play() {
      try {
        const ctx = audioContext();
        if (!ctx) return;
        if (ctx.state === "suspended") await ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(210, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(48, ctx.currentTime + 0.024);
        gain.gain.setValueAtTime(0.018, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.026);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.028);
      } catch {
        // Browser audio policy may suppress optional sound; visual controls remain fully functional.
      }
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-executive-audio='true']")) return;
      void play();
    }

    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return null;
}
