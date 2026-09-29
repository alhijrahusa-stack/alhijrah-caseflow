"use client";

import { createContext, useContext } from "react";

export type StaffMember = {
  id: string;
  display_name: string;
  role: string;
  active: boolean;
  access_scope?: "full" | "assigned_only";
  staff_code?: string | null;
  legacy_code?: string | null;
  commission_type?: "fixed" | "percent";
  commission_value?: number;
  eligible_for_round_robin?: boolean;
};
export type Me = { id: string; display_name: string; role: "super_admin" | "admin" | "manager" | "staff"; access_scope: "full" | "assigned_only" };

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
    isManager: true,
    isAdmin: v.me.role === "super_admin" || v.me.role === "admin",
    isSuperAdmin: v.me.role === "super_admin",
  };
}
