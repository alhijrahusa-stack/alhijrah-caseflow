"use client";
import { useState } from "react";
import { useTargetedMutation } from "@/components/staff/realtime/useTargetedMutation";

export function ConfirmStartedControl({clientId}:{clientId:string}){
  const onMutated=useTargetedMutation();
  const [startDate,setStartDate]=useState("");
  const [busy,setBusy]=useState(false);
  async function run(){
    if(!startDate)return;
    setBusy(true);
    const response=await fetch("/api/staff/operations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({operation:"confirm_started",client_id:clientId,start_date:startDate})}).catch(()=>null);
    setBusy(false);
    if(response?.ok)onMutated("confirm_started",clientId);
  }
  return <div className="flex gap-2"><input type="date" className="input" value={startDate} onChange={(e)=>setStartDate(e.target.value)} disabled={busy}/><button type="button" className="ops-primary-button" disabled={busy||!startDate} onClick={()=>void run()}>{busy?"Saving…":"Confirm Placement & Move to Active Work"}</button></div>;
}
