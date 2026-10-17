"use client";
import { useMemo, useState } from "react";
import type { OperationsClient } from "@/lib/operations";
import { AMAZON_LOCATIONS } from "@/lib/location-shift-options";

/** Totals are derived from the same active client records as the Pipeline, never from fixture counters. */
export function LocationShiftTelemetry({clients, periodOf}:{clients:OperationsClient[];periodOf:(client:OperationsClient)=>"morning"|"evening"|"night"|"needs_manual_review"}){
 const [expanded,setExpanded]=useState(false);
 const {entries,total,assigned}=useMemo(()=>{
   const counts=new Map<string,{name:string;morning:number;evening:number;night:number;needs_manual_review:number}>();
   AMAZON_LOCATIONS.forEach(([name],index)=>counts.set(`MI_LOC_${String(index+1).padStart(2,"0")}`,{name,morning:0,evening:0,night:0,needs_manual_review:0}));
   let assigned=0;
   for(const client of clients){
     if(client.assigned_staff)assigned++;
     const key=client.site_code||"unselected";
     const row=counts.get(key)??{name:client.site_name||"Location not selected",morning:0,evening:0,night:0,needs_manual_review:0};
     row[periodOf(client)]++;
     counts.set(key,row);
   }
   const entries=[...counts.entries()].map(([code,row])=>({...row,code,total:row.morning+row.evening+row.night+row.needs_manual_review}))
     .sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
   return {entries,total:clients.length,assigned};
 },[clients,periodOf]);
 const visible=expanded?entries:entries.slice(0,6);
 return <section aria-label="Live location and shift totals" className="relative isolate overflow-hidden rounded-3xl border border-amber-300/25 bg-gradient-to-br from-[#0d182b]/95 via-[#111e30]/90 to-[#221b18]/90 p-5 shadow-[0_20px_55px_rgba(1,8,24,.32)] backdrop-blur-xl">
   <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-orange-400/10 blur-3xl"/>
   <div className="relative flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold tracking-[.2em] text-orange-300">CAREER GATE · LIVE DISTRIBUTION</p><h2 className="mt-1 text-xl font-extrabold text-white">Location & Shift Intelligence</h2><p className="mt-1 text-sm text-slate-300">Active client allocations · automatically recalculated from current records</p></div><div className="flex gap-3">
     <div className="rounded-2xl border border-orange-300/25 bg-black/25 px-5 py-3 text-center"><strong key={total} className="cg-telemetry-number block text-3xl font-black tabular-nums text-white">{total}</strong><span className="text-xs text-orange-200">Total candidates</span></div>
     <div className="rounded-2xl border border-emerald-400/20 bg-black/25 px-5 py-3 text-center"><strong key={assigned} className="cg-telemetry-number block text-3xl font-black tabular-nums text-emerald-200">{assigned}</strong><span className="text-xs text-slate-300">Assigned</span></div>
   </div></div>
   <div className="relative mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {visible.map(location=><article key={location.code} className="group rounded-2xl border border-white/10 bg-white/[.035] p-4 transition duration-200 hover:-translate-y-0.5 hover:border-orange-300/35 hover:bg-orange-200/[.065] hover:shadow-[0_10px_35px_rgba(249,115,22,.08)]">
       <div className="flex items-center justify-between gap-2"><h3 className="truncate text-base font-bold text-white" title={location.name}>{location.name}</h3><strong key={location.total} className="cg-telemetry-number rounded-xl border border-orange-300/30 bg-orange-300/10 px-3 py-1 text-xl font-black tabular-nums text-orange-200">{location.total}</strong></div>
       <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">{([["Morning",location.morning],["Evening",location.evening],["Night",location.night],["Review",location.needs_manual_review]] as const).map(([label,count])=><div key={label} className="flex items-center justify-between gap-2 rounded-lg border border-white/[.06] bg-black/20 px-2.5 py-2"><dt className="text-slate-300">{label}</dt><dd key={count} className="cg-telemetry-number font-bold tabular-nums text-white">{count}</dd></div>)}</dl>
    </article>)}
   </div>
   {entries.length>6&&<button type="button" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)} className="relative mt-4 rounded-xl border border-orange-300/30 px-4 py-2 text-sm font-semibold text-orange-200 transition hover:bg-orange-300/10">{expanded?"Show fewer locations":`View all ${entries.length} locations`}</button>}
   {!entries.length&&<p className="relative mt-4 text-sm text-slate-300">No active candidates to display.</p>}
 </section>;
}
