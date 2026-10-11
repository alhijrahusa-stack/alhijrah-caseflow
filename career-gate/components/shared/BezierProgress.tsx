import type { ReactNode } from "react";

export type ProgressState = "PENDING" | "RUNNING" | "COMPLETED" | "NEEDS_REVIEW" | "FAILED";

export type ProgressStage = {
  label: string;
  state: ProgressState;
};

const TONE: Record<ProgressState, { fill: string; stroke: string; text: string }> = {
  PENDING: { fill: "#14233b", stroke: "#52647d", text: "#94a3b8" },
  RUNNING: { fill: "#0b3651", stroke: "#67e8f9", text: "#a5f3fc" },
  COMPLETED: { fill: "#0b3b34", stroke: "#6ee7b7", text: "#a7f3d0" },
  NEEDS_REVIEW: { fill: "#4a3511", stroke: "#fbbf24", text: "#fde68a" },
  FAILED: { fill: "#4a1920", stroke: "#f87171", text: "#fecaca" },
};

function points(count: number) {
  const safe = Math.max(1, count);
  return Array.from({ length: safe }, (_, index) => ({
    x: safe === 1 ? 400 : 38 + (724 * index) / (safe - 1),
    y: index % 2 === 0 ? 48 : 70,
  }));
}

function pathFor(stages: ProgressStage[]) {
  const pts = points(stages.length);
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const delta = (b.x - a.x) * 0.45;
    d += ` C ${a.x + delta} ${a.y}, ${b.x - delta} ${b.y}, ${b.x} ${b.y}`;
  }
  return d;
}

export function BezierProgress({
  stages,
  title,
  trailing,
}: {
  stages: ProgressStage[];
  title?: string;
  trailing?: ReactNode;
}) {
  const pts = points(stages.length);
  const path = pathFor(stages);
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-white/[.08] bg-black/20 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,.04)]"
      role="group"
      aria-label={title ?? "Workflow progress"}
      data-testid="bezier-progress"
    >
      {(title || trailing) && (
        <div className="mb-1 flex items-center justify-between gap-3 px-1">
          {title ? <span className="text-[11px] font-semibold tracking-[.14em] text-slate-400">{title}</span> : <span />}
          {trailing}
        </div>
      )}
      <div className="overflow-x-auto pb-1">
        <svg viewBox="0 0 800 124" className="min-w-[720px] w-full" aria-hidden="true">
          <defs>
            <linearGradient id="cgBezierRail" x1="0" x2="1">
              <stop offset="0%" stopColor="#2f6fd0" stopOpacity=".55" />
              <stop offset="55%" stopColor="#67e8f9" stopOpacity=".36" />
              <stop offset="100%" stopColor="#ff9f1a" stopOpacity=".62" />
            </linearGradient>
          </defs>
          {path && <path d={path} fill="none" stroke="url(#cgBezierRail)" strokeWidth="2" strokeLinecap="round" />}
          {stages.map((stage, index) => {
            const point = pts[index];
            const tone = TONE[stage.state];
            return (
              <g key={stage.label}>
                {stage.state === "RUNNING" && (
                  <circle cx={point.x} cy={point.y} r="13" fill="none" stroke={tone.stroke} strokeOpacity=".28" strokeWidth="5" />
                )}
                <circle cx={point.x} cy={point.y} r="8" fill={tone.fill} stroke={tone.stroke} strokeWidth="2" />
                <text x={point.x} y={104 + (index % 2) * 10} textAnchor="middle" fill={tone.text} fontSize="10" fontWeight="600">
                  {stage.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <ol className="sr-only">
        {stages.map((stage) => <li key={stage.label}>{stage.label}: {stage.state.replace("_", " ")}</li>)}
      </ol>
    </div>
  );
}
