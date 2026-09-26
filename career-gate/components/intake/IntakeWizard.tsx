"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { BackupShiftStep } from "./BackupShiftStep";
import { CityStep } from "./CityStep";
import { JobStep } from "./JobStep";
import { PayStep } from "./PayStep";
import { PersonalStep } from "./PersonalStep";
import { PrimaryShiftStep } from "./PrimaryShiftStep";
import { SiteStep } from "./SiteStep";
import { emptyIntake, type IntakeData, type StepProps } from "./types";

const STEPS: { title: string; Component: (p: StepProps) => React.ReactNode; ready: (d: IntakeData) => boolean }[] = [
  { title: "Choose a city", Component: CityStep, ready: (d) => !!d.city },
  { title: "Choose a site", Component: SiteStep, ready: (d) => !!d.site_code },
  { title: "Choose a job", Component: JobStep, ready: (d) => !!d.job_code },
  { title: "Preferred shift", Component: PrimaryShiftStep, ready: (d) => !!d.primary_shift },
  { title: "Backup shift", Component: BackupShiftStep, ready: () => true },
  { title: "Pay", Component: PayStep, ready: () => true },
  {
    title: "Your details",
    Component: PersonalStep,
    ready: (d) => !!d.first_name.trim() && !!d.last_name.trim() && d.phone.replace(/\D/g, "").length >= 10,
  },
];

export function IntakeWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<IntakeData>(emptyIntake);
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { title, Component, ready } = STEPS[step];
  const last = step === STEPS.length - 1;
  const update = (patch: Partial<IntakeData>) => setData((d) => ({ ...d, ...patch }));

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, email: data.email || null, website }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Submission failed");
      router.push(`/status/${body.ref}?new=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
      setSubmitting(false);
    }
  }

  return (
    <Card
      title={
        <span>
          <span className="mr-2 text-slate-400">
            {step + 1}/{STEPS.length}
          </span>
          {title}
        </span>
      }
    >
      <div className="mb-4 h-1 w-full overflow-hidden rounded bg-slate-100">
        <div className="h-full bg-brand-600 transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>

      <Component data={data} update={update} />

      {/* Honeypot, hidden from people and assistive tech. */}
      <input
        tabIndex={-1}
        aria-hidden="true"
        autoComplete="off"
        className="hidden"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
      />

      {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 flex justify-between">
        <Button variant="ghost" disabled={step === 0 || submitting} onClick={() => setStep((s) => s - 1)}>
          Back
        </Button>
        {last ? (
          <Button disabled={!ready(data) || submitting} onClick={submit}>
            {submitting ? "Submitting…" : "Submit application"}
          </Button>
        ) : (
          <Button disabled={!ready(data)} onClick={() => setStep((s) => s + 1)}>
            Next
          </Button>
        )}
      </div>
    </Card>
  );
}
