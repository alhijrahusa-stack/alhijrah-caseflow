"use client";

import { Client360Drawer } from "@/components/staff/Client360Drawer";
import { useEffect, useRef, useState } from "react";
import { AppointmentNotificationPanel } from "@/components/staff/AppointmentNotificationPanel";
import { AppointmentRowActions } from "@/components/staff/sections/Work";

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
    <div className="grid min-w-0 gap-3 lg:grid-cols-2 2xl:grid-cols-3" data-testid="mobile-appointment-cards">
      {appointments.map(a => <article key={a.id} className="min-w-0 overflow-hidden rounded-[24px] border border-amber-300/15 bg-gradient-to-br from-[#14233b]/95 via-[#0d1a30]/95 to-[#091527]/95 p-5 shadow-[0_18px_45px_rgba(0,0,0,.22)] backdrop-blur-2xl transition duration-200 hover:-translate-y-0.5 hover:border-amber-300/35 hover:shadow-[0_22px_50px_rgba(0,0,0,.32)]">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold tracking-[.13em] text-amber-300">CAREER GATE · APPOINTMENT</p>
            <button type="button" onClick={() => setSelectedClient({ id: a.client_id, ref: a.ref, full_name: a.full_name })}
              className="mt-2 block break-words text-left text-base font-bold leading-6 text-white underline-offset-4 hover:underline">{a.full_name}</button>
            <p className="mt-1 break-all text-[11px] text-slate-400">{a.ref}</p>
          </div>
          <span className={a.status === "confirmed" ? "shrink-0 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200" : "shrink-0 rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-[11px] text-amber-200"}>{a.status}</span>
        </div>
{a.outcome && <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">Recorded: {a.outcome.replaceAll("_", " ")}</p>}
        <dl className="mt-3 grid min-w-0 gap-2 rounded-xl border border-white/10 bg-white/[.035] p-3 text-xs">
          <div><dt className="text-[10px] text-slate-400">Date & Time / الموعد</dt><dd className="mt-1 font-semibold text-white">{displayDate(a.scheduled_at)} · Detroit</dd></div>
          <div><dt className="text-[10px] text-slate-400">Type / النوع</dt><dd className="mt-1 break-words text-slate-100">{a.appointment_type}</dd></div>
          <div><dt className="text-[10px] text-slate-400">Location / الموقع</dt><dd className="mt-1 whitespace-pre-wrap break-words leading-5 text-slate-100">{a.location || "—"}</dd></div>
          <div><dt className="text-[10px] text-slate-400">Booked by / الموظف</dt><dd className="mt-1 break-words text-slate-100">{a.created_by_name || "—"}</dd></div>
        </dl>
        <button type="button" onClick={() => open(a)} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-amber-300/40 bg-amber-400/15 px-4 py-3 text-sm font-bold text-amber-200 active:scale-[.99]" aria-label={`Open actions for ${a.full_name}`}>Executive Smart Gate <span aria-hidden="true">↑</span></button>
      </article>)}
    </div>
    {selectedClient && <Client360Drawer client={selectedClient} onClose={() => setSelectedClient(null)} />}
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
          {tab === "notification" ? selectedVisible.status === "confirmed" ? <AppointmentNotificationPanel key={selectedVisible.id} appointmentId={selectedVisible.id}/> : <p className="rounded-xl border border-white/15 p-4 text-sm text-slate-300">Confirm this appointment before sending a confirmation.</p> : <div className="rounded-xl border border-white/15 bg-white/5 p-3"><AppointmentRowActions appt={selectedVisible}/></div>}
        </div>
      </section>
    </div>}
  </>;
}
