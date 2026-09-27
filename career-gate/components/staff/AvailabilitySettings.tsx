"use client";

import { useState } from "react";
import { useAction } from "@/components/forms/useAction";
import { useStaff } from "@/components/staff/StaffContext";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { dateTime, fromLocalInput } from "@/lib/format";

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function AvailabilitySettings({ windows, blocked }: { windows: R[]; blocked: R[] }) {
  const { activeStaff, staff } = useStaff();
  const a = useAction({ successMessage: "Availability saved" });
  const [w, setW] = useState({ resource_key: "office", weekday: 1, start_time: "09:00", end_time: "17:00", slot_minutes: 30, appointment_type: "" });
  const [b, setB] = useState({ resource_key: "office", starts_at: "", ends_at: "", reason: "" });
  const resourceName = (k: string) => (k === "office" ? "Office" : staff.find((s) => `staff:${s.id}` === k)?.display_name ?? k);
  const resources = [{ value: "office", label: "Office" }, ...activeStaff.map((s) => ({ value: `staff:${s.id}`, label: s.display_name }))];
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Working hours (America/Detroit)</h2>
        {windows.length === 0 ? <EmptyState title="No working hours set" text="Add at least one window so the scheduling engine can offer slots." /> : (
          <table className="table">
            <thead><tr><th>Resource</th><th>Day</th><th>Hours</th><th>Slot</th><th>Type</th><th /></tr></thead>
            <tbody>
              {windows.map((x) => (
                <tr key={x.id} data-testid="availability-row">
                  <td>{resourceName(x.resource_key)}</td><td>{DAYS[x.weekday]}</td><td>{String(x.start_time).slice(0, 5)}–{String(x.end_time).slice(0, 5)}</td>
                  <td>{x.slot_minutes} min</td><td>{x.appointment_type ?? "Any"}</td>
                  <td><button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-xs" onClick={() => a.run({ action: "delete_availability", id: x.id })}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form className="grid gap-2 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); a.run({ action: "upsert_availability", ...w, appointment_type: w.appointment_type || null }); }}>
          <select aria-label="Resource" className="input" value={w.resource_key} onChange={(e) => setW({ ...w, resource_key: e.target.value })}>{resources.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
          <select aria-label="Weekday" className="input" value={w.weekday} onChange={(e) => setW({ ...w, weekday: Number(e.target.value) })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          <input aria-label="Slot minutes" type="number" min={5} max={480} className="input" value={w.slot_minutes} onChange={(e) => setW({ ...w, slot_minutes: Number(e.target.value) })} />
          <input aria-label="Start time" type="time" className="input" value={w.start_time} onChange={(e) => setW({ ...w, start_time: e.target.value })} />
          <input aria-label="End time" type="time" className="input" value={w.end_time} onChange={(e) => setW({ ...w, end_time: e.target.value })} />
          <input aria-label="Appointment type (optional)" className="input" placeholder="Any type" value={w.appointment_type} onChange={(e) => setW({ ...w, appointment_type: e.target.value })} />
          <Button type="submit" disabled={a.pending} className="sm:col-span-3">Add working hours</Button>
        </form>
      </section>
      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Blocked time</h2>
        {blocked.length === 0 ? <EmptyState title="No blocked time" text="Block holidays or closures so no slots are offered." /> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {blocked.map((x) => (
              <li key={x.id} className="flex items-center justify-between py-2">
                <span>{resourceName(x.resource_key)} · {dateTime(x.starts_at)} – {dateTime(x.ends_at)} · {x.reason}</span>
                <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-xs" onClick={() => a.run({ action: "remove_blocked_period", id: x.id })}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => {
          e.preventDefault();
          a.run({ action: "add_blocked_period", resource_key: b.resource_key, reason: b.reason, starts_at: fromLocalInput(b.starts_at).toISOString(), ends_at: fromLocalInput(b.ends_at).toISOString() });
        }}>
          <select aria-label="Blocked resource" className="input" value={b.resource_key} onChange={(e) => setB({ ...b, resource_key: e.target.value })}>{resources.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
          <input aria-label="Reason" required className="input" placeholder="Reason" value={b.reason} onChange={(e) => setB({ ...b, reason: e.target.value })} />
          <input aria-label="Blocked from" type="datetime-local" required className="input" value={b.starts_at} onChange={(e) => setB({ ...b, starts_at: e.target.value })} />
          <input aria-label="Blocked until" type="datetime-local" required className="input" value={b.ends_at} onChange={(e) => setB({ ...b, ends_at: e.target.value })} />
          <Button type="submit" disabled={a.pending} className="sm:col-span-2">Block time</Button>
        </form>
      </section>
      {a.error && <p role="alert" className="text-sm text-red-600">{a.error}</p>}
    </div>
  );
}
