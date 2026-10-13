"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { SmartField } from "@/components/staff/smart/field-contract";

/**
 * Smart Progress Rail.
 *
 * A glass rail above the capture surface that reports what has actually been
 * captured. It owns no data: coverage, the submit gate and the active field all
 * arrive as props from the surface's own state, so the rail can never show
 * progress that has not happened.
 *
 * Every effect is a consequence of a real state change:
 *   assemble   the page opened
 *   particle   a field went from empty to filled
 *   burst      the submit gate became satisfied
 *   unsettled  a required field is still empty when submit was attempted
 *   laser      a field is focused and being filled
 *
 * Under `prefers-reduced-motion` no particle, burst piece or laser is created at
 * all — not merely hidden — so the rail costs nothing in that mode. The rail's
 * state is always carried in text and announced, never in colour alone.
 */

const MAX_PARTICLES = 14;
const MAX_BURST_PIECES = 18;
const PARTICLE_LIFETIME_MS = 1400;
const BURST_LIFETIME_MS = 1500;

type Particle = { id: string; x: number; y: number; dx: number; dy: number; delay: number; gold: boolean };
type BurstPiece = { id: string; dx: number; dy: number; delay: number; gold: boolean };
type Laser = { x: number; y: number; height: number };

export type RailState = "AWAITING" | "CAPTURING" | "READY" | "WARNING" | "SUBMITTED";

const STATE_COPY: Record<RailState, { label: string; tone: string; fill: string }> = {
  AWAITING: { label: "AWAITING SOURCE", tone: "text-slate-400", fill: "linear-gradient(90deg,rgba(148,163,184,.5),rgba(148,163,184,.25))" },
  CAPTURING: { label: "CAPTURING", tone: "text-cyan-200", fill: "linear-gradient(90deg,rgba(34,211,238,.75),rgba(125,211,252,.45))" },
  READY: { label: "READY TO SUBMIT", tone: "text-emerald-200", fill: "linear-gradient(90deg,rgba(52,211,153,.8),rgba(227,200,132,.6))" },
  WARNING: { label: "REQUIRED FIELD MISSING", tone: "text-amber-200", fill: "linear-gradient(90deg,rgba(251,146,60,.85),rgba(251,191,36,.5))" },
  SUBMITTED: { label: "SOURCE STAGED", tone: "text-emerald-200", fill: "linear-gradient(90deg,rgba(52,211,153,.85),rgba(52,211,153,.5))" },
};

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export const SmartProgressRail = memo(function SmartProgressRail({
  fields,
  filledKeys,
  requiredComplete,
  requiredTotal,
  state,
  activeFieldKey,
  warningNonce,
  audioEnabled,
  onTone,
}: {
  fields: readonly SmartField[];
  /** Contract keys that currently hold a value. The rail reads, never derives. */
  filledKeys: readonly string[];
  requiredComplete: number;
  requiredTotal: number;
  state: RailState;
  /** The field the person is filling now, for the pointer line. */
  activeFieldKey: string | null;
  /** Increments each time a blocked submit is attempted, so the rail reacts once. */
  warningNonce: number;
  audioEnabled: boolean;
  onTone: (kind: "detect" | "submit" | "error") => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const previousFilled = useRef<Set<string>>(new Set());
  const burstFired = useRef(false);
  const firstPaint = useRef(true);

  const [particles, setParticles] = useState<Particle[]>([]);
  const [burst, setBurst] = useState<BurstPiece[]>([]);
  const [laser, setLaser] = useState<Laser | null>(null);

  const filled = useMemo(() => new Set(filledKeys), [filledKeys]);
  const coverage = fields.length ? filled.size / fields.length : 0;
  const copy = STATE_COPY[state];
  const announceId = useId();

  /** The rail's own anchor point, in viewport coordinates. */
  const railAnchor = useCallback(() => {
    const box = railRef.current?.getBoundingClientRect();
    if (!box) return null;
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, []);

  // B — a field that just took a value sends one particle to the rail.
  useEffect(() => {
    const previous = previousFilled.current;
    const gained = [...filled].filter((key) => !previous.has(key));
    previousFilled.current = new Set(filled);

    // The first paint is not a transition: a restored draft must not fire a storm.
    if (firstPaint.current) {
      firstPaint.current = false;
      return;
    }
    if (!gained.length || prefersReducedMotion()) return;

    const anchor = railAnchor();
    if (!anchor) return;

    const created: Particle[] = [];
    for (const [index, key] of gained.slice(0, MAX_PARTICLES).entries()) {
      const source = document.querySelector<HTMLElement>(`[data-field="${key}"]`);
      const box = source?.getBoundingClientRect();
      if (!box || box.width === 0) continue;
      const from = { x: box.left + box.width * 0.18, y: box.top + box.height / 2 };
      created.push({
        id: `${key}-${Date.now()}-${index}`,
        x: from.x,
        y: from.y,
        dx: anchor.x - from.x,
        dy: anchor.y - from.y,
        delay: index * 70,
        gold: index % 2 === 1,
      });
    }
    if (!created.length) return;

    setParticles((current) => [...current, ...created].slice(-MAX_PARTICLES));
    if (audioEnabled) onTone("detect");
    const timer = window.setTimeout(() => {
      const ids = new Set(created.map((item) => item.id));
      setParticles((current) => current.filter((item) => !ids.has(item.id)));
    }, PARTICLE_LIFETIME_MS + created.length * 70);
    return () => window.clearTimeout(timer);
  }, [audioEnabled, filled, onTone, railAnchor]);

  // C — the gate becoming satisfied is the one thing worth celebrating, once.
  useEffect(() => {
    const satisfied = state === "READY" || state === "SUBMITTED";
    if (!satisfied) { burstFired.current = false; return; }
    if (burstFired.current) return;
    burstFired.current = true;
    if (audioEnabled) onTone("submit");
    if (prefersReducedMotion()) return;

    const pieces: BurstPiece[] = Array.from({ length: MAX_BURST_PIECES }, (_, index) => {
      const angle = (index / MAX_BURST_PIECES) * Math.PI * 2;
      const distance = 26 + (index % 4) * 9;
      return {
        id: `burst-${Date.now()}-${index}`,
        dx: Math.cos(angle) * distance,
        dy: Math.sin(angle) * distance * 0.55,
        delay: (index % 6) * 28,
        gold: index % 3 !== 0,
      };
    });
    setBurst(pieces);
    const timer = window.setTimeout(() => setBurst([]), BURST_LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [audioEnabled, onTone, state]);

  // D — a blocked submit is reported audibly as well as visually.
  useEffect(() => {
    if (warningNonce > 0 && audioEnabled) onTone("error");
  }, [audioEnabled, onTone, warningNonce]);

  // E — the pointer line follows the field being filled, and is re-measured when
  // the viewport changes so it never points at the wrong place.
  useEffect(() => {
    if (!activeFieldKey || prefersReducedMotion()) { setLaser(null); return; }

    const measure = () => {
      const anchor = railAnchor();
      const target = document.querySelector<HTMLElement>(`[data-field="${activeFieldKey}"]`)
        ?? document.getElementById(activeFieldKey);
      const box = target?.getBoundingClientRect();
      if (!anchor || !box || box.width === 0 || box.top < anchor.y) { setLaser(null); return; }
      setLaser({ x: anchor.x, y: anchor.y, height: Math.min(box.top + box.height / 2 - anchor.y, 640) });
    };
    measure();
    window.addEventListener("resize", measure, { passive: true });
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, [activeFieldKey, railAnchor]);

  return (
    <>
      <div
        ref={railRef}
        data-smart-progress-rail
        data-state={state === "WARNING" ? "warning" : state.toLowerCase()}
        key={`rail-${warningNonce}`}
        className="cg-rail cg-rail-glass relative overflow-hidden rounded-[18px] border border-[#b8934a]/[.18] bg-[linear-gradient(145deg,rgba(12,35,68,.72),rgba(4,11,25,.68))] p-3 shadow-[0_18px_52px_-28px_rgba(0,0,0,.72),inset_0_1px_0_rgba(255,255,255,.07)] backdrop-blur-xl sm:p-3.5"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[#e3c884]/50 to-transparent" />

        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${state === "WARNING" ? "bg-amber-300" : state === "READY" || state === "SUBMITTED" ? "bg-emerald-300" : state === "CAPTURING" ? "bg-cyan-300" : "bg-slate-600"}`} />
            <h2 className="text-[12px] font-semibold tracking-[.16em] text-slate-300">CAPTURE PROGRESS</h2>
            <span className={`font-mono text-[11px] font-semibold ${copy.tone}`}>{copy.label}</span>
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-slate-400">
            <span className="tabular-nums">{filled.size} / {fields.length} FIELDS CAPTURED</span>
            <span aria-hidden="true" className="text-slate-700">·</span>
            <span className={`tabular-nums ${requiredComplete === requiredTotal ? "text-emerald-200" : "text-amber-200"}`}>
              {requiredComplete} / {requiredTotal} REQUIRED
            </span>
          </p>
        </div>

        {/* The track: one segment per contract field, so coverage is legible as
            well as measurable, and the fill is the same number as the readout. */}
        <div className="cg-rail-track relative mt-2.5">
          <div className="relative h-2 w-full overflow-hidden rounded-full border border-white/[.08] bg-black/35">
            <div
              className="cg-rail-fill absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${Math.round(coverage * 100)}%`, background: copy.fill }}
            />
            {burst.map((piece) => (
              <span
                key={piece.id}
                aria-hidden="true"
                className="cg-burst-piece"
                style={{
                  ["--cg-dx" as string]: `${piece.dx}px`,
                  ["--cg-dy" as string]: `${piece.dy}px`,
                  ["--cg-particle-delay" as string]: `${piece.delay}ms`,
                  background: piece.gold ? "rgba(227,200,132,.95)" : "rgba(125,211,252,.9)",
                  boxShadow: piece.gold ? "0 0 8px rgba(227,200,132,.6)" : "0 0 8px rgba(125,211,252,.55)",
                }}
              />
            ))}
          </div>
          <ol aria-hidden="true" className="mt-1.5 flex min-w-0 gap-[3px]">
            {fields.map((field, index) => (
              <li
                key={field.key}
                className={`cg-rail-segment h-1 min-w-0 flex-1 rounded-full ${
                  filled.has(field.key)
                    ? state === "WARNING" ? "bg-amber-300/70" : "bg-[#e3c884]/70 shadow-[0_0_6px_rgba(227,200,132,.45)]"
                    : "bg-white/[.09]"
                }`}
                style={{ ["--cg-seg-index" as string]: index }}
              />
            ))}
          </ol>
        </div>

        {/* The state in words, for anyone who cannot see the rail at all. */}
        <p id={announceId} role="status" aria-live="polite" className="sr-only">
          {copy.label}. {filled.size} of {fields.length} fields captured. {requiredComplete} of {requiredTotal} required fields complete.
        </p>
      </div>

      {particles.map((particle) => (
        <span
          key={particle.id}
          aria-hidden="true"
          className="cg-particle"
          style={{
            ["--cg-dx" as string]: `${particle.dx}px`,
            ["--cg-dy" as string]: `${particle.dy}px`,
            ["--cg-particle-delay" as string]: `${particle.delay}ms`,
            transform: "translate3d(0,0,0)",
            left: `${particle.x}px`,
            top: `${particle.y}px`,
            background: particle.gold ? "rgba(227,200,132,.95)" : "rgba(125,211,252,.9)",
            boxShadow: particle.gold ? "0 0 10px rgba(227,200,132,.55)" : "0 0 10px rgba(125,211,252,.5)",
          }}
        />
      ))}

      {laser && (
        <span
          aria-hidden="true"
          className="cg-laser"
          style={{
            left: `${laser.x}px`,
            top: `${laser.y}px`,
            height: `${laser.height}px`,
            background: "linear-gradient(180deg,rgba(227,200,132,.75),rgba(125,211,252,.22),transparent)",
            boxShadow: "0 0 6px rgba(227,200,132,.4)",
          }}
        />
      )}
    </>
  );
});
