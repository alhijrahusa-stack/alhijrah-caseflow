"use client";

import { useEffect, useMemo, useState } from "react";
import { AMAZON_INTERVIEW_SITES, warehouseLocation, warehouseMapUrl, type WarehouseSite } from "@/lib/amazon-interview-sites";

type Props = { value: string; onChange: (value: string) => void; label?: string };

export function AmazonInterviewSitePicker({ value, onChange, label = "Location" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<WarehouseSite | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return AMAZON_INTERVIEW_SITES.filter(site =>
      !q || [site.name,site.kind,site.address,site.code].some(part => part.toLocaleLowerCase().includes(q)));
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const prior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prior; };
  }, [open]);

  const copy = async (site: WarehouseSite) => {
    try { await navigator.clipboard.writeText(warehouseLocation(site)); setCopied(site.code); }
    catch { setCopied("unavailable"); }
  };
  const choose = (site: WarehouseSite) => {
    setSelection(site);
    onChange(warehouseLocation(site));
    setOpen(false);
  };

  return <>
    <div className="space-y-2">
      <label className="label" htmlFor="appointment-location">{label}</label>
      <div className="flex min-w-0 flex-wrap gap-2">
        <input id="appointment-location" aria-label={label} value={value} onChange={event => onChange(event.target.value)}
          maxLength={300} placeholder="Office or Amazon interview location" className="input min-w-0 flex-[2]" />
        <button type="button" aria-haspopup="dialog" aria-label="Choose Amazon warehouse" onClick={() => { setSelection(null); setQuery(""); setOpen(true); }}
          className="min-h-11 flex-1 rounded-xl border border-amber-300/50 bg-gradient-to-br from-[#244667] to-[#101e33] px-3 py-2 text-sm font-semibold text-amber-100 transition-colors hover:border-amber-200">
          اختيار موقع أمازون
        </button>
      </div>
      {value.trim() && <a href={warehouseMapUrl(value)} target="_blank" rel="noopener noreferrer" className="inline-flex text-xs text-amber-200 underline-offset-4 hover:underline">Open location in Google Maps ↗</a>}
    </div>
    {open && <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-[#020915]/85 px-3 py-5 backdrop-blur-md" onMouseDown={event => { if(event.target === event.currentTarget)setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="amazon-sites-title"
        className="flex max-h-[min(88dvh,850px)] w-full max-w-[650px] flex-col overflow-hidden rounded-[22px] border border-amber-300/45 bg-gradient-to-br from-[#112a48] via-[#0b1b31] to-[#040c19] shadow-[0_35px_100px_rgba(0,0,0,.65)]">
        <header className="flex items-start justify-between gap-3 border-b border-amber-300/20 px-4 py-4 sm:px-5">
          <div><h2 id="amazon-sites-title" className="text-base font-bold text-amber-100">اختيار موقع مستودع أمازون</h2><p className="mt-1 text-xs text-slate-300">Search by site code, city or address · Michigan</p></div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close warehouse picker" className="h-10 w-10 shrink-0 rounded-xl border border-white/20 text-xl text-white">×</button>
        </header>
        <div className="px-4 pt-3 sm:px-5">
          <label className="sr-only" htmlFor="warehouse-site-search">Search sites</label>
          <input id="warehouse-site-search" autoFocus className="input w-full" placeholder="ابحث بالرمز (DTW1, DET1)، المدينة، أو العنوان"
            value={query} onChange={event => setQuery(event.target.value)} />
          <p role="status" className="py-2 text-xs text-slate-400">{filtered.length} available sites</p>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 pb-3 sm:px-5">
          {filtered.map(site => <article key={site.code} className={`flex min-w-0 items-center gap-2 rounded-xl border bg-[#102740]/90 px-2.5 py-3 transition-colors ${selection?.code === site.code ? "border-amber-300" : "border-amber-300/25 hover:border-amber-300/55"}`}>
            <button type="button" onClick={() => setSelection(site)} aria-label={`Select ${site.code} ${site.name}`} aria-pressed={selection?.code===site.code}
              className="min-w-0 flex-1 text-left">
              <span className="flex flex-wrap items-center gap-2"><strong className="rounded-lg bg-amber-400 px-2 py-1 text-xs font-bold text-[#101725]">{site.code}</strong><span className="font-semibold text-white">{site.name}</span></span>
              <span className="mt-1 block text-xs text-slate-200">{site.kind}</span>
              <span className="mt-1 block break-words text-xs text-slate-400">{site.address}</span>
            </button>
            <button type="button" onClick={() => {void copy(site);}} aria-label={`Copy ${site.code} address`} title="Copy location" className="h-10 w-10 shrink-0 rounded-lg border border-amber-300/30 text-amber-100 hover:bg-amber-300/10">⧉</button>
          </article>)}
          {!filtered.length && <p className="rounded-xl border border-white/15 px-4 py-5 text-sm text-slate-300">No warehouse matches the search.</p>}
        </div>
        <footer className="sticky bottom-0 border-t border-amber-300/25 bg-[#081729] px-4 py-3 sm:px-5">
          <p className="mb-2 min-h-5 truncate text-xs text-amber-100" role="status">{selection ? `${selection.code} · ${selection.address}` : copied ? copied==="unavailable"?"Unable to copy":`Copied ${copied}` : "Select an Amazon warehouse to confirm"}</p>
          <button type="button" disabled={!selection} onClick={() => {if(selection) choose(selection);}} className="min-h-11 w-full rounded-xl bg-gradient-to-r from-amber-400 to-yellow-600 px-3 text-sm font-bold text-[#081527] transition hover:brightness-110 disabled:opacity-40">تأكيد واختيار الموقع</button>
        </footer>
      </section>
    </div>}
  </>;
}
