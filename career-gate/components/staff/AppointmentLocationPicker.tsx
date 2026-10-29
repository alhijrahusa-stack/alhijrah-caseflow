"use client";

import { useEffect, useMemo, useState } from "react";

export type AppointmentLocation = {
  id: string;
  code: string;
  display_city: string;
  facility_type: string;
  street_address: string;
  city: string;
  state: string;
  zip_code: string;
};
type LocationResponse =
  | { ok: true; locations: AppointmentLocation[] }
  | { ok: false; error?: { message?: string } };

export function locationDisplay(location: AppointmentLocation): string {
  return `${location.display_city} (${location.code}): ${location.facility_type} - ${location.street_address}, ${location.city}, ${location.state} ${location.zip_code}`;
}

export function locationMapsUrl(location: AppointmentLocation): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${location.street_address}, ${location.city}, ${location.state} ${location.zip_code}`)}`;
}

export function AppointmentLocationPicker({ selectedId, onSelect, onClear }: {
  selectedId: string | null;
  onSelect: (location: AppointmentLocation) => void;
  onClear: () => void;
}) {
  const [items, setItems] = useState<AppointmentLocation[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/staff/appointment-locations", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const data = await response.json() as LocationResponse;
        if (!response.ok || !data.ok) throw new Error(data.ok ? "Location list unavailable" : data.error?.message ?? "Location list unavailable");
        return data.locations;
      })
      .then(locations => { setItems(locations); setError(null); })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load Amazon interview locations");
      });
    return () => controller.abort();
  }, []);
  const results = useMemo(() => items.filter(site => {
    const term = search.toLocaleLowerCase("en-US").trim();
    return !term || [site.code, site.display_city, site.facility_type, site.street_address, site.city, site.zip_code]
      .some(value => value.toLocaleLowerCase("en-US").includes(term));
  }), [items, search]);
  const selected = items.find(site => site.id === selectedId) ?? null;
  const copy = async (site: AppointmentLocation) => {
    try {
      await navigator.clipboard.writeText(locationDisplay(site));
      setCopied(true);
    } catch {
      setError("Unable to copy. Select and copy the displayed address.");
    }
  };

  return <div className="space-y-2" data-testid="appointment-location-picker">
    <button type="button" onClick={() => setOpen(previous => !previous)}
      aria-expanded={open} aria-controls="amazon-interview-location-list"
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-amber-300/35 bg-[#132c43] px-4 py-3 text-left text-sm text-amber-100 transition-colors hover:border-amber-300/70 hover:bg-[#1b3a54]">
      <span className="min-w-0 truncate">{selected ? `${selected.display_city} · ${selected.code}` : "Choose Amazon interview location · اختيار موقع المقابلة"}</span>
      <span aria-hidden="true">{open ? "▴" : "▾"}</span>
    </button>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {open && <div id="amazon-interview-location-list" className="overflow-hidden rounded-2xl border border-amber-200/30 bg-[#0b1d30] shadow-[0_12px_30px_rgba(0,0,0,.25)]">
      <div className="p-3">
        <input type="search" aria-label="Search Amazon locations" value={search}
          onChange={event => setSearch(event.target.value)} placeholder="Search DTW1, city or address…"
          className="input w-full min-w-0" />
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto px-3 pb-3" role="group" aria-label="Amazon interview locations">
        {results.map(site => <div key={site.id}
          className={`flex min-w-0 items-start gap-2 rounded-xl border p-3 ${selectedId === site.id ? "border-amber-300/60 bg-amber-300/10" : "border-white/10 bg-[#142c44]"}`}>
          <button type="button" onClick={() => { onSelect(site); setCopied(false); }}
            className="min-w-0 flex-1 text-left">
            <strong className="block text-sm text-amber-100">{site.code} · {site.display_city}</strong>
            <span className="mt-1 block text-xs text-slate-200">{site.facility_type}</span>
            <span className="mt-1 block break-words text-xs text-slate-400">{site.street_address}, {site.city}, {site.state} {site.zip_code}</span>
          </button>
          <button type="button" aria-label={`Copy address ${site.code}`} onClick={() => void copy(site)}
            className="shrink-0 rounded-lg border border-amber-200/25 px-3 py-2 text-xs text-amber-100">Copy</button>
        </div>)}
        {!results.length && <p className="text-sm text-slate-400">No matching locations.</p>}
      </div>
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-amber-200/20 bg-[#10273b] p-3">
        <p className="min-w-0 flex-1 text-xs text-slate-200">{selected ? `${selected.code} · ${selected.street_address}` : "Select a location to attach it to this appointment."}</p>
        <button type="button" onClick={() => { onClear(); setOpen(false); }} className="rounded-lg border border-white/20 px-3 py-2 text-xs text-slate-300">Manual / Office</button>
        <button type="button" disabled={!selected} onClick={() => setOpen(false)}
          className="rounded-lg border border-amber-200/40 bg-amber-300/15 px-3 py-2 text-xs font-semibold text-amber-100 disabled:opacity-40">
          Confirm location
        </button>
        {copied && <span role="status" className="w-full text-xs text-emerald-300">Address copied</span>}
      </div>
    </div>}
    {selected && <a href={locationMapsUrl(selected)} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-200 underline underline-offset-2">View interview location on Google Maps</a>}
  </div>;
}
