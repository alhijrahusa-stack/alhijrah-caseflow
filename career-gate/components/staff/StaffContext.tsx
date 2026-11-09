"use client";

import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { createSharedStaffRealtime } from "@/lib/shared-staff-realtime";
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

const Ctx = createContext<{ me: Me; staff: StaffMember[]; readClientResources: ReturnType<typeof createClientResourceReader>; realtime: ReturnType<typeof createSharedStaffRealtime> } | null>(null);

export function StaffProvider({ me, staff, children }: { me: Me; staff: StaffMember[]; children: React.ReactNode }) {
  // A different staff identity gets its own pending batch; no data or request
  // promise is shared across staff-provider lifetimes.
  const requests = useMemo(() => ({ staffId: me.id, read: createClientResourceReader() }), [me.id]);
  const realtime = useMemo(() => createSharedStaffRealtime(me.id), [me.id]);
  const disposeTimer = useRef<{ owner: typeof realtime; timer: ReturnType<typeof setTimeout> } | null>(null);
  useEffect(() => {
    if (disposeTimer.current) {
      clearTimeout(disposeTimer.current.timer);
      if (disposeTimer.current.owner !== realtime) disposeTimer.current.owner.dispose();
      disposeTimer.current = null;
    }
    realtime.resume();
    const end = () => realtime.dispose();
    window.addEventListener("career-gate:sign-out", end);
    return () => {
      window.removeEventListener("career-gate:sign-out", end);
      disposeTimer.current = { owner: realtime, timer: setTimeout(end, 0) };
    };
  }, [realtime]);
  const value = useMemo(() => ({ me, staff, readClientResources: requests.read, realtime }), [me, staff, requests.read, realtime]);
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
