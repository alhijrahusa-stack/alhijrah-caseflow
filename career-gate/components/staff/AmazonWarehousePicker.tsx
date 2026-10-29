"use client";

import { useMemo, useState } from "react";
import { AMAZON_INTERVIEW_SITES, siteForLocation, warehouseLocation, warehouseMapUrl } from "@/lib/amazon-interview-sites";

export function AmazonWarehousePicker({ value, onChange, disabled = false }: {
  value: string;
  onChange: (location: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string>(siteForLocation(value)?.code ?? "");
  const matches = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return AMAZON_INTERVIEW_SITES.filter(site =>
      !term || [site.code,site.name,site.kind,site.address].some(field => field.toLocaleLowerCase().includes(term))
    );
  }, [query]);
  const selected = AMAZON_INTERVIEW_SITES.find(site => site.code === chosen) ?? null;
  const current = siteForLocation(value);

  const copy = async (location: string) => {
    try { await navigator.clipboard.writeText(location); } catch { /* Clipboard permission is managed by the browser. */ }
  };
  return <>
    <button type="button" disabled={disabled} onClick={() => {setChosen(current?.code ?? "");setQuery("");setOpen(true);}}
      className="min-h-11 w-full rounded-xl border border-amber-300/35 bg-[#102e49] px-4 py-2.5 text-left text-sm font-semibold text-amber-100 transition hover:border-amber-300/70 hover:bg-[#1a3c55] disabled:opacity-50">
      <span aria-hidden="true">⌖</span> {current ? `${current.name} · ${current.code}` : "اختيار موقع مستودع أمازون / Select Amazon Location"}
    </button>
    {open && <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-[#020a15]/85 p-2 sm:p-5" onKeyDown={e=>{if(e.key==="Escape")setOpen(false);}}>
      <section role="dialog" aria-modal="true" aria-label="Amazon warehouse location picker"
        className="flex max-h-[90dvh] w-full max-w-[660px] min-w-0 flex-col overflow-hidden rounded-2xl border border-amber-300/45 bg-[#091a2f] text-white shadow-[0_22px_80px_rgba(0,0,0,.65)]">
        <header className="shrink-0 space-y-3 border-b border-amber-300/20 p-4">
          <div className="flex items-center justify-between gap-2">
            <div><p className="text-xs font-bold tracking-wider text-amber-200">ALHIJRAH CASEFLOW · CAREER GATE</p>
              <h3 className="mt-1 text-lg font-semibold" dir="rtl">اختيار موقع مستودع أمازون</h3></div>
            <button type="button" onClick={()=>setOpen(false)} aria-label="Close location picker" className="rounded-lg border border-white/20 px-3 py-2">×</button>
          </div>
          <input autoFocus aria-label="Search Amazon warehouse by code, city or address" type="search" value={query} onChange={e=>setQuery(e.target.value)}
            placeholder="Search DTW1, DET1, city or address…" className="input w-full min-w-0" />
          <p className="text-xs text-slate-400">{matches.length} locations · Select a site below</p>
        </header>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3">
          {matches.map(site=><div key={site.code}
            className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-3 transition-colors ${chosen===site.code?"border-amber-300 bg-[#173854]":"border-amber-200/15 bg-[#0e253c] hover:border-amber-300/45"}`}>
            <button type="button" onClick={()=>setChosen(site.code)} aria-pressed={chosen===site.code}
              className="min-w-0 flex-1 text-left">
              <span className="flex flex-wrap items-center gap-2"><strong className="text-sm text-white">{site.name}</strong><span className="rounded-md bg-amber-300 px-2 py-0.5 font-mono text-sm font-bold text-slate-950">{site.code}</span></span>
              <span className="mt-1 block text-xs text-slate-200">{site.kind}</span>
              <span className="mt-1 block break-words text-xs text-slate-400">{site.address}</span>
            </button>
            <button type="button" aria-label={`Copy address for ${site.code}`} title="Copy location" onClick={()=>void copy(warehouseLocation(site))}
              className="shrink-0 rounded-lg border border-amber-200/20 px-3 py-2 text-amber-200 hover:border-amber-300">Copy</button>
          </div>)}
          {matches.length===0&&<p className="p-4 text-sm text-slate-300">No matching location found.</p>}
        </div>
        <footer className="sticky bottom-0 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-amber-300/25 bg-[#0d2340] p-3">
          <div className="min-w-0"><p className="text-xs text-slate-400">Selected location</p><p className="truncate text-sm font-semibold text-amber-200">{selected?`${selected.name} · ${selected.code}`:"Select a location"}</p></div>
          <div className="flex flex-wrap gap-2">
            {selected&&<a href={warehouseMapUrl(selected.address)} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-amber-200/40 px-3 py-2 text-xs text-amber-100">Maps</a>}
            <button type="button" disabled={!selected} onClick={()=>{if(selected){onChange(warehouseLocation(selected));setOpen(false);}}}
              className="rounded-xl bg-amber-300 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-40">تأكيد واختيار الموقع</button>
          </div>
        </footer>
      </section>
    </div>}
  </>;
}
