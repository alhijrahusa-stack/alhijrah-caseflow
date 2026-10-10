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
  kind: "past" | "current" | "next";
};

type Point = { x: number; y: number; color: string; offset: number };

const STATUS_COLOR: Partial<Record<Status, string>> = {
  new_intake: "#7dd3fc",
  needs_review: "#fbbf24",
  ready_to_apply: "#c4b5fd",
  application_in_progress: "#60a5fa",
  assessment_required: "#fb923c",
  shift_selected: "#a78bfa",
  appointment_required: "#38bdf8",
  appointment_scheduled: "#22d3ee",
  pre_hire_completed: "#2dd4bf",
  screening_pending: "#f59e0b",
  i9_available: "#60a5fa",
  post_hire_tasks: "#c084fc",
  ready_for_first_day: "#34d399",
  completed: "#6ee7b7",
  cancelled: "#fb7185",
};

function statusColor(status: Status) {
  return STATUS_COLOR[status] ?? "#94a3b8";
}

function buildPath(points: Point[]) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dy = Math.max(18, (b.y - a.y) * 0.48);
    d += ` C ${a.x} ${a.y + dy}, ${b.x} ${b.y - dy}, ${b.x} ${b.y}`;
  }
  return d;
}

export function StatusTimeline({ created, events, current }: {
  created: { at: string; status: Status };
  events: { at: string; from: Status; to: Status; by: string | null; override?: boolean }[];
  current: Status;
}) {
  const containerRef = useRef<HTMLOListElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLSpanElement>());
  const [points, setPoints] = useState<Point[]>([]);
  const [bounds, setBounds] = useState({ width: 1, height: 1 });
  const [reducedMotion, setReducedMotion] = useState(false);

  const items = useMemo<TimelineItem[]>(() => {
    const past = [
      { status: created.status, at: created.at, by: null as string | null, override: false },
      ...events.map((event) => ({ status: event.to, at: event.at, by: event.by, override: Boolean(event.override) })),
    ];
    const history = past.slice(0, -1);
    const expected = TRANSITIONS[current]
      .filter((status) => status !== "cancelled")
      .sort((a, b) => MAIN_PATH.indexOf(a) - MAIN_PATH.indexOf(b));

    return [
      ...history.map((item, index) => ({
        key: `past-${index}-${item.status}`,
        ...item,
        kind: "past" as const,
      })),
      {
        key: `current-${current}`,
        status: current,
        at: past[past.length - 1]?.at ?? created.at,
        by: null,
        override: false,
        kind: "current" as const,
      },
      ...expected.map((status, index) => ({
        key: `next-${index}-${status}`,
        status,
        at: null,
        by: null,
        override: false,
        kind: "next" as const,
      })),
    ];
  }, [created, current, events]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const rect = container.getBoundingClientRect();
      const next = items.map((item, index) => {
        const node = nodeRefs.current.get(item.key);
        if (!node) return null;
        const nodeRect = node.getBoundingClientRect();
        const x = nodeRect.left - rect.left + nodeRect.width / 2;
        const y = nodeRect.top - rect.top + nodeRect.height / 2;
        const offset = items.length <= 1 ? 0 : index / (items.length - 1);
        return { x, y, color: statusColor(item.status), offset };
      }).filter((point): point is Point => Boolean(point));
      setPoints(next);
      setBounds({ width: Math.max(1, container.clientWidth), height: Math.max(1, container.scrollHeight) });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    for (const node of nodeRefs.current.values()) observer.observe(node);
    window.addEventListener("orientationchange", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", measure);
    };
  }, [items]);

  const path = buildPath(points);
  const { width, height } = bounds;

  return (
    <ol ref={containerRef} className="cg-living-timeline" data-testid="status-timeline" aria-label="Client status timeline">
      {points.length > 1 && path && (
        <svg className="cg-living-timeline-path" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="cg-status-flow" x1="0" y1="0" x2="0" y2="1">
              {points.map((point, index) => (
                <stop key={index} offset={`${Math.round(point.offset * 100)}%`} stopColor={point.color} />
              ))}
            </linearGradient>
            <filter id="cg-status-aura" x="-120%" y="-20%" width="340%" height="140%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
          </defs>
          <path d={path} className="cg-status-aura" filter="url(#cg-status-aura)" />
          <path d={path} className="cg-status-flow-line" />
          {!reducedMotion && (
            <circle r="3.8" className="cg-status-travel-pulse">
              <animateMotion dur="3s" repeatCount="indefinite" path={path} />
            </circle>
          )}
        </svg>
      )}

      {items.map((item, index) => {
        const isCurrent = item.kind === "current";
        const isNext = item.kind === "next";
        return (
          <li
            key={item.key}
            className={`cg-timeline-event cg-timeline-${item.kind}`}
            style={{ ["--cg-node-color" as string]: statusColor(item.status), ["--cg-delay" as string]: `${index * 0.3}s` }}
            aria-current={isCurrent ? "step" : undefined}
          >
            <span
              ref={(node) => {
                if (node) nodeRefs.current.set(item.key, node);
                else nodeRefs.current.delete(item.key);
              }}
              className="cg-timeline-node"
              aria-hidden="true"
            >
              <span className="cg-timeline-node-wave" />
              <span className="cg-timeline-node-core" />
            </span>
            <div className="cg-timeline-card">
              <div className="flex flex-wrap items-center gap-2">
                <p className="cg-timeline-title">{STATUS_LABELS[item.status]}</p>
                {item.override && <span className="cg-timeline-override">override</span>}
                {isCurrent && <span className="cg-timeline-current-chip">CURRENT</span>}
                {isNext && <span className="cg-timeline-next-chip">POSSIBLE NEXT</span>}
              </div>
              {item.at && (
                <p className="cg-timeline-meta">
                  {isCurrent ? "Since " : ""}{dateTime(item.at)}{item.by ? ` · ${item.by}` : ""}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
