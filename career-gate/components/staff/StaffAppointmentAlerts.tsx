"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type AppointmentEvent = {
  id: string;
  clientId: string;
  at: string;
  action: "confirm" | "reschedule" | "cancel";
  name: string;
};

const POLL_MS = 5_000;
const OVERLAP_MS = 8_000;
const HISTORY_MS = 24 * 60 * 60 * 1_000;
const MAX_VISIBLE = 80;

function soundFor(action: AppointmentEvent["action"]) {
  try {
    const ctx = new AudioContext();
    const tones = action === "confirm" ? [880] : action === "reschedule" ? [660, 880] : [330, 280];
    tones.forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = ctx.currentTime + index * .16;
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(.0001, at);
      gain.gain.exponentialRampToValueAtTime(.055, at + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, at + .18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + .19);
    });
    window.setTimeout(() => { void ctx.close(); }, 1000);
  } catch {
    // Visual notifications continue when the browser blocks audio playback.
  }
}

function label(action: AppointmentEvent["action"]) {
  if (action === "confirm") return "Appointment acknowledged / تم تأكيد الموعد";
  if (action === "reschedule") return "Reschedule requested / طلب تعديل موعد";
  return "Appointment cancelled / إلغاء موعد";
}

/** One staff-wide, permission-scoped appointment inbox; sound is an optional enhancement. */
export function StaffAppointmentAlerts({ staffId }: { staffId: string }) {
  const [open, setOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const soundRef = useRef(false);
  const [events, setEvents] = useState<AppointmentEvent[]>([]);
  const [readIds, setReadIds] = useState<string[]>([]);
  const [online, setOnline] = useState(true);
  const storageKey = `cg-appointment-alerts-read:${staffId}`;

  useEffect(() => {
    let active = true;
    let busy = false;
    let firstPoll = true;
    let cursor = new Date(Date.now() - HISTORY_MS).toISOString();
    const known = new Set<string>();
    let stored: string[] = [];
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as unknown;
      if (Array.isArray(saved)) stored = saved.filter((id): id is string => typeof id === "string").slice(-300);
    } catch {
      // Browser storage is optional; events remain visible for the current session.
    }

    async function poll() {
      if (busy || !active || document.hidden) return;
      busy = true;
      try {
        const res = await fetch(`/api/staff/client-appointment-events?since=${encodeURIComponent(cursor)}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load staff notifications");
        const body = await res.json() as { events?: AppointmentEvent[]; serverTime?: string };
        if (!active) return;
        const incoming = Array.isArray(body.events) ? body.events : [];
        const fresh = incoming.filter(e =>
          typeof e.id === "string" && typeof e.at === "string" &&
          ["confirm", "reschedule", "cancel"].includes(e.action) && !known.has(e.id));
        for (const e of incoming) if (typeof e.id === "string") known.add(e.id);
        const isInitial = firstPoll;
        if (firstPoll) {
          setReadIds(stored);
          firstPoll = false;
        }
        if (fresh.length) {
          setEvents(previous => {
            const unique = new Map<string, AppointmentEvent>();
            for (const item of [...previous, ...fresh]) unique.set(item.id, item);
            return [...unique.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_VISIBLE);
          });
          if (!document.hidden && soundRef.current && !isInitial) {
            // Sound is triggered only for newly received events after initial history load.
            const latest = fresh[fresh.length - 1];
            if (latest) soundFor(latest.action);
          }
        }
        if (body.serverTime && Number.isFinite(Date.parse(body.serverTime))) {
          cursor = new Date(Date.parse(body.serverTime) - OVERLAP_MS).toISOString();
        }
        setOnline(true);
      } catch {
        if (active) setOnline(false);
      } finally {
        busy = false;
      }
    }

    void poll();
    const timer = window.setInterval(() => { void poll(); }, POLL_MS);
    const onVisible = () => { if (!document.hidden) void poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [storageKey]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function markRead(ids: string[]) {
    const next = [...new Set([...readIds, ...ids])].slice(-300);
    setReadIds(next);
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
  }

  const acknowledged = new Set(readIds);
  const unread = events.filter(e => !acknowledged.has(e.id)).length;

  return (
    <div className="relative" data-testid="staff-appointment-inbox">
      <button
        type="button"
        aria-label={`Appointment alerts, ${unread} unread`}
        aria-expanded={open}
        aria-controls="staff-appointment-alert-panel"
        onClick={() => setOpen(value => !value)}
        className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-amber-300/30 bg-white/[.06] text-amber-100 transition-colors hover:bg-amber-300/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
      >
        <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" />
        </svg>
        {unread > 0 && <span data-testid="staff-appointment-unread" className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-300 px-1 text-[11px] font-extrabold text-slate-950">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <section
          id="staff-appointment-alert-panel"
          aria-label="Appointment notification inbox"
          className="fixed right-3 top-24 z-[100] max-h-[min(72dvh,520px)] w-[min(410px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-amber-300/35 bg-[#102449] p-4 text-slate-100 shadow-[0_24px_70px_rgba(0,0,0,.65)] sm:right-6"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.13em] text-amber-300">Career Gate · Staff</p>
              <h2 className="mt-1 text-base font-bold">Appointment alerts / تنبيهات المواعيد</h2>
              <p className="mt-1 text-xs text-slate-300">Last 24 hours · {unread} unread</p>
            </div>
            <button type="button" aria-label="Close appointment alerts" onClick={() => setOpen(false)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/20 text-xl">×</button>
          </div>
          <div className="my-3 flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={() => markRead(events.map(e => e.id))} disabled={unread === 0} className="min-h-10 rounded-lg border border-white/20 px-3 py-2 text-xs font-semibold text-slate-100 disabled:opacity-50">Mark all read / تمت القراءة</button>
            <button type="button" aria-pressed={soundEnabled} onClick={() => {
              const next = !soundEnabled;
              soundRef.current = next;
              setSoundEnabled(next);
            }} className="min-h-10 rounded-lg border border-amber-300/30 px-3 py-2 text-xs text-amber-200">{soundEnabled ? "Sound on" : "Enable sound"}</button>
          </div>
          {!online && <p role="status" className="mb-3 rounded-lg bg-rose-400/10 p-2 text-xs text-rose-200">Connection interrupted. Retrying…</p>}
          {events.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-white/[.04] p-4 text-sm text-slate-300">No recent client appointment actions / لا توجد إجراءات حديثة</p>
          ) : (
            <ul className="grid gap-2" aria-live="polite">
              {events.map(e => (
                <li key={e.id} className={`rounded-xl border p-3 ${acknowledged.has(e.id) ? "border-white/10 bg-white/[.03]" : "border-amber-300/35 bg-amber-300/[.08]"}`}>
                  <Link href={`/staff/client/${e.clientId}`} onClick={() => markRead([e.id])} className="block min-h-11 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
                    <span className="block text-sm font-semibold text-white">{label(e.action)}</span>
                    <span className="mt-1 block break-words text-sm text-slate-200">{e.name}</span>
                    <span className="mt-1 block text-xs text-slate-300">{new Date(e.at).toLocaleString()} · Open client file →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
