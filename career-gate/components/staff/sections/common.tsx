"use client";

import { startTransition, useEffect, useState } from "react";
import { useAction } from "@/components/forms/useAction";

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Renders the first `first` items on the commit that shows the list, then the
 * rest in a low-priority transition right after. Every item still renders; the
 * interaction that opened the list just paints before the long tail is built.
 */
export function useProgressiveList<T>(items: T[], first = 40): T[] {
  const [limit, setLimit] = useState(first);
  useEffect(() => {
    if (items.length <= limit) return;
    const timer = window.setTimeout(() => startTransition(() => setLimit(items.length)), 0);
    return () => window.clearTimeout(timer);
  }, [items.length, limit]);
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
