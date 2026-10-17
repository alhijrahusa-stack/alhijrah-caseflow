"use client";
import { useState } from "react";
import { DOCUMENTS, type DocumentId, type NotificationLanguage } from "@/lib/appointment-notification-card";
export function AppointmentNotificationPanel({appointmentId}:{appointmentId:string}) {
 const [language,setLanguage]=useState<NotificationLanguage>("ar");
 const [documents,setDocuments]=useState<DocumentId[]>([]);
 const [preview,setPreview]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 async function request(mode:"preview"|"send"){
   setBusy(true);setMessage("");
   try {
     const res=await fetch("/api/staff/appointment-notification",{method:"POST",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({appointmentId,language,documents,mode})});
     const data=await res.json();
     if(!res.ok)throw new Error(data.error?.message||"Request failed");
     if(mode==="preview")setPreview(data.html);
     else setMessage("Accepted by email provider. Delivery to inbox is not yet confirmed.");
   }catch(e){setMessage(e instanceof Error?e.message:"Request failed");}
   finally{setBusy(false);}
 }
 return <section className="rounded-2xl border border-slate-400/30 bg-slate-900/90 p-4 text-white shadow-xl" aria-label="Client appointment notification">
  <h2 className="text-lg font-semibold text-orange-300">Career Gate · Appointment Notification</h2>
  <p className="mt-1 text-xs text-slate-300">اختر اللغة والمستندات المطلوبة، ثم راجع البطاقة قبل إرسالها.</p>
  <label className="mt-3 block text-sm">Client language / لغة العميل</label>
  <select className="mt-1 w-full rounded-lg bg-slate-800 p-2" value={language} onChange={e=>{setLanguage(e.target.value as NotificationLanguage);setPreview("");}}>
    <option value="ar">العربية</option><option value="en">English</option><option value="both">العربية + English</option>
  </select>
  <fieldset className="mt-3"><legend className="text-sm">Required documents / المستندات المطلوبة</legend>
   <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
   {DOCUMENTS.map(d=><label key={d.id} className="flex items-center gap-2 rounded-lg border border-slate-600/40 px-2 py-1.5 text-xs">
    <input type="checkbox" checked={documents.includes(d.id)} onChange={e=>{setDocuments(v=>e.target.checked?[...v,d.id]:v.filter(x=>x!==d.id));setPreview("");}}/>
    <span>{language==="en"?d.en:d.ar}</span></label>)}</div>
  </fieldset>
  <div className="mt-4 flex flex-wrap gap-2">
   <button disabled={busy} onClick={()=>request("preview")} className="rounded-xl border border-orange-400 px-4 py-2 text-sm disabled:opacity-50">Preview / معاينة</button>
   <button disabled={busy||!preview} onClick={()=>request("send")} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Send Email / إرسال</button>
  </div>
  {message&&<p role="status" className="mt-3 text-xs">{message}</p>}
  {preview&&<iframe title="Appointment card preview" sandbox="" srcDoc={preview} className="mt-4 h-[540px] w-full rounded-xl bg-white"/>}
 </section>;
}
