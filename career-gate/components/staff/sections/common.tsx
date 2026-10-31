"use client";

import { useAction } from "@/components/forms/useAction";
import { StaffLabel, useStaffLabel } from "@/components/staff/StaffLabel";

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function Card({ title, id, actions, children }: { title: string; id: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const uiLabel = useStaffLabel();
  return (
    <section id={id} className="cg-surface-card" data-testid={`section-${id}`} aria-labelledby={`${id}-title`}>
      <header className="cg-surface-card-header">
        <h2 id={`${id}-title`} className="text-sm font-semibold">{uiLabel(title)}</h2>
        {actions}
      </header>
      <div className="cg-surface-card-body">{children}</div>
    </section>
  );
}

export function Dl({ rows }: { rows: [string, React.ReactNode][] }) {
  const uiLabel = useStaffLabel();
  return (
    <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="pt-0.5 text-slate-500">{uiLabel(k)}</dt>
          <dd>{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SmallBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const uiLabel = useStaffLabel();
  return <button type="button" {...props} className={`cg-mini-glass-button ${props.className ?? ""}`}>{typeof props.children === "string" ? uiLabel(props.children) : props.children}</button>;
}

export const yn = (v: boolean | null | undefined) => <StaffLabel en={v === true ? "Yes" : v === false ? "No" : "UNKNOWN / NOT PROVIDED"}/>;

/** Runs a row-level action and shows its error inline. */
export function useRowAction(success?: string | null) {
  const uiLabel = useStaffLabel();
  const a = useAction({ successMessage: success ? uiLabel(success) : success });
  return { ...a, go: (payload: Record<string, unknown>) => a.run(payload) };
}
