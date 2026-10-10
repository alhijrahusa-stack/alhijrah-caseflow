"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MAIN_PATH, STATUS_LABELS, TRANSITIONS, type Status } from "@/lib/domain";
import { dateTime } from "@/lib/format";

type TimelineItem = {
  key: string;
  status: Status;
  at: string | null;
  by: string | null;
  override: boolean;
  kind: "history" | "current" | "expected";
};

type Point = { x: number; y: number };
type Segment = { d: string; color: string };

const COLORS = {
  history: "#7892ad",
  current: "#67e8f9",
  expected: "#62758b",
} as const;

function curve(a: Point, b: Point, index: number) {
  const bend = index % 2 === 0 ? 13 : -13;
  const dy = Math.max(12, (b.y - a.y) * 0.42);
  return `M ${a.x} ${a.y} C ${a.x + bend} ${a.y + dy}, ${b.x - bend} ${b.y - dy}, ${b.x} ${b.y}`;
}

function combinedPath(points: Point[]) {
  if (points.length < 2) return "";
  return points.slice(1).map((point, i) => curve(points[i], point, i)).join(" ");
}

/**
 * Past steps come only from recorded status-change events (plus creation).
 * Expected next states come from the transition table; they carry no dates.
 * The visual path is measured from the rendered nodes and rebuilt on resize.
 */
export function StatusTimeline({ created, events, current }: {
  created: { at: string; status: Status };
  events: { at: string; from: Status; to: Status; by: string | null; override?: boolean }[];
  current: Status;
}) {
  const wrapperRef = useRef<HTMLOListElement>(null);
  const nodeRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [points, setPoints] = useState<Point[]>([]);

  const items = useMemo<TimelineItem[]>(() => {
    const past = [
      { status: created.status, at: created.at, by: null as string | null, override: false },
      ...events.map((event) => ({ status: event.to, at: event.at, by: event.by, override: Boolean(event.override) })),
    ];
    const history = past.slice(0, -1).map((entry, i) => ({
      key: `history-${i}-${entry.status}`,
      ...entry,
      kind: "history" as const,
    }));
    const latest = past[past.length - 1];
    const expected = TRANSITIONS[current]
      .filter((status) => status !== "cancelled")
      .sort((a, b) => MAIN_PATH.indexOf(a) - MAIN_PATH.indexOf(b))
      .map((status) => ({
        key: `expected-${status}`,
        status,
        at: null,
        by: null,
        override: false,
        kind: "expected" as const,
      }));
    return [
      ...history,
      {
        key: `current-${current}`,
        status: current,
        at: latest.at,
        by: latest.by,
        override: latest.override,
        kind: "current" as const,
      },
      ...expected,
    ];
  }, [created.at, created.status, current, events]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const measure = () => {
      const root = wrapper.getBoundingClientRect();
      const next = nodeRefs.current.slice(0, items.length).map((node) => {
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { x: 12, y: rect.top - root.top + Math.min(27, rect.height / 2) };
      }).filter((point): point is Point => Boolean(point));
      setPoints(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrapper);
    nodeRefs.current.forEach((node) => node && observer.observe(node));
    window.addEventListener("orientationchange", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", measure);
    };
  }, [items]);

  const segments: Segment[] = points.slice(1).map((point, i) => ({
    d: curve(points[i], point, i),
    color: COLORS[items[i + 1]?.kind ?? "history"],
  }));
  const path = combinedPath(points);

  return (
    <ol ref={wrapperRef} className="relative isolate space-y-3 overflow-hidden pl-8 text-sm" data-testid="status-timeline">
      {points.length > 1 && (
        <svg className="pointer-events-none absolute inset-0 z-0 h-full w-12 overflow-visible" aria-hidden="true">
          <defs>
            <filter id="timeline-glow" x="-150%" y="-20%" width="400%" height="140%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
          </defs>
          <path d={path} fill="none" stroke="#38bdf8" strokeWidth="8" opacity=".14" filter="url(#timeline-glow)">
            <animate attributeName="opacity" values=".08;.24;.08" dur="3.6s" repeatCount="indefinite" />
          </path>
          {segments.map((segment, i) => (
            <path key={i} d={segment.d} fill="none" stroke={segment.color} strokeWidth="2.2" strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset="1">
              <animate attributeName="stroke-dashoffset" from="1" to="0" dur=".72s" begin={`${i * 0.08}s`} fill="freeze" />
              <animate attributeName="opacity" values=".58;1;.72" dur="3.2s" begin={`${i * 0.16}s`} repeatCount="indefinite" />
            </path>
          ))}
          <circle r="3.5" fill="white" opacity=".95" className="motion-reduce:hidden">
            <animateMotion dur="3s" repeatCount="indefinite" path={path} />
          </circle>
        </svg>
      )}

      {items.map((item, i) => {
        const isCurrent = item.kind === "current";
        const isExpected = item.kind === "expected";
        return (
          <li
            ref={(node) => { nodeRefs.current[i] = node; }}
            key={item.key}
            aria-current={isCurrent ? "step" : undefined}
            className={`relative z-10 rounded-2xl border px-4 py-3.5 transition duration-200 ${isCurrent
              ? "border-cyan-300/35 bg-gradient-to-r from-cyan-300/[.12] via-sky-400/[.055] to-transparent shadow-[0_12px_34px_rgba(0,0,0,.18),0_0_28px_rgba(34,211,238,.06)]"
              : isExpected
                ? "border-white/[.055] bg-white/[.015] text-slate-500"
                : "border-white/[.08] bg-gradient-to-r from-white/[.045] to-transparent shadow-[0_8px_26px_rgba(0,0,0,.12)]"}`}
          >
            <span
              aria-hidden="true"
              className={`absolute -left-[27px] top-[17px] h-4 w-4 rounded-full border ${isCurrent
                ? "border-cyan-100 bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,.9)]"
                : isExpected
                  ? "border-slate-600 bg-[#091522]"
                  : "border-sky-200/70 bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,.45)]"}`}
            >
              {!isExpected && <span className={`absolute inset-[-7px] rounded-full border border-cyan-300/20 motion-safe:animate-ping ${isCurrent ? "opacity-60" : "opacity-25"}`} style={{ animationDuration: "2.4s", animationDelay: `${i * 0.3}s` }} />}
            </span>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className={isCurrent ? "font-semibold text-cyan-100" : isExpected ? "text-slate-500" : "font-medium text-slate-200"}>
                {STATUS_LABELS[item.status]}
                {item.override && <span className="ml-1 text-xs text-amber-300">(override)</span>}
              </p>
              {isCurrent && <span className="rounded-full border border-cyan-300/20 bg-cyan-300/[.07] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[.13em] text-cyan-200">Live state</span>}
            </div>
            {item.kind === "expected" ? (
              <p className="mt-1 text-xs text-slate-600">Possible next state</p>
            ) : (
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {isCurrent ? "Current · since " : ""}{item.at ? dateTime(item.at) : "—"}{item.by ? ` · ${item.by}` : ""}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
