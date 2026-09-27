"use client";

import { useAction } from "@/components/forms/useAction";

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function Card({ title, id, actions, children }: { title: string; id: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-lg border border-slate-200 bg-white" data-testid={`section-${id}`} aria-labelledby={`${id}-title`}>
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h2 id={`${id}-title`} className="text-sm font-semibold">{title}</h2>
        {actions}
      </header>
      <div className="p-4 text-sm">{children}</div>
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
  return <button type="button" {...props} className={`rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-50 ${props.className ?? ""}`} />;
}

export const yn = (v: boolean | null | undefined) => (v === true ? "Yes" : v === false ? "No" : "UNKNOWN / NOT PROVIDED");

/** Runs a row-level action and shows its error inline. */
export function useRowAction(success?: string | null) {
  const a = useAction({ successMessage: success });
  return { ...a, go: (payload: Record<string, unknown>) => a.run(payload) };
}
