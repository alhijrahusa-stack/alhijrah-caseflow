import { findJob } from "@/lib/catalog";
import { money } from "@/lib/format";
import type { StepProps } from "./types";

export function PayStep({ data, update }: StepProps) {
  const job = findJob(data.city, data.site_code, data.job_code);
  const dollars = data.pay_expectation_cents == null ? "" : String(data.pay_expectation_cents / 100);
  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-slate-100 px-4 py-3 text-sm">
        <span className="text-slate-500">Posted pay for {job?.title ?? "this job"}: </span>
        <span className="font-medium">
          {job?.payCentsPerHour != null ? `${money(job.payCentsPerHour)}/hr` : "to be confirmed"}
        </span>
      </div>
      <div>
        <label className="label" htmlFor="pay">
          Minimum hourly pay you would accept (optional)
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-2 text-sm text-slate-500">$</span>
          <input
            id="pay"
            className="input pl-7"
            inputMode="decimal"
            placeholder="0.00"
            value={dollars}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (v === "") return update({ pay_expectation_cents: null });
              const n = Number(v);
              if (Number.isFinite(n) && n >= 0 && n <= 1000) {
                update({ pay_expectation_cents: Math.round(n * 100) });
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
