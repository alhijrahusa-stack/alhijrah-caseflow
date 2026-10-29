"use client";

import { useMemo, useState } from "react";
import {
  AMAZON_APPOINTMENT_SITES, amazonAppointmentMapsUrl, findAmazonAppointmentSite,
  type AmazonAppointmentSiteCode,
} from "@/lib/amazon-appointment-sites";

type Props = {
  value: AmazonAppointmentSiteCode | null;
  onChange: (value: AmazonAppointmentSiteCode) => void;
  disabled?: boolean;
};

export function AmazonAppointmentLocationPicker({ value, onChange, disabled = false }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<AmazonAppointmentSiteCode | null>(value);
  const selected = findAmazonAppointmentSite(chosen);
  const current = findAmazonAppointmentSite(value);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return AMAZON_APPOINTMENT_SITES.filter(site =>
      !term || [site.code,site.city,site.name,site.address].some(part => part.toLowerCase().includes(term))
    );
  }, [search]);

  return (
    <div className="min-w-0 space-y-2" data-testid="amazon-appointment-location-picker">
      <label className="label">Amazon interview branch · موقع مقابلة أمازون</label>
      <button type="button" aria-expanded={expanded} aria-controls="amazon-appointment-site-options"
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-amber-200/40 bg-[#102a44] px-3 py-2 text-left text-sm text-white shadow-[inset_0_1px_rgba(255,255,255,.1)] hover:border-amber-300"
        onClick={() => { setChosen(value); setExpanded(open => !open); }} disabled={disabled}>
        <span className="min-w-0 break-words">{current ? `${current.code} · ${current.city} — ${current.address}` : "Choose Amazon interview location"}</span>
        <span aria-hidden="true" className="shrink-0 text-amber-200">{expanded ? "▴" : "▾"}</span>
      </button>
      {expanded && (
        <div id="amazon-appointment-site-options" className="overflow-hidden rounded-2xl border border-amber-200/35 bg-[#071b30] shadow-xl">
          <div className="border-b border-amber-200/15 p-3">
            <input aria-label="Search Amazon location by code, city, or address" autoFocus className="input w-full"
              placeholder="Search DTW1, Detroit, address…" value={search} onChange={event => setSearch(event.target.value)} />
          </div>
          <div className="grid max-h-72 gap-2 overflow-y-auto overscroll-contain p-3 sm:grid-cols-2" role="listbox" aria-label="Amazon warehouse interview locations">
            {filtered.map(site => (
              <div key={site.code} role="option" aria-selected={chosen === site.code}
                className={`min-w-0 rounded-xl border p-3 ${chosen === site.code ? "border-amber-200 bg-amber-200/15" : "border-white/15 bg-[#102a44]"}`}>
                <button type="button" disabled={disabled} onClick={() => setChosen(site.code)} className="w-full text-left">
                  <strong className="text-sm font-bold text-amber-200">{site.code} · {site.city}</strong>
                  <span className="mt-1 block text-xs font-semibold text-white">{site.name}</span>
                  <span className="mt-1 block break-words text-xs leading-5 text-slate-300">{site.address}</span>
                </button>
                <button type="button" className="mt-2 text-xs font-semibold text-cyan-200 hover:underline"
                  onClick={() => void navigator.clipboard.writeText(site.address)}
                  aria-label={`Copy address of ${site.code}`}>Copy address</button>
              </div>
            ))}
            {filtered.length === 0 && <p className="text-sm text-slate-300">No matching location.</p>}
          </div>
          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-amber-200/20 bg-[#081b30] p-3">
            <span className="min-w-0 flex-1 text-xs text-slate-200">
              {selected ? `${selected.code} · ${selected.city}` : "Select one location"}
            </span>
            {selected && <a href={amazonAppointmentMapsUrl(selected.address)} target="_blank" rel="noopener noreferrer"
              className="text-xs text-cyan-200 underline">Google Maps</a>}
            <button type="button" disabled={!chosen || disabled} onClick={() => { if (chosen) { onChange(chosen); setExpanded(false); } }}
              className="min-h-10 rounded-xl border border-amber-200/60 bg-amber-200/20 px-3 text-xs font-bold text-amber-100 disabled:opacity-40">
              Confirm location · تأكيد الموقع
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
