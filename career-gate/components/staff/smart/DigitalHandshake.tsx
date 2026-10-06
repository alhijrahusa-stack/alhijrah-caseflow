"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The approved Digital Handshake: a single 1px light sweep marking one authoritative
 * completion. It is purely decorative reinforcement — it never gates data, never blocks
 * the pointer and never replays on re-render. Under reduced motion it degrades to a
 * short opacity fade so the completion is still visible without travel.
 */
export type HandshakeTone = "cyan" | "gold" | "emerald";

const SWEEP_MS = 550;

const TONE_GRADIENT: Record<HandshakeTone, string> = {
  cyan: "from-transparent via-cyan-100 to-cyan-300/0 shadow-[0_0_16px_rgba(165,243,252,.45)]",
  gold: "from-transparent via-[#f0d99d] to-cyan-100 shadow-[0_0_16px_rgba(227,200,132,.45)]",
  emerald: "from-transparent via-emerald-200 to-emerald-300/0 shadow-[0_0_16px_rgba(110,231,183,.42)]",
};

export function useDigitalHandshake() {
  const timer = useRef<number | null>(null);
  const [sweep, setSweep] = useState<{ tone: HandshakeTone; id: number } | null>(null);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const trigger = useCallback((tone: HandshakeTone) => {
    if (timer.current) window.clearTimeout(timer.current);
    setSweep({ tone, id: Date.now() });
    timer.current = window.setTimeout(() => setSweep(null), SWEEP_MS + 150);
  }, []);

  return { sweep, trigger };
}

export function DigitalHandshake({ sweep }: { sweep: { tone: HandshakeTone; id: number } | null }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden">
      {sweep && (
        <span
          key={sweep.id}
          className={`block h-full w-1/3 bg-gradient-to-r ${TONE_GRADIENT[sweep.tone]} motion-safe:animate-[cg-handshake_550ms_ease-out_forwards] motion-reduce:animate-[cg-handshake-fade_320ms_ease-out_forwards]`}
        />
      )}
    </span>
  );
}
