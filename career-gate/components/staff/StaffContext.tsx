"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type StaffMember = { id: string; name: string };

const Ctx = createContext<{ staff: StaffMember[]; current: string; setCurrent: (id: string) => void } | null>(null);
const KEY = "cg.handledBy";

/** Holds the office "Handled By" choice; remembered per browser for convenience. */
export function StaffProvider({ staff, children }: { staff: StaffMember[]; children: React.ReactNode }) {
  const [current, setCurrentState] = useState("");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved && staff.some((s) => s.id === saved)) setCurrentState(saved);
    } catch {
      // Storage unavailable; staff pick each session.
    }
  }, [staff]);
  const setCurrent = (id: string) => {
    setCurrentState(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // ignore
    }
  };
  return <Ctx.Provider value={{ staff, current, setCurrent }}>{children}</Ctx.Provider>;
}

export function useStaff() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStaff outside StaffProvider");
  return v;
}

export function HandledBySelect({ className = "", id = "handled-by" }: { className?: string; id?: string }) {
  const { staff, current, setCurrent } = useStaff();
  return (
    <label className={`flex items-center gap-2 text-sm ${className}`} htmlFor={id}>
      <span className="whitespace-nowrap text-slate-600">Handled By</span>
      <select
        id={id}
        data-testid="handled-by"
        className={`input w-auto py-1 ${current ? "" : "border-amber-400 bg-amber-50"}`}
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      >
        <option value="">Select…</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </label>
  );
}

/** Returns the Handled By id, or an error message when none is chosen. */
export function useHandledBy() {
  const { current } = useStaff();
  return { handledBy: current, missing: current ? null : "Select Handled By at the top of the page first" };
}
