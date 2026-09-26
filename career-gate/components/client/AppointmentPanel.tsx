"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { dateTime } from "@/lib/format";
import type { AppointmentRow } from "@/lib/types";
import { useApi } from "./useApi";

const KINDS = ["orientation", "document_check", "hiring_event", "follow_up"] as const;

export function AppointmentPanel({ clientId, appointments }: { clientId: string; appointments: AppointmentRow[] }) {
  const { call, pending, error } = useApi();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const f = new FormData(formEl);
    const local = String(f.get("starts_at"));
    const ok = await call("/api/appointments", "POST", {
      clientId,
      kind: f.get("kind"),
      // datetime-local has no zone; the browser's zone is the one staff typed in.
      startsAt: new Date(local).toISOString(),
      durationMinutes: Number(f.get("duration")),
      location: String(f.get("location") || "") || undefined,
      notes: String(f.get("notes") || "") || undefined,
    });
    if (ok) formEl.reset();
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Appointments">
        {appointments.length ? (
          <ul className="divide-y divide-slate-100 text-sm">
            {appointments.map((a) => (
              <li key={a.id} className="py-2">
                <div className="flex justify-between">
                  <span className="font-medium capitalize">{a.kind.replace("_", " ")}</span>
                  <span className="text-slate-500">{a.status.replace("_", " ")}</span>
                </div>
                <p className="text-slate-500">{dateTime(a.starts_at)}{a.location ? ` · ${a.location}` : ""}</p>
                {a.status === "scheduled" && (
                  <div className="mt-2 flex gap-2">
                    {(["completed", "no_show", "cancelled"] as const).map((s) => (
                      <Button key={s} variant="secondary" className="px-2 py-1 text-xs" disabled={pending}
                        onClick={() => call("/api/appointments", "PATCH", { id: a.id, status: s })}>
                        {s.replace("_", " ")}
                      </Button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No appointments.</p>
        )}
      </Card>

      <Card title="Schedule">
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="label" htmlFor="kind">Type</label>
            <select id="kind" name="kind" className="input" required>
              {KINDS.map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="starts_at">Start</label>
              <input id="starts_at" name="starts_at" type="datetime-local" className="input" required />
            </div>
            <div>
              <label className="label" htmlFor="duration">Minutes</label>
              <input id="duration" name="duration" type="number" min={5} max={480} defaultValue={30} className="input" required />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="location">Location</label>
            <input id="location" name="location" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" rows={2} className="input" />
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={pending}>Add appointment</Button>
        </form>
      </Card>
    </div>
  );
}
