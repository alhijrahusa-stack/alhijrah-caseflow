"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AMAZON_LOCATIONS, SHIFT_TYPES, DAY_PATTERNS, SHIFT_DEFAULT_DAYS, SHIFT_DEFAULT_HOURS } from "@/lib/location-shift-options";

export function ClientLocationShiftCard({clients}:{clients:{id:string;full_name:string;ref:string}[]}){
 const router=useRouter();
 const [client,setClient]=useState("");
 const [location,setLocation]=useState("");
 const [shift,setShift]=useState("");
 const [days,setDays]=useState("");
 const [hours,setHours]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 async function save(){
  if(!client||!location||!shift||!days||!hours.trim())return;
  setBusy(true);setMessage("");
  try{
   const res=await fetch("/api/staff/client-preference",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({client_id:client,location:Number(location),shift,days,hours:hours.trim()})
   });
   const result=await res.json();
   if(!res.ok||!result?.ok)throw new Error(result?.error?.message??"Could not save selection");
   setMessage("Saved. The existing client file is now grouped under the selected location and shift.");
   router.refresh();
  }catch(e){setMessage(e instanceof Error?e.message:"Save failed");}finally{setBusy(false);}
 }
 return <section className="relative overflow-hidden rounded-3xl border border-orange-300/35 bg-gradient-to-br from-[#0a0c10]/95 via-[#17110d]/95 to-[#261405]/90 p-5 text-white shadow-[0_20px_70px_rgba(0,0,0,.32)] backdrop-blur-2xl" aria-label="Smart location and shift assignment">
  <div className="pointer-events-none absolute -right-12 -top-24 h-52 w-52 rounded-full bg-orange-500/15 blur-3xl"/>
  <div className="relative mb-5 flex flex-wrap items-center justify-between gap-2">
   <div><p className="text-xs font-bold uppercase tracking-[.2em] text-orange-300">CAREER GATE · SMART ASSIGNMENT</p>
    <h2 className="mt-1 text-xl font-bold text-white">Location & Shift Command Card</h2>
    <p className="mt-1 text-sm text-white/65">Assign preferences to the existing client record · No duplicate file</p></div>
   <span className="rounded-full border border-orange-300/30 bg-orange-400/10 px-3 py-1 text-xs font-bold text-orange-200">STAFF OPERATIONS</span>
  </div>
  <div className="relative grid gap-3 lg:grid-cols-4">
   <label className="grid gap-1.5 text-sm font-semibold text-white/85">Client
    <select className="input min-h-12 border-orange-300/25 bg-black/55 text-white" value={client} onChange={e=>{setClient(e.target.value);setMessage("");}}>
     <option value="">Select existing client</option>{clients.map(c=><option key={c.id} value={c.id}>{c.full_name} · {c.ref}</option>)}
    </select></label>
   <label className="grid gap-1.5 text-sm font-semibold text-white/85">Preferred Location
    <select className="input min-h-12 border-orange-300/25 bg-black/55 text-white" value={location} onChange={e=>{setLocation(e.target.value);setShift("");setDays("");setHours("");}}>
     <option value="">Choose Amazon location</option>{AMAZON_LOCATIONS.map(([name,address],i)=><option key={i} value={i}>{name} · {address}</option>)}
    </select></label>
   {location!==""&&<label className="grid gap-1.5 text-sm font-semibold text-white/85">Select Schedule / Shift
    <select className="input min-h-12 border-orange-300/25 bg-black/55 text-white" value={shift} onChange={e=>{const value=e.target.value;setShift(value);setDays(SHIFT_DEFAULT_DAYS[value]??"custom");setHours(SHIFT_DEFAULT_HOURS[value]??"");}}>
     <option value="">Choose shift preference</option>{SHIFT_TYPES.map(([code,name])=><option key={code} value={code}>{name}</option>)}
    </select></label>}
   {shift&&<label className="grid gap-1.5 text-sm font-semibold text-white/85">Days / Pattern
    <select className="input min-h-12 border-orange-300/25 bg-black/55 text-white" value={days} onChange={e=>setDays(e.target.value)}>
     {DAY_PATTERNS.map(([code,name])=><option key={code} value={code}>{name}</option>)}
    </select></label>}
  </div>
  {shift&&<div className="relative mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
   <label className="grid gap-1 text-sm font-semibold text-white/80">Preferred Hours (compatible schedule options)
    <select className="input min-h-12 border-orange-300/25 bg-black/55 text-white" value={hours} onChange={e=>setHours(e.target.value)}><option value={SHIFT_DEFAULT_HOURS[shift]}>{SHIFT_DEFAULT_HOURS[shift]}</option>{shift==="front_half"||shift==="back_half"?<option value="06:30 PM – 05:00 AM">06:30 PM – 05:00 AM</option>:null}{shift==="morning"||shift==="mid"?<option value="08:00 AM – 04:30 PM">08:00 AM – 04:30 PM</option>:null}{shift==="night"?<option value="10:00 PM – 06:30 AM">10:00 PM – 06:30 AM</option>:null}</select>
   </label>
   <button type="button" disabled={busy||!client||!location||!shift||!days||!hours.trim()} onClick={save} className="self-end rounded-xl bg-orange-500 px-6 py-3 font-bold text-black transition hover:bg-orange-300 disabled:cursor-not-allowed disabled:opacity-40">
     {busy?"Saving…":"Save Location & Shift"}
   </button></div>}
  <p className="relative mt-3 text-xs text-white/55">Selections are preferences, not confirmed Amazon openings or guaranteed schedules.</p>
  {message&&<p role="status" className="relative mt-3 rounded-xl border border-orange-300/20 bg-black/35 p-3 text-sm text-orange-100">{message}</p>}
 </section>;
}
