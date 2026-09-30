"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ConfirmStartedControl({clientId}:{clientId:string}){
  const router=useRouter();
  const [startDate,setStartDate]=useState("");
  const [busy,setBusy]=useState(false);
  async function run(){
    if(!startDate)return;
    setBusy(true);
    const response=await fetch("/api/staff/operations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({operation:"confirm_started",client_id:clientId,start_date:startDate})}).catch(()=>null);
    setBusy(false);
    if(response?.ok)router.refresh();
  }
  return <div className="flex gap-2"><input type="date" className="input" value={startDate} onChange={(e)=>setStartDate(e.target.value)} disabled={busy}/><button type="button" className="ops-primary-button" disabled={busy||!startDate} onClick={()=>void run()}>{busy?"Saving…":"Confirm Started"}</button></div>;
}
