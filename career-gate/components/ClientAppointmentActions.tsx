"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
type Slot={start:string};
export function ClientAppointmentActions({refCode,appointmentId}:{refCode:string;appointmentId:string}) {
  const router=useRouter();
  const [panel,setPanel]=useState<"reschedule"|"cancel"|null>(null);
  const [slots,setSlots]=useState<Slot[]>([]);
  const [slot,setSlot]=useState("");
  const [reason,setReason]=useState("");
  const [pending,setPending]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  useEffect(()=>{if(!panel)return;const esc=(e:KeyboardEvent)=>{if(e.key==="Escape")setPanel(null)};window.addEventListener("keydown",esc);return()=>window.removeEventListener("keydown",esc)},[panel]);
  async function openReschedule(){
    setPanel("reschedule");setError("");setMessage("");setSlots([]);
    try{const r=await fetch(`/api/status/appointment-action?ref=${encodeURIComponent(refCode)}&appointmentId=${encodeURIComponent(appointmentId)}`,{cache:"no-store"});const d=await r.json();if(!r.ok)throw Error(d.error?.message||"Could not load times");setSlots(d.slots||[])}catch(e){setError(e instanceof Error?e.message:"Unable to load availability")}
  }
  async function submit(action:"confirm"|"reschedule"|"cancel"){
    if(pending)return;setPending(true);setError("");setMessage("");
    try{
      const r=await fetch("/api/status/appointment-action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ref:refCode,appointmentId,action,slotStart:action==="reschedule"?slot:undefined,reason:action==="cancel"?reason:undefined})});
      const d=await r.json();if(!r.ok)throw Error(d.error?.message||"Request failed");
      setMessage(action==="confirm"?"Your appointment has been acknowledged. / تم تأكيد استلام الموعد":action==="reschedule"?"Your change request has been sent to the office. / تم إرسال طلب تعديل الموعد":"Your appointment has been cancelled. / تم إلغاء الموعد");
      setPanel(null);router.refresh();
    }catch(e){setError(e instanceof Error?e.message:"Request failed")}finally{setPending(false)}
  }
  return <section className="mt-4 space-y-3 rounded-2xl border border-[#C5A059]/40 bg-[#0A122C] p-4 text-white">
    <p className="text-xs font-bold tracking-wider text-[#E6BF79]">CAREER GATE · بوابة التوظيف</p>
    <h3 className="text-base font-semibold">Appointment Actions / إدارة الموعد</h3>
    <div className="grid gap-2 sm:grid-cols-3">
      <button type="button" disabled={pending} onClick={()=>void submit("confirm")} className="min-h-12 rounded-xl bg-[#C5A059] px-3 py-3 text-sm font-semibold text-[#040914] disabled:opacity-50">Confirm / تأكيد الموعد</button>
      <button type="button" onClick={()=>void openReschedule()} className="min-h-12 rounded-xl border border-[#C5A059] px-3 py-3 text-sm font-semibold">Reschedule / طلب تعديل</button>
      <button type="button" onClick={()=>{setPanel("cancel");setError("");}} className="min-h-12 rounded-xl border border-rose-300/50 px-3 py-3 text-sm font-semibold">Cancel / إلغاء</button>
    </div>
    {message&&<p role="status" className="rounded-lg bg-emerald-800/40 p-3 text-sm">{message}</p>}
    {error&&!panel&&<p role="alert" className="rounded-lg bg-rose-800/40 p-3 text-sm">{error}</p>}
    {panel&&<div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/70" role="presentation" onClick={()=>setPanel(null)}>
      <section role="dialog" aria-modal="true" aria-label={panel==="reschedule"?"Request a new appointment":"Cancel appointment"} className="max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-[#C5A059] bg-[#0A122C] p-5 pb-[max(20px,env(safe-area-inset-bottom))] text-white" onClick={e=>e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-2"><h4 className="text-lg font-bold">{panel==="reschedule"?"Choose a new available time / اختر موعداً متاحاً":"Cancel appointment / إلغاء الموعد"}</h4><button type="button" onClick={()=>setPanel(null)} className="h-11 w-11 rounded-xl border border-white/30" aria-label="Close">×</button></div>
        {panel==="reschedule"?<><p className="mb-3 text-sm text-slate-300">This is a request. The office must approve the new appointment time. / الموعد الجديد يتطلب موافقة المكتب.</p><div className="grid max-h-[45dvh] gap-2 overflow-y-auto">{slots.map(s=><label key={s.start} className="flex min-h-12 items-center gap-3 rounded-xl border border-white/20 p-3 text-sm"><input type="radio" name="slot" checked={slot===s.start} onChange={()=>setSlot(s.start)}/>{new Intl.DateTimeFormat("en-US",{timeZone:"America/Detroit",dateStyle:"medium",timeStyle:"short"}).format(new Date(s.start))} · Detroit</label>)}{slots.length===0&&!error&&<p className="text-sm text-slate-300">No available slots / لا توجد مواعيد متاحة</p>}</div></>:<><p className="mb-3 text-sm text-slate-300">Cancellation requires a reason. / يرجى كتابة سبب الإلغاء.</p><textarea required minLength={5} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} className="min-h-28 w-full rounded-xl border border-white/30 bg-white/10 p-3 text-sm text-white" placeholder="Cancellation reason / سبب الإلغاء"/></>}
        {error&&<p role="alert" className="my-3 rounded-xl bg-rose-800/30 p-3 text-sm">{error}</p>}
        <button type="button" disabled={pending||(panel==="reschedule"?!slot:reason.trim().length<5)} onClick={()=>void submit(panel)} className="mt-4 min-h-12 w-full rounded-xl bg-[#C5A059] p-3 font-bold text-[#040914] disabled:opacity-50">{pending?"Sending…":panel==="reschedule"?"Send Reschedule Request / إرسال طلب التعديل":"Confirm Cancellation / تأكيد الإلغاء"}</button>
      </section>
    </div>}
  </section>;
}
