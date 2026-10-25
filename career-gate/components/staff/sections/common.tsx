"use client";

import { startTransition, useEffect, useState } from "react";
import { useAction } from "@/components/forms/useAction";
import { afterNextPaint } from "@/lib/after-paint";

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Renders the first `first` items on the commit that shows the list, then the
 * rest `step` at a time, each step a low-priority transition that starts only
 * after the previous frame has painted. Every item still renders; neither the
 * interaction that opened the list nor the next one waits on the long tail.
 */
export function useProgressiveList<T>(items: T[], first = 40, step = 120): T[] {
  const [limit, setLimit] = useState(first);
  useEffect(() => {
    if (items.length <= limit) return;
    return afterNextPaint(() => startTransition(() => setLimit((current) => Math.min(items.length, current + step))));
  }, [items.length, limit, step]);
  return items.length <= limit ? items : items.slice(0, limit);
}

export function Card({ title, id, actions, children }: { title: string; id: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="cg-surface-card" data-testid={`section-${id}`} aria-labelledby={`${id}-title`}>
      <header className="cg-surface-card-header">
        <h2 id={`${id}-title`} className="text-sm font-semibold">{title}</h2>
        {actions}
      </header>
      <div className="cg-surface-card-body">{children}</div>
    </section>
  );
}

export function Dl({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="pt-0.5 text-slate-500">{k}</dt>
          <dd>{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SmallBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`cg-mini-glass-button ${props.className ?? ""}`} />;
}

export const yn = (v: boolean | null | undefined) => (v === true ? "Yes" : v === false ? "No" : "UNKNOWN / NOT PROVIDED");

/** Runs a row-level action and shows its error inline. */
export function useRowAction(success?: string | null) {
  const a = useAction({ successMessage: success });
  return { ...a, go: (payload: Record<string, unknown>) => a.run(payload) };
}
