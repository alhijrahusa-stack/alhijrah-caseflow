"use client";

import { createContext, useContext, useMemo } from "react";
import { createClientResourceReader } from "@/components/staff/realtime/client-resource-reader";

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
export type Me = { id: string; display_name: string; role: "admin" | "manager" | "staff"; canScheduleAppointment?: boolean };

const Ctx = createContext<{ me: Me; staff: StaffMember[]; readClientResources: ReturnType<typeof createClientResourceReader> } | null>(null);

export function StaffProvider({ me, staff, children }: { me: Me; staff: StaffMember[]; children: React.ReactNode }) {
  // A different staff identity gets its own pending batch; no data or request
  // promise is shared across staff-provider lifetimes.
  const requests = useMemo(() => ({ staffId: me.id, read: createClientResourceReader() }), [me.id]);
  const value = useMemo(() => ({ me, staff, readClientResources: requests.read }), [me, staff, requests.read]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStaff() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStaff outside StaffProvider");
  return {
    ...v,
    activeStaff: v.staff.filter((s) => s.active),
    isManager: v.me.role === "admin" || v.me.role === "manager",
    isAdmin: v.me.role === "admin",
    canScheduleAppointment: v.me.role !== "staff" || v.me.canScheduleAppointment === true,
  };
}
