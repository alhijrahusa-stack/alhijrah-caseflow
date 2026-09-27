"use client";

import { LANGUAGES } from "@/lib/domain";
import { AMAZON_HISTORY, isVisible } from "@/lib/intake-schema";

export type YesNo = "" | "yes" | "no";

export type Employment = { company: string; job_title: string; from_date: string; to_date: string; self_employed: boolean };

export type ProfileForm = {
  full_name: string;
  phone: string;
  email: string;
  date_of_birth: string;
  preferred_language: keyof typeof LANGUAGES;
  street: string;
  city: string;
  state: string;
  zip: string;
  appointment_availability: string;
  amazon_worked_before: YesNo;
  amazon_worked_from: string;
  amazon_worked_to: string;
  amazon_applied_before: YesNo;
  amazon_application_email: string;
  currently_amazon: YesNo;
  via_agency: YesNo;
  employment_history: Employment[];
};

export const emptyProfile: ProfileForm = {
  full_name: "",
  phone: "",
  email: "",
  date_of_birth: "",
  preferred_language: "en",
  street: "",
  city: "",
  state: "MI",
  zip: "",
  appointment_availability: "",
  amazon_worked_before: "",
  amazon_worked_from: "",
  amazon_worked_to: "",
  amazon_applied_before: "",
  amazon_application_email: "",
  currently_amazon: "",
  via_agency: "",
  employment_history: [],
};

const yn = (v: YesNo) => (v === "yes" ? true : v === "no" ? false : null);
export const fromBool = (v: boolean | null | undefined): YesNo => (v === true ? "yes" : v === false ? "no" : "");

/** Shape accepted by ProfileSchema on the server. */
export function profilePayload(p: ProfileForm) {
  return {
    ...p,
    amazon_worked_before: yn(p.amazon_worked_before),
    amazon_applied_before: yn(p.amazon_applied_before),
    currently_amazon: yn(p.currently_amazon),
    via_agency: yn(p.via_agency),
    employment_history: p.employment_history.map(({ self_employed, ...e }) => ({
      ...e,
      employment_kind: self_employed ? ("self_employed" as const) : ("company" as const),
      company: self_employed ? null : e.company,
    })),
  };
}

type Props = { value: ProfileForm; onChange: (v: ProfileForm) => void; section?: "personal" | "amazon" | "employment" | "availability" | "all" };

function Field({ id, label, children, className = "" }: { id: string; label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

function YesNoField({ id, label, value, onChange }: { id: string; label: string; value: YesNo; onChange: (v: YesNo) => void }) {
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="flex gap-2">
        {(["yes", "no"] as const).map((v) => (
          <label key={v} className={`flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors duration-200 ${value === v ? "border-brand-600 bg-brand-50" : "border-slate-300 bg-white"}`}>
            <input type="radio" name={id} value={v} checked={value === v} onChange={() => onChange(v)} className="text-brand-600" />
            {v === "yes" ? "Yes" : "No"}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ProfileFields({ value: v, onChange, section = "all" }: Props) {
  const set = (patch: Partial<ProfileForm>) => onChange({ ...v, ...patch });
  const show = (s: Props["section"]) => section === "all" || section === s;
  const setJob = (i: number, patch: Partial<Employment>) =>
    set({ employment_history: v.employment_history.map((e, j) => (j === i ? { ...e, ...patch } : e)) });

  return (
    <div className="space-y-8">
      {show("personal") && (
        <section className="space-y-4">
          {section === "all" && <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Personal information</h3>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="full_name" label="Full name" className="sm:col-span-2">
              <input id="full_name" className="input" autoComplete="name" required value={v.full_name} onChange={(e) => set({ full_name: e.target.value })} />
            </Field>
            <Field id="phone" label="Phone">
              <input id="phone" className="input" type="tel" autoComplete="tel" required value={v.phone} onChange={(e) => set({ phone: e.target.value })} />
            </Field>
            <Field id="email" label="Email">
              <input id="email" className="input" type="email" autoComplete="email" value={v.email} onChange={(e) => set({ email: e.target.value })} />
            </Field>
            <Field id="date_of_birth" label="Date of birth">
              <input id="date_of_birth" className="input" type="date" value={v.date_of_birth} onChange={(e) => set({ date_of_birth: e.target.value })} />
            </Field>
            <Field id="preferred_language" label="Preferred language">
              <select id="preferred_language" className="input" value={v.preferred_language} onChange={(e) => set({ preferred_language: e.target.value as ProfileForm["preferred_language"] })}>
                {Object.entries(LANGUAGES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field id="street" label="Street address" className="sm:col-span-2">
              <input id="street" className="input" autoComplete="street-address" value={v.street} onChange={(e) => set({ street: e.target.value })} />
            </Field>
            <Field id="addr_city" label="City">
              <input id="addr_city" className="input" autoComplete="address-level2" value={v.city} onChange={(e) => set({ city: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field id="addr_state" label="State">
                <input id="addr_state" className="input" autoComplete="address-level1" value={v.state} onChange={(e) => set({ state: e.target.value })} />
              </Field>
              <Field id="zip" label="ZIP">
                <input id="zip" className="input" inputMode="numeric" autoComplete="postal-code" value={v.zip} onChange={(e) => set({ zip: e.target.value })} />
              </Field>
            </div>

          </div>
        </section>
      )}

      {show("availability") && (
        <section className="space-y-4">
          {section === "all" && <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Appointment availability</h3>}
            <Field id="appointment_availability" label="When are you available for appointments?" >
              <textarea id="appointment_availability" rows={2} className="input" placeholder="Days and times" value={v.appointment_availability} onChange={(e) => set({ appointment_availability: e.target.value })} />
            </Field>
        </section>
      )}

      {show("amazon") && (
        <section className="space-y-4">
          {section === "all" && <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Amazon history</h3>}
          {AMAZON_HISTORY.filter((f) => isVisible(f, v as unknown as Record<string, string>)).map((f) =>
            f.type === "yes_no" ? (
              <YesNoField key={f.field_id} id={f.field_id} label={f.label} value={v[f.field_id as keyof ProfileForm] as YesNo}
                onChange={(x) => {
                  // Clear dependent answers when their condition no longer holds.
                  const patch: Partial<ProfileForm> = { [f.field_id]: x } as Partial<ProfileForm>;
                  for (const dep of AMAZON_HISTORY.filter((d) => d.visible_if?.field_id === f.field_id)) {
                    if (x !== dep.visible_if!.equals) (patch as Record<string, string>)[dep.field_id] = "";
                  }
                  set(patch);
                }} />
            ) : (
              <Field key={f.field_id} id={f.field_id} label={f.label}>
                <input id={f.field_id} type={f.type} className="input" value={v[f.field_id as keyof ProfileForm] as string}
                  onChange={(e) => set({ [f.field_id]: e.target.value } as Partial<ProfileForm>)} />
              </Field>
            ),
          )}
        </section>
      )}

      {show("employment") && (
        <section className="space-y-4">
          {section === "all" && <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Employment history</h3>}
          <p className="text-sm text-slate-600">Most recent paid work in the last five years, if any.</p>
          {v.employment_history.map((e, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={e.self_employed} onChange={(x) => setJob(i, { self_employed: x.target.checked })} />
                Self-employed
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                {!e.self_employed && (
                  <Field id={`emp_company_${i}`} label="Company">
                    <input id={`emp_company_${i}`} className="input" value={e.company} onChange={(x) => setJob(i, { company: x.target.value })} />
                  </Field>
                )}
                <Field id={`emp_title_${i}`} label="Job title / type">
                  <input id={`emp_title_${i}`} className="input" value={e.job_title} onChange={(x) => setJob(i, { job_title: x.target.value })} />
                </Field>
                <Field id={`emp_from_${i}`} label="From">
                  <input id={`emp_from_${i}`} type="date" className="input" value={e.from_date} onChange={(x) => setJob(i, { from_date: x.target.value })} />
                </Field>
                <Field id={`emp_to_${i}`} label="To (blank if current)">
                  <input id={`emp_to_${i}`} type="date" className="input" value={e.to_date} onChange={(x) => setJob(i, { to_date: x.target.value })} />
                </Field>
              </div>
              <button type="button" className="text-sm text-red-600 hover:underline"
                onClick={() => set({ employment_history: v.employment_history.filter((_, j) => j !== i) })}>
                Remove
              </button>
            </div>
          ))}
          {v.employment_history.length < 10 && (
            <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
              onClick={() => set({ employment_history: [...v.employment_history, { company: "", job_title: "", from_date: "", to_date: "", self_employed: false }] })}>
              + Add employment
            </button>
          )}
        </section>
      )}
    </div>
  );
}

/** Client-side check mirroring the server's required fields, for step gating. */
export function personalReady(v: ProfileForm) {
  return v.full_name.trim().length >= 2 && v.phone.replace(/\D/g, "").length >= 10;
}

export function employmentReady(v: ProfileForm) {
  return v.employment_history.every((e) => (e.self_employed || e.company.trim()) && e.job_title.trim());
}
