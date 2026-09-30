"use client";

import { createContext, useContext } from "react";

export type StaffMember = {
  id: string;
  display_name: string;
  email?: string | null;
  role: string;
  active: boolean;
  staff_code?: string | null;
  commission_type?: "fixed" | "percent";
  commission_value?: number;
  eligible_for_round_robin?: boolean;
};
export type Me = { id: string; display_name: string; role: "admin" | "manager" | "staff" };

const Ctx = createContext<{ me: Me; staff: StaffMember[] } | null>(null);

export function StaffProvider({ me, staff, children }: { me: Me; staff: StaffMember[]; children: React.ReactNode }) {
  return <Ctx.Provider value={{ me, staff }}>{children}</Ctx.Provider>;
}

export function useStaff() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStaff outside StaffProvider");
  return {
    ...v,
    activeStaff: v.staff.filter((s) => s.active),
    isManager: v.me.role === "admin" || v.me.role === "manager",
    isAdmin: v.me.role === "admin",
  };
}
