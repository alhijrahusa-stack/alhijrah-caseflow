"use client";

import { useState } from "react";
import { AppointmentNotificationPanel } from "@/components/staff/AppointmentNotificationPanel";

/** Mount the full notification editor on first expansion, retaining drafts thereafter. */
export function DeferredAppointmentNotification({ appointmentId }: { appointmentId: string }) {
  const [openedOnce, setOpenedOnce] = useState(false);
  return (
    <details
      className="mt-2 min-w-[310px] max-w-[490px]"
      onToggle={(event) => {
        if (event.currentTarget.open && !openedOnce) setOpenedOnce(true);
      }}
    >
      <summary className="cursor-pointer rounded-xl border border-amber-300/30 px-3 py-2 text-xs font-semibold text-amber-200 transition-all duration-300 hover:bg-amber-300/10">
        Client notification / إشعار العميل
      </summary>
      {openedOnce && <div className="mt-2"><AppointmentNotificationPanel appointmentId={appointmentId} /></div>}
    </details>
  );
}
