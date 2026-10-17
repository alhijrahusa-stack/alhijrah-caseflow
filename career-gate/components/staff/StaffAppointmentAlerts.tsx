"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
type Event={id:string;clientId:string;at:string;action:"confirm"|"reschedule"|"cancel";name:string};
function play(action:Event["action"]){
  try{const ctx=new AudioContext();const tones=action==="confirm"?[880]:action==="reschedule"?[660,880]:[330,280];tones.forEach((frequency,index)=>{const o=ctx.createOscillator();const g=ctx.createGain();const start=ctx.currentTime+index*.16;o.type="sine";o.frequency.value=frequency;g.gain.setValueAtTime(.0001,start);g.gain.exponentialRampToValueAtTime(.055,start+.02);g.gain.exponentialRampToValueAtTime(.0001,start+.18);o.connect(g).connect(ctx.destination);o.start(start);o.stop(start+.19)});setTimeout(()=>{void ctx.close()},1000)}catch{}
}
export function StaffAppointmentAlerts(){
  const [enabled,setEnabled]=useState(false);
  const [events,setEvents]=useState<Event[]>([]);
  const last=useRef(new Date().toISOString());
  const known=useRef(new Set<string>());
  useEffect(()=>{
    if(!enabled)return;
    let live=true;
    async function poll(){
      try{const res=await fetch("/api/staff/client-appointment-events?since="+encodeURIComponent(last.current),{cache:"no-store"});if(!res.ok)return;const data=await res.json();if(!live)return;
        const incoming=(data.events||[]) as Event[];
        const unseen=incoming.filter(e=>!known.current.has(e.id));
        for(const e of incoming)known.current.add(e.id);
        if(unseen.length){setEvents(old=>[...unseen.reverse(),...old].slice(0,8));play(unseen[0].action)}
        last.current=data.serverTime||new Date().toISOString();
      }catch{}
    }
    void poll();const timer=setInterval(()=>{if(!document.hidden)void poll()},5000);
    return()=>{live=false;clearInterval(timer)};
  },[enabled]);
  return <section className="rounded-2xl border border-amber-300/30 bg-[#0b1d30] p-4 text-white" aria-label="Client appointment alerts">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-[10px] font-bold tracking-[.16em] text-amber-300">CAREER GATE · LIVE OPERATIONS</p><h2 className="mt-1 text-sm font-semibold">Client Actions / إجراءات العملاء</h2></div>
      <button type="button" onClick={()=>setEnabled(v=>!v)} className="min-h-11 rounded-xl border border-amber-300/50 px-4 py-2 text-xs font-bold text-amber-200">{enabled?"Sound alerts on / إيقاف":"Enable live sound alerts / تفعيل التنبيه"}</button>
    </div>
    <p className="mt-2 text-xs text-slate-300">Checks every 5 seconds while this page is open. Sound requires activation by the employee.</p>
    {events.length>0&&<ul className="mt-3 grid gap-2">{events.map(e=><li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/5 p-3 text-xs"><span className="break-words">{e.action==="confirm"?"✓ Confirmed & Client Acknowledged":e.action==="reschedule"?"↻ Reschedule requested":"! Appointment cancelled"} · {e.name}<span className="ml-2 text-slate-400">{new Date(e.at).toLocaleString()}</span></span><Link href={`/staff/client/${e.clientId}`} className="rounded-lg border border-amber-300/30 px-3 py-2 text-amber-200">Open file</Link></li>)}</ul>}
  </section>;
}
