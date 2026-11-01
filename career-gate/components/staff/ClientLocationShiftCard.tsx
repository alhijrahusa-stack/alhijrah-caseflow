"use client";

import { RoyalSelect, RoyalOption } from "@/components/forms/RoyalSelect";

import { useState } from "react";
import { useTargetedMutation } from "@/components/staff/realtime/useTargetedMutation";
import { AMAZON_LOCATIONS, SHIFT_TYPES, DAY_PATTERNS, SHIFT_DEFAULT_DAYS, SHIFT_DEFAULT_HOURS } from "@/lib/location-shift-options";

export function ClientLocationShiftCard({clients}:{clients:{id:string;full_name:string;ref:string}[]}){
 const onMutated=useTargetedMutation();
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
   onMutated("add_preference",client);
  }catch(e){setMessage(e instanceof Error?e.message:"Save failed");}finally{setBusy(false);}
 }
 return <details className="cg-compact-assignment group rounded-2xl border border-amber-200/20 bg-[#0c1c2e] text-white" aria-label="Smart location and shift assignment">
  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 sm:px-5">
   <span className="min-w-0"><span className="block text-xs font-semibold tracking-[.08em] text-amber-200">CAREER GATE · SMART ASSIGNMENT</span><span className="mt-1 block text-sm font-semibold text-slate-100">Location & Shift · Assign existing client</span></span>
   <span aria-hidden="true" className="shrink-0 rounded-lg border border-amber-200/25 px-3 py-2 text-xs font-semibold text-amber-100 group-open:hidden">Open ↘</span>
   <span aria-hidden="true" className="hidden shrink-0 rounded-lg border border-amber-200/25 px-3 py-2 text-xs font-semibold text-amber-100 group-open:inline">Close ↗</span>
  </summary>
  <div className="border-t border-white/10 px-4 pb-4 pt-4 sm:px-5">
   <p className="mb-4 text-xs text-slate-400">Preferences update the existing canonical client file; they do not create a duplicate case.</p>
  <div className="relative grid gap-4 lg:grid-cols-4">
   <label className="grid gap-1.5 text-sm font-semibold text-white/85">Client
    <RoyalSelect className="input min-h-14 rounded-xl border-orange-300/30 bg-[#121824]/85 text-white shadow-[inset_0_1px_2px_rgba(255,255,255,.06)] backdrop-blur-xl transition-all duration-200 hover:border-orange-200/50 focus:border-orange-300 focus:ring-2 focus:ring-orange-400/25" value={client} onChange={e=>{setClient(e.target.value);setMessage("");}}>
     <RoyalOption value="">Select existing client</RoyalOption>{clients.map(c=><RoyalOption key={c.id} value={c.id}>{c.full_name} · {c.ref}</RoyalOption>)}
    </RoyalSelect></label>
   <label className="grid gap-1.5 text-sm font-semibold text-white/85">Preferred Location
    <RoyalSelect className="input min-h-14 rounded-xl border-orange-300/30 bg-[#121824]/85 text-white shadow-[inset_0_1px_2px_rgba(255,255,255,.06)] backdrop-blur-xl transition-all duration-200 hover:border-orange-200/50 focus:border-orange-300 focus:ring-2 focus:ring-orange-400/25" value={location} onChange={e=>{setLocation(e.target.value);setShift("");setDays("");setHours("");}}>
     <RoyalOption value="">Choose Amazon location</RoyalOption>{AMAZON_LOCATIONS.map(([name,address],i)=><RoyalOption key={i} value={i}>{name} · {address}</RoyalOption>)}
    </RoyalSelect></label>
   {location!==""&&<label className="grid gap-1.5 text-sm font-semibold text-white/85">Select Schedule / Shift
    <RoyalSelect className="input min-h-14 rounded-xl border-orange-300/30 bg-[#121824]/85 text-white shadow-[inset_0_1px_2px_rgba(255,255,255,.06)] backdrop-blur-xl transition-all duration-200 hover:border-orange-200/50 focus:border-orange-300 focus:ring-2 focus:ring-orange-400/25" value={shift} onChange={e=>{const value=e.target.value;setShift(value);setDays(SHIFT_DEFAULT_DAYS[value]??"custom");setHours(SHIFT_DEFAULT_HOURS[value]??"");}}>
     <RoyalOption value="">Choose shift preference</RoyalOption>{SHIFT_TYPES.map(([code,name])=><RoyalOption key={code} value={code}>{name}</RoyalOption>)}
    </RoyalSelect></label>}
   {shift&&<label className="grid gap-1.5 text-sm font-semibold text-white/85">Days / Pattern
    <RoyalSelect className="input min-h-14 rounded-xl border-orange-300/30 bg-[#121824]/85 text-white shadow-[inset_0_1px_2px_rgba(255,255,255,.06)] backdrop-blur-xl transition-all duration-200 hover:border-orange-200/50 focus:border-orange-300 focus:ring-2 focus:ring-orange-400/25" value={days} onChange={e=>setDays(e.target.value)}>
     {DAY_PATTERNS.map(([code,name])=><RoyalOption key={code} value={code}>{name}</RoyalOption>)}
    </RoyalSelect></label>}
  </div>
  {shift&&<div className="relative mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
   <label className="grid gap-1 text-sm font-semibold text-white/80">Preferred Hours (compatible schedule options)
    <RoyalSelect className="input min-h-14 rounded-xl border-orange-300/30 bg-[#121824]/85 text-white shadow-[inset_0_1px_2px_rgba(255,255,255,.06)] backdrop-blur-xl transition-all duration-200 hover:border-orange-200/50 focus:border-orange-300 focus:ring-2 focus:ring-orange-400/25" value={hours} onChange={e=>setHours(e.target.value)}><RoyalOption value={SHIFT_DEFAULT_HOURS[shift]}>{SHIFT_DEFAULT_HOURS[shift]}</RoyalOption>{shift==="front_half"||shift==="back_half"?<RoyalOption value="06:30 PM – 05:00 AM">06:30 PM – 05:00 AM</RoyalOption>:null}{shift==="morning"||shift==="mid"?<RoyalOption value="08:00 AM – 04:30 PM">08:00 AM – 04:30 PM</RoyalOption>:null}{shift==="night"?<RoyalOption value="10:00 PM – 06:30 AM">10:00 PM – 06:30 AM</RoyalOption>:null}</RoyalSelect>
   </label>
   <button type="button" disabled={busy||!client||!location||!shift||!days||!hours.trim()} onClick={save} className="self-end rounded-xl bg-orange-500 px-6 py-3 font-bold text-black transition hover:bg-orange-300 disabled:cursor-not-allowed disabled:opacity-40">
     {busy?"Saving…":"Save Location & Shift"}
   </button></div>}
  <p className="relative mt-3 text-xs text-white/55">Selections are preferences, not confirmed Amazon openings or guaranteed schedules.</p>
  {message&&<p role="status" className="relative mt-3 rounded-xl border border-orange-300/20 bg-black/35 p-3 text-sm text-orange-100">{message}</p>}
  </div>
 </details>;
}
