"use client";

import { Client360Drawer } from "@/components/staff/Client360Drawer";
import { useEffect, useRef, useState } from "react";
import { AppointmentNotificationPanel } from "@/components/staff/AppointmentNotificationPanel";
import { AppointmentRowActions, RescheduleModal } from "@/components/staff/sections/Work";
import { useRowAction } from "@/components/staff/sections/common";
import { fromLocalInput } from "@/lib/format";

type Appointment = Record<string, string>;
type Props = { appointments: Appointment[] };

function displayDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Detroit", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export function MobileAppointmentCards({ appointments }: Props) {
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [selectedClient, setSelectedClient] = useState<{ id: string; ref: string; full_name: string } | null>(null);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const rescheduleAction = useRowAction("Appointment decision saved");
  const rescheduleAppt = appointments.find((item) => item.id === reschedulingId) ?? null;
  const selectedVisible = selected && appointments.some((a) => a.id === selected.id) ? selected : null;
  const [tab, setTab] = useState<"notification" | "actions">("notification");
  const [offset, setOffset] = useState(0);
  const startY = useRef<number | null>(null);
  const dismiss = () => { setSelected(null); setOffset(0); };
  useEffect(() => {
    if (!selectedVisible) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [selectedVisible]);
  const open = (appointment: Appointment) => { setTab(appointment.status === "confirmed" ? "notification" : "actions"); setOffset(0); setSelected(appointment); };
  return <>
    <div className="cg-appointment-grid" data-testid="mobile-appointment-cards">
      {appointments.map(a => <article key={a.id} className="cg-appointment-card">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="cg-card-eyebrow">{a.appointment_kind === "employment_interview" ? "EMPLOYMENT INTERVIEW" : "FIELD APPOINTMENT"}</p>
            <button type="button" onClick={() => setSelectedClient({ id: a.client_id, ref: a.ref, full_name: a.full_name })}
              className="cg-card-name" aria-label={`Open ${a.full_name} in Client 360`}>{a.full_name}</button>
            <p className="mt-1 font-mono text-xs text-cyan-200/75">{a.ref}</p>
          </div>
          <span className={`cg-appointment-status ${a.status === "confirmed" ? "cg-appt-confirmed" : a.status === "attended" ? "cg-appt-attended" : a.status === "missed" || a.status === "cancelled" ? "cg-appt-alert" : ""}`}>{a.status.replaceAll("_"," ")}</span>
        </div>
        <div className="cg-appointment-meta">
          <div className="cg-appointment-meta-primary">
            <span className="cg-meta-label">TIME · الموعد</span>
            <time className="cg-meta-value" dateTime={a.scheduled_at}>{displayDate(a.scheduled_at)}</time>
            <span className="text-xs text-slate-400">Detroit</span>
          </div>
          <div className="min-w-0"><span className="cg-meta-label">TYPE · النوع</span><p className="cg-meta-value break-words">{a.appointment_type}</p></div>
          <div className="min-w-0"><span className="cg-meta-label">LOCATION · الموقع</span><p className="cg-meta-value line-clamp-2 break-words" title={a.location || undefined}>{a.location || "—"}</p>
            {(a.map_address || a.location) && <a className="mt-1 inline-block text-xs text-cyan-200 underline underline-offset-2"
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.map_address || a.location)}`}
              target="_blank" rel="noopener noreferrer" aria-label={`Open map for ${a.full_name}`}>Google Maps ↗</a>}
          </div>
          <div className="min-w-0"><span className="cg-meta-label">BOOKED BY · الموظف</span><p className="cg-meta-value truncate" title={a.created_by_name || undefined}>{a.created_by_name || "—"}</p></div>
        </div>
        {a.outcome ? <p className="mt-3 text-xs font-semibold text-emerald-300">Decision recorded · {a.outcome.replaceAll("_"," ")}</p> :
          a.status === "attended" && a.appointment_kind === "employment_interview" ?
          <p className="mt-3 text-xs font-semibold text-amber-200">Attended · interview decision pending</p> : null}
        <div className="mt-auto flex flex-wrap gap-2 pt-4">
          <button type="button" onClick={() => open(a)} className="cg-appointment-action flex-1" aria-label={`Open actions for ${a.full_name}`}>Manage appointment <span aria-hidden="true">↗</span></button>
          <button type="button" onClick={() => setSelectedClient({ id: a.client_id, ref: a.ref, full_name: a.full_name })} className="cg-appointment-secondary">Client 360</button>
        </div>
      </article>)}
    </div>
    {selectedClient && <Client360Drawer client={selectedClient} onClose={() => setSelectedClient(null)} />}
    {rescheduleAppt && <RescheduleModal
      key={rescheduleAppt.id}
      appt={rescheduleAppt}
      pending={rescheduleAction.pending}
      error={rescheduleAction.error}
      onClose={() => setReschedulingId(null)}
      onSave={async ({ when, location, locationId, notes }) => {
        const instant = fromLocalInput(when);
        if (!Number.isFinite(instant.getTime())) { rescheduleAction.setError("Invalid appointment date"); return; }
        const ok = await rescheduleAction.go({
          action: "update_appointment",
          appointment_id: rescheduleAppt.id,
          scheduled_at: instant.toISOString(),
          location: location || null,
          location_id: locationId,
          confirm_booking: true,
          notes: notes || null,
        });
        if (ok) setReschedulingId(null);
      }}
    />}
    {selectedVisible && <div className="fixed inset-0 z-[1000]" data-testid="executive-bottom-drawer">
      <button type="button" className="absolute inset-0 h-full w-full bg-[#020a15]/75 backdrop-blur-[3px]" onClick={dismiss} aria-label="Close appointment actions" />
      <section role="dialog" aria-modal="true" aria-labelledby="smart-gate-heading" className="absolute inset-x-0 bottom-0 flex max-h-[min(88dvh,850px)] min-h-0 flex-col overflow-hidden rounded-t-[28px] border border-amber-300/25 bg-[#0b1d30] text-white shadow-[0_-25px_65px_rgba(0,0,0,.55)]" style={{ transform: `translateY(${offset}px)`, transition: "transform 220ms cubic-bezier(.2,.8,.2,1)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="shrink-0 touch-pan-x px-4 pt-3" onTouchStart={e => {startY.current=e.touches[0].clientY;}} onTouchMove={e => {if(startY.current !== null)setOffset(Math.max(0,e.touches[0].clientY-startY.current));}} onTouchEnd={() => {if(offset > 110)dismiss();else setOffset(0);startY.current=null;}}>
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-400/70" />
          <div className="flex min-w-0 items-start justify-between gap-3 pb-3">
            <div className="min-w-0"><p className="text-[10px] font-bold tracking-[.15em] text-amber-300">CAREER GATE · SMART OPERATIONS</p><h2 id="smart-gate-heading" className="mt-1 text-lg font-bold">Executive Smart Gate</h2><p className="mt-1 break-words text-xs text-slate-300">{selectedVisible.full_name} · {displayDate(selectedVisible.scheduled_at)}</p></div>
            <button type="button" onClick={dismiss} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/20 text-xl" aria-label="Close drawer">×</button>
          </div>
          <div className="grid grid-cols-2 gap-2 pb-3">
            <button type="button" onClick={() => setTab("notification")} className={`min-h-11 rounded-xl px-2 text-xs font-semibold ${tab === "notification" ? "bg-amber-400 text-slate-950" : "border border-white/20 bg-white/5 text-slate-200"}`}>Notification / إشعار</button>
            <button type="button" onClick={() => setTab("actions")} className={`min-h-11 rounded-xl px-2 text-xs font-semibold ${tab === "actions" ? "bg-amber-400 text-slate-950" : "border border-white/20 bg-white/5 text-slate-200"}`}>Manage / إدارة</button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-5" style={{WebkitOverflowScrolling:"touch"}}>
          {tab === "notification" ? selectedVisible.status === "confirmed" ? <AppointmentNotificationPanel key={selectedVisible.id} appointmentId={selectedVisible.id}/> : <p className="rounded-xl border border-white/15 p-4 text-sm text-slate-300">Confirm this appointment before sending a confirmation.</p> : <div className="rounded-xl border border-white/15 bg-white/5 p-3"><AppointmentRowActions appt={selectedVisible} rescheduling={reschedulingId === selectedVisible.id} onReschedule={(id) => { dismiss(); rescheduleAction.setError(null); setReschedulingId(id); }} /></div>}
        </div>
      </section>
    </div>}
  </>;
}
