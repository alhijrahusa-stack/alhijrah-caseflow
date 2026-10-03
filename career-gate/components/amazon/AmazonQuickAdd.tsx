"use client";

import Link from "next/link";
import { useState } from "react";
import { AmazonEmailForm } from "@/components/amazon/AmazonEmailForm";

export function AmazonQuickAdd() {
  const [added, setAdded] = useState<string | null>(null);
  return <main className="mx-auto max-w-xl py-6">
    <section className="rounded-3xl border border-amber-200/[.12] bg-[radial-gradient(circle_at_15%_0%,rgba(245,197,66,.08),transparent_35%),linear-gradient(145deg,rgba(8,16,33,.98),rgba(4,9,20,.95))] p-6 shadow-[0_28px_90px_rgba(0,0,0,.3)] backdrop-blur-md">
      <p className="text-[9px] font-semibold tracking-[.22em] text-amber-300/70">CAREER GATE · QUICK ADD</p><h1 className="mt-2 text-xl font-semibold">AMAZON ACCOUNT EMAIL</h1><p className="mt-1 text-xs text-slate-500">Encrypted Staff-only credential intake.</p>
      <div className="mt-6">{added?<div className="space-y-4"><div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[.05] p-4"><strong className="text-sm text-emerald-200">AMAZON EMAIL ADDED</strong><p className="mt-1 text-xs text-slate-400">{added}</p></div><div className="flex gap-2"><button onClick={()=>setAdded(null)} className="flex-1 rounded-xl border border-amber-200/30 bg-amber-300 px-4 py-2 text-xs font-bold text-black">ADD ANOTHER</button><Link href="/staff/amazon-account" className="flex-1 rounded-xl border border-cyan-300/20 px-4 py-2 text-center text-xs text-cyan-100">OPEN AMAZON ACCOUNT</Link></div></div>:<AmazonEmailForm endpoint="/api/staff/amazon-account/emails/quick-add" submitLabel="ADD TO VAULT ✦" onSuccess={(record)=>setAdded(record.email)} />}</div>
    </section>
  </main>;
}
