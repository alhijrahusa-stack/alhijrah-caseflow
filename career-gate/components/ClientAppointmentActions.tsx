"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Slot = { start: string };

export function ClientAppointmentActions({
  refCode,
  appointmentId,
  initialAction,
  initialAcknowledged = false,
  embedded = false,
}: {
  refCode: string;
  appointmentId: string;
  initialAction?: string;
  initialAcknowledged?: boolean;
  embedded?: boolean;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<"reschedule" | "cancel" | null>(
    initialAction === "cancel" ? "cancel" : initialAction === "reschedule" ? "reschedule" : null,
  );
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(initialAction === "reschedule");
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const alreadyAcknowledged = initialAcknowledged || acknowledged;

  useEffect(() => {
    if (!panel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panel]);

  useEffect(() => {
    if (initialAction !== "reschedule") return;
    let active = true;
    void fetch(`/api/status/appointment-action?ref=${encodeURIComponent(refCode)}&appointmentId=${encodeURIComponent(appointmentId)}`, { cache: "no-store" })
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error?.message || "Unable to load availability");
        return data;
      })
      .then(data => {
        if (active) setSlots(data.slots ?? []);
      })
      .catch(() => { if (active) setError("Unable to load available times"); })
      .finally(() => { if (active) setLoadingSlots(false); });
    return () => { active = false; };
  }, [initialAction, refCode, appointmentId]);

  async function openReschedule() {
    setPanel("reschedule");
    setError("");
    setMessage("");
    setSlots([]);
    setSelectedSlot("");
    setLoadingSlots(true);
    try {
      const response = await fetch(`/api/status/appointment-action?ref=${encodeURIComponent(refCode)}&appointmentId=${encodeURIComponent(appointmentId)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "Could not load available times");
      setSlots(data.slots ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load availability");
    } finally {
      setLoadingSlots(false);
    }
  }

  async function submit(action: "confirm" | "reschedule" | "cancel") {
    if (pending || (action === "confirm" && alreadyAcknowledged)) return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/status/appointment-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: refCode,
          appointmentId,
          action,
          slotStart: action === "reschedule" ? selectedSlot : undefined,
          reason: action === "cancel" ? reason : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "Request failed");
      if (action === "confirm") setAcknowledged(true);
      setMessage(
        action === "confirm" ? "Your appointment has been acknowledged. / تم تأكيد استلام الموعد"
          : action === "reschedule" ? "Your change request has been sent to the office. / تم إرسال طلب تعديل الموعد"
            : "Your appointment has been cancelled. / تم إلغاء الموعد",
      );
      setPanel(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={embedded
      ? "mt-5 border-t border-[#C5A059]/20 pt-4 text-white"
      : "mt-4 space-y-3 rounded-2xl border border-[#C5A059]/40 bg-[#0A122C] p-4 text-white"}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-[#E6C585]">Manage Appointment / إدارة الموعد</h3>
        {alreadyAcknowledged && !embedded && <span className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2 py-1 text-[11px] font-semibold text-emerald-200">Acknowledged / تم التأكيد</span>}
      </div>
      {!alreadyAcknowledged && (
        <button type="button" disabled={pending} onClick={() => void submit("confirm")}
          className="min-h-12 w-full rounded-xl bg-gradient-to-r from-[#C5A059] to-[#F5D48E] px-4 py-3 text-sm font-bold text-[#08162e] shadow-[0_8px_20px_rgba(0,0,0,.15)] transition-colors hover:from-[#D4AD62] hover:to-[#FFE5A3] disabled:opacity-50">
          {pending ? "Processing…" : "Confirm Appointment / تأكيد الموعد"}
        </button>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" disabled={pending} onClick={() => void openReschedule()}
          className="min-h-12 rounded-xl border border-[#C5A059]/60 px-2 py-3 text-xs font-semibold leading-5 text-amber-100 transition-colors hover:bg-amber-300/10 disabled:opacity-50 sm:text-sm">
          Reschedule / تعديل
        </button>
        <button type="button" disabled={pending} onClick={() => { setPanel("cancel"); setError(""); }}
          className="min-h-12 rounded-xl border border-rose-300/35 px-2 py-3 text-xs font-semibold leading-5 text-slate-200 transition-colors hover:bg-rose-400/10 disabled:opacity-50 sm:text-sm">
          Cancel / إلغاء
        </button>
      </div>
      {message && <p role="status" className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm leading-6 text-emerald-100">{message}</p>}
      {error && !panel && <p role="alert" className="mt-3 rounded-xl bg-rose-800/40 p-3 text-sm text-rose-100">{error}</p>}

      {panel && (
        <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/75 px-0 sm:items-center sm:p-4" role="presentation" onClick={() => setPanel(null)}>
          <section
            role="dialog" aria-modal="true"
            aria-label={panel === "reschedule" ? "Request a new appointment" : "Cancel appointment"}
            className="max-h-[88dvh] w-full max-w-xl overflow-y-auto rounded-t-[26px] border border-[#C5A059]/65 bg-[#101D3F] p-5 pb-[max(24px,env(safe-area-inset-bottom))] text-white shadow-[0_28px_80px_rgba(0,0,0,.65)] sm:rounded-[26px] sm:p-6"
            onClick={event => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold tracking-wider text-[#E6C585]">CAREER GATE · APPOINTMENTS</p>
                <h4 className="mt-1 text-lg font-bold leading-7">
                  {panel === "reschedule" ? "Choose a new available time / اختر موعداً متاحاً" : "Cancel appointment / إلغاء الموعد"}
                </h4>
              </div>
              <button type="button" onClick={() => setPanel(null)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/30 text-xl" aria-label="Close">×</button>
            </div>
            {panel === "reschedule" ? (
              <>
                <p className="mb-4 text-sm leading-6 text-slate-200">The office must approve a new appointment time. / الموعد الجديد يتطلب موافقة المكتب.</p>
                {loadingSlots ? (
                  <p role="status" className="rounded-xl border border-white/15 bg-white/5 p-4 text-sm text-slate-200">Loading available times / جارٍ تحميل المواعيد…</p>
                ) : slots.length ? (
                  <div className="grid max-h-[45dvh] gap-2 overflow-y-auto">
                    {slots.map(entry => (
                      <label key={entry.start} className="flex min-h-12 items-center gap-3 rounded-xl border border-white/20 bg-white/5 p-3 text-sm">
                        <input type="radio" name="slot" checked={selectedSlot === entry.start} onChange={() => setSelectedSlot(entry.start)} />
                        {new Intl.DateTimeFormat("en-US", { timeZone: "America/Detroit", dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.start))} · Detroit
                      </label>
                    ))}
                  </div>
                ) : !error && (
                  <div role="status" className="rounded-xl border border-amber-300/25 bg-amber-300/[.07] p-4">
                    <p className="font-semibold text-amber-100">No available times / لا توجد مواعيد متاحة</p>
                    <p className="mt-2 text-sm leading-6 text-slate-200">Please contact the office using the contact links below the application status. / يرجى التواصل مع المكتب عبر معلومات الاتصال أسفل الصفحة.</p>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="mb-3 text-sm text-slate-200">Cancellation requires a reason. / يرجى كتابة سبب الإلغاء.</p>
                <textarea required minLength={5} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)}
                  className="min-h-28 w-full rounded-xl border border-white/30 bg-white/10 p-3 text-sm text-white placeholder:text-slate-400"
                  placeholder="Cancellation reason / سبب الإلغاء" />
              </>
            )}
            {error && <p role="alert" className="my-3 rounded-xl border border-rose-300/30 bg-rose-900/40 p-3 text-sm text-rose-100">{error}</p>}
            {(panel === "cancel" || (!loadingSlots && slots.length > 0)) && (
              <button type="button" disabled={pending || (panel === "reschedule" ? !selectedSlot : reason.trim().length < 5)}
                onClick={() => void submit(panel)}
                className="mt-4 min-h-12 w-full rounded-xl bg-gradient-to-r from-[#C5A059] to-[#F5D48E] px-4 py-3 text-sm font-bold text-[#08162e] disabled:opacity-50">
                {pending ? "Sending…" : panel === "reschedule" ? "Send Reschedule Request / إرسال طلب التعديل" : "Confirm Cancellation / تأكيد الإلغاء"}
              </button>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
