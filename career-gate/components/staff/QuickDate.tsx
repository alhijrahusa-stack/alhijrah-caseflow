"use client";

import { useMemo } from "react";
import { dateOnly, dateTime, fromLocalInput, toLocalInput, todayInOffice } from "@/lib/format";

function addDays(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function nextMonday(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const delta = ((8 - day) % 7) || 7;
  return addDays(date, delta);
}

function nextBusinessDay(date: string) {
  let candidate = addDays(date, 1);
  for (;;) {
    const [y, m, d] = candidate.split("-").map(Number);
    const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (day !== 0 && day !== 6) return candidate;
    candidate = addDays(candidate, 1);
  }
}

const chip = "rounded-lg border border-white/[.09] bg-white/[.035] px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-cyan-300/30 hover:bg-cyan-300/[.06] hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50";

export function QuickDate({
  value,
  onChange,
  disabled = false,
  required = false,
  ariaLabel = "Date",
  min,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
  min?: string;
}) {
  const today = todayInOffice();
  const presets = useMemo(() => [
    ["Today", today],
    ["Tomorrow", addDays(today, 1)],
    ["+3 Days", addDays(today, 3)],
    ["+7 Days", addDays(today, 7)],
    ["Next Business Day", nextBusinessDay(today)],
    ["Next Monday", nextMonday(today)],
  ] as const, [today]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" aria-label={`${ariaLabel} quick choices`}>
        {presets.map(([label, date]) => (
          <button key={label} type="button" disabled={disabled || Boolean(min && date < min)} className={chip}
            onClick={() => onChange(date)}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label={ariaLabel} type="date" className="ops-input" value={value} min={min}
          required={required} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        {value && <span className="text-xs text-slate-500">Selected: <strong className="font-medium text-slate-300">{dateOnly(value)}</strong></span>}
      </div>
    </div>
  );
}

function atTime(date: string, hours: number, minutes = 0) {
  return `${date}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function QuickDateTime({
  value,
  onChange,
  disabled = false,
  required = false,
  ariaLabel = "Date and time",
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
}) {
  const today = todayInOffice();
  const tomorrow = addDays(today, 1);
  const plus30 = toLocalInput(new Date(Date.now() + 30 * 60 * 1000)).slice(0, 16);
  const presets = [
    ["Now +30m", plus30],
    ["Today 3 PM", atTime(today, 15)],
    ["Tomorrow 9 AM", atTime(tomorrow, 9)],
    ["Tomorrow 1 PM", atTime(tomorrow, 13)],
  ] as const;

  let preview = "";
  if (value) {
    try { preview = dateTime(fromLocalInput(value)); } catch { preview = ""; }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" aria-label={`${ariaLabel} quick choices`}>
        {presets.map(([label, local]) => (
          <button key={label} type="button" disabled={disabled} className={chip} onClick={() => onChange(local)}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label={ariaLabel} type="datetime-local" className="ops-input" value={value}
          required={required} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        {preview && <span className="text-xs text-slate-500">Selected: <strong className="font-medium text-slate-300">{preview}</strong></span>}
      </div>
    </div>
  );
}
