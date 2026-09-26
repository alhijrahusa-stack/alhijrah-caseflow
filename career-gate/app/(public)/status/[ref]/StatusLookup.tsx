"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { dateTime } from "@/lib/format";
import { lookupStatus, type StatusState } from "./actions";

export function StatusLookup({ refCode }: { refCode: string }) {
  const [state, action, pending] = useActionState<StatusState, FormData>(lookupStatus, { status: "idle" });

  if (state.status === "found") {
    return (
      <dl className="grid grid-cols-3 gap-y-3 text-sm">
        <dt className="text-slate-500">Status</dt>
        <dd className="col-span-2 font-semibold">{state.stage}</dd>
        <dt className="text-slate-500">Job</dt>
        <dd className="col-span-2">{state.job}</dd>
        <dt className="text-slate-500">Site</dt>
        <dd className="col-span-2">{state.site}</dd>
        <dt className="text-slate-500">Shift</dt>
        <dd className="col-span-2">{state.shift}</dd>
        <dt className="text-slate-500">Next appointment</dt>
        <dd className="col-span-2">{state.nextAppointment ? dateTime(state.nextAppointment) : "None scheduled"}</dd>
      </dl>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="ref" value={refCode} />
      <div>
        <label className="label" htmlFor="last4">Last 4 digits of your phone number</label>
        <input id="last4" name="last4" className="input" inputMode="numeric" maxLength={4}
          pattern="\d{4}" required autoComplete="off" />
      </div>
      {state.status === "error" && <p role="alert" className="text-sm text-red-600">{state.message}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Checking…" : "Check status"}</Button>
    </form>
  );
}
