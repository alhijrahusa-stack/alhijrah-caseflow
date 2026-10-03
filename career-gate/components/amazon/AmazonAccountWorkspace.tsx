"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { AmazonAccounts } from "@/components/amazon/AmazonAccounts";
import { AmazonEmailVault } from "@/components/amazon/AmazonEmailVault";

type Tab = "vault" | "accounts";

export function AmazonAccountWorkspace() {
  const params = useSearchParams();
  const initial: Tab = params.get("tab") === "accounts" ? "accounts" : "vault";
  const [tab, setTab] = useState<Tab>(initial);
  const [visited, setVisited] = useState<Record<Tab, boolean>>({ vault: true, accounts: initial === "accounts" });

  function select(next: Tab) {
    setTab(next);
    setVisited((current) => ({ ...current, [next]: true }));
    const url = new URL(window.location.href);
    if (next === "vault") url.searchParams.delete("tab"); else url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  }

  return <div className="mx-auto max-w-[1700px] space-y-4" data-testid="amazon-account-workspace">
    <header className="relative overflow-hidden rounded-3xl border border-amber-200/[.11] bg-[radial-gradient(circle_at_18%_0%,rgba(245,197,66,.08),transparent_34%),linear-gradient(145deg,rgba(8,16,33,.98),rgba(4,9,20,.94))] p-5 shadow-[0_28px_90px_rgba(0,0,0,.32)]">
      <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-amber-200/35 to-transparent" aria-hidden="true" />
      <div className="relative"><p className="text-[9px] font-semibold tracking-[.24em] text-amber-300/70">CAREER GATE · SECURE OPERATIONS</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-50">AMAZON ACCOUNT</h1><p className="mt-1 text-sm text-slate-500">Secure Credential &amp; Assignment Operations</p></div>
    </header>
    <div className="flex gap-1 rounded-2xl border border-white/[.07] bg-[#09101e]/75 p-1.5 backdrop-blur-md" role="tablist" aria-label="Amazon Account workspace">
      <button type="button" role="tab" aria-selected={tab==="vault"} onClick={()=>select("vault")} className={`min-h-10 flex-1 rounded-xl px-4 text-xs font-semibold transition ${tab==="vault"?"border border-amber-300/20 bg-amber-300/[.08] text-amber-100 shadow-[inset_0_1px_rgba(255,255,255,.04)]":"text-slate-500 hover:bg-white/[.03] hover:text-slate-300"}`}>AMAZON EMAIL VAULT</button>
      <button type="button" role="tab" aria-selected={tab==="accounts"} onClick={()=>select("accounts")} className={`min-h-10 flex-1 rounded-xl px-4 text-xs font-semibold transition ${tab==="accounts"?"border border-cyan-300/20 bg-cyan-300/[.06] text-cyan-100 shadow-[inset_0_1px_rgba(255,255,255,.04)]":"text-slate-500 hover:bg-white/[.03] hover:text-slate-300"}`}>AMAZON ACCOUNTS</button>
    </div>
    <div role="tabpanel" hidden={tab!=="vault"}>{visited.vault&&<AmazonEmailVault />}</div>
    <div role="tabpanel" hidden={tab!=="accounts"}>{visited.accounts&&<AmazonAccounts />}</div>
  </div>;
}
