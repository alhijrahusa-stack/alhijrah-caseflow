"use client";
import { useEffect, useRef, useState } from "react";
import { DOCUMENTS, type DocumentId, type NotificationLanguage } from "@/lib/appointment-notification-card";
export function AppointmentNotificationPanel({appointmentId}:{appointmentId:string}) {
 const [language,setLanguage]=useState<NotificationLanguage>("ar");
 const [documents,setDocuments]=useState<DocumentId[]>([]);
 const [preview,setPreview]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [expanded,setExpanded]=useState(true);
 const [error,setError]=useState(false);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[]);
 function chime(success:boolean){try{const context=new AudioContext();const tone=context.createOscillator();const volume=context.createGain();tone.frequency.value=success?880:320;volume.gain.setValueAtTime(.045,context.currentTime);volume.gain.exponentialRampToValueAtTime(.0001,context.currentTime+.22);tone.connect(volume).connect(context.destination);tone.start();tone.stop(context.currentTime+.23);tone.onended=()=>{void context.close()}}catch{}}
 async function request(mode:"preview"|"send"){
   if(busy)return;
   setBusy(true);setMessage("");setError(false);
   if(timer.current)clearTimeout(timer.current);
   try {
     const res=await fetch("/api/staff/appointment-notification",{method:"POST",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({appointmentId,language,documents,mode})});
     const data=await res.json();
     if(!res.ok)throw new Error(data.error?.message||"Request failed");
     if(mode==="preview")setPreview(data.html);
     else {chime(true);setMessage("تم قبول الإرسال من مزود البريد الإلكتروني بنجاح. وصول الرسالة لصندوق الوارد لم يتأكد بعد.");timer.current=setTimeout(()=>{setExpanded(false);setPreview("");setMessage("")},3000);}
   }catch(e){setError(true);chime(false);setMessage(e instanceof Error?e.message:"Request failed");}
   finally{setBusy(false);}
 }
 return <section className="relative w-full min-w-0 overflow-hidden rounded-2xl border border-amber-300/30 bg-gradient-to-br from-[#153552] via-[#0d2845] to-[#09192d] p-4 text-white shadow-xl sm:p-5" aria-label="Client appointment notification">
  <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-bold tracking-[.18em] text-amber-300">CAREER GATE · بوابة التوظيف</p><h2 className="mt-1 text-lg font-bold text-white">Executive Smart Gate Pass</h2></div>{!expanded&&<button type="button" onClick={()=>setExpanded(true)} className="rounded-xl border border-amber-300/50 px-3 py-2 text-xs">فتح / Open</button>}</div>
  {expanded&&<div className="mt-3 min-w-0">
  <p className="mt-1 text-xs text-slate-300">اختر اللغة والمستندات المطلوبة، ثم راجع البطاقة قبل إرسالها.</p>
  <label className="mt-3 block text-sm">Client language / لغة العميل</label>
  <select className="mt-2 w-full rounded-xl border border-white/20 bg-[#193753] p-3" value={language} onChange={e=>{setLanguage(e.target.value as NotificationLanguage);setPreview("");}}>
    <option value="ar">العربية</option><option value="en">English</option><option value="both">العربية + English</option>
  </select>
  <fieldset className="mt-3"><legend className="text-sm">Required documents / المستندات المطلوبة</legend>
   <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-2">
   {DOCUMENTS.map(d=><label key={d.id} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-xs leading-5 transition-all duration-300 hover:border-amber-300/50 hover:bg-white/10">
    <input type="checkbox" checked={documents.includes(d.id)} onChange={e=>{setDocuments(v=>e.target.checked?[...v,d.id]:v.filter(x=>x!==d.id));setPreview("");}}/>
    <span className="min-w-0 break-words">{language==="en"?d.en:d.ar}</span></label>)}</div>
  </fieldset>
  <div className="mt-4 flex flex-wrap gap-2">
   <button disabled={busy} onClick={()=>request("preview")} className="rounded-xl border border-amber-300/60 px-4 py-2 text-sm text-amber-200 transition-all duration-300 hover:bg-amber-300/10 disabled:opacity-50">Preview / معاينة</button>
   <button disabled={busy||!preview} onClick={()=>request("send")} className="rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-all duration-300 hover:brightness-110 disabled:opacity-50">Send Email / إرسال</button>
  </div>
  {message&&<p role={error?"alert":"status"} className={"mt-3 rounded-xl border p-3 text-xs "+(error?"border-rose-400/50 bg-rose-400/10":"border-emerald-400/50 bg-emerald-400/10")}>{message}</p>}
  {preview&&<iframe title="Appointment card preview" sandbox="" srcDoc={preview} className="mt-4 h-[540px] w-full rounded-xl bg-white"/>}
 </div>}
 </section>;
}
