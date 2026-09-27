"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fromBool, ProfileFields, profilePayload, type ProfileForm } from "@/components/forms/ProfileFields";
import { useAction } from "@/components/forms/useAction";
import { Preferences } from "@/components/staff/sections/Profile";
import { useStaff } from "@/components/staff/StaffContext";
import { Button } from "@/components/ui/Button";

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function toForm(c: R, employment: R[]): ProfileForm {
  const s = (v: unknown) => (v == null ? "" : String(v));
  return {
    full_name: s(c.full_name), phone: s(c.phone), email: s(c.email), date_of_birth: s(c.date_of_birth),
    preferred_language: c.preferred_language, street: s(c.street), city: s(c.city), state: s(c.state), zip: s(c.zip),
    appointment_availability: s(c.appointment_availability),
    amazon_worked_before: fromBool(c.amazon_worked_before), amazon_worked_from: s(c.amazon_worked_from), amazon_worked_to: s(c.amazon_worked_to),
    amazon_applied_before: fromBool(c.amazon_applied_before), amazon_application_email: s(c.amazon_application_email),
    currently_amazon: fromBool(c.currently_amazon), via_agency: fromBool(c.via_agency),
    employment_history: employment.map((e) => ({
      company: s(e.company), self_employed: e.employment_kind === "self_employed", job_title: e.job_title,
      from_date: s(e.from_date), to_date: s(e.to_date),
    })),
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <h2 className="border-b border-slate-100 px-5 py-3 text-sm font-semibold">{title}</h2>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function EditClientForm({ client, employment, preferences }: { client: R; employment: R[]; preferences: R[] }) {
  const router = useRouter();
  const { run, pending, error } = useAction({ successMessage: null });
  const { activeStaff, isManager } = useStaff();
  const [profile, setProfile] = useState<ProfileForm>(() => toForm(client, employment));
  const [nextStep, setNextStep] = useState<string>(client.next_step);
  const [assigned, setAssigned] = useState<string>(client.assigned_staff ?? "");

  async function save() {
    const base = { client_id: client.id };
    if (!(await run({ ...base, action: "update_client", profile: profilePayload(profile) }))) return;
    if (nextStep.trim() !== client.next_step && !(await run({ ...base, action: "set_next_step", next_step: nextStep }))) return;
    if (isManager && assigned !== (client.assigned_staff ?? "") && !(await run({ ...base, action: "assign_staff", staff_id: assigned || null }))) return;
    router.push(`/staff/client/${client.id}`);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        <Section title="Personal information"><ProfileFields section="personal" value={profile} onChange={setProfile} /></Section>
        <Section title="Amazon history"><ProfileFields section="amazon" value={profile} onChange={setProfile} /></Section>
      </div>
      <div className="space-y-6">
        <Section title="Employment history"><ProfileFields section="employment" value={profile} onChange={setProfile} /></Section>
        <Section title="Appointment availability"><ProfileFields section="availability" value={profile} onChange={setProfile} /></Section>
        <Preferences clientId={client.id} prefs={preferences} />
        <Section title="Next step & assignment">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="ec_next">Next step</label>
              <input id="ec_next" className="input" value={nextStep} onChange={(e) => setNextStep(e.target.value)} />
            </div>
            {isManager && (
              <div>
                <label className="label" htmlFor="ec_assigned">Handled by</label>
                <select id="ec_assigned" className="input" value={assigned} onChange={(e) => setAssigned(e.target.value)}>
                  <option value="">Unassigned</option>
                  {activeStaff.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
                </select>
              </div>
            )}
          </div>
        </Section>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
          <Link href={`/staff/client/${client.id}`} className="rounded-md px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancel</Link>
        </div>
      </div>
    </div>
  );
}
