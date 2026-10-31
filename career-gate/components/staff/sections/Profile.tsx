"use client";

import { StaffLabel, useStaffLabel } from "@/components/staff/StaffLabel";


import { RoyalSelect, RoyalOption } from "@/components/forms/RoyalSelect";


import { useState } from "react";
import { shiftLabel } from "@/components/forms/PreferenceSteps";
import { InlineField } from "@/components/staff/InlineField";
import { useStaff } from "@/components/staff/StaffContext";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { options } from "@/lib/catalog";
import { ENGLISH_PROFICIENCY_VALUES, LANGUAGES } from "@/lib/domain";
import { dateOnly, dateTime, formatPhone } from "@/lib/format";
import { Card, SmallBtn, useRowAction, yn, type Row } from "./common";

function ProfileGrid({ rows }: { rows: [string, React.ReactNode][] }) {
  const uiLabel = useStaffLabel();
  return (
    <dl className="cg-profile-info-grid">
      {rows.map(([label, value]) => (
        <div key={label} className="cg-profile-info-cell">
          <dt>{uiLabel(label)}</dt>
          <dd>{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ClientInfo({ c, authorization, preferences = [] }: { c: Row; authorization: Row | null; preferences?: Row[] }) {
  const uiLabel = useStaffLabel();
  const f = (field: string, label: string, extra: Partial<Parameters<typeof InlineField>[0]> = {}) => (
    <InlineField clientId={c.id} field={field} label={label} value={c[field] ?? null} {...extra} />
  );
  const primary = preferences.find((p) => p.rank === "primary") ?? preferences[0] ?? null;
  return (
    <Card title={uiLabel("Client Information")} id="client-info">
      <ProfileGrid rows={[
        ["Full name", f("full_name", "Full name")],
        ["Phone", f("phone", "Phone", { type: "tel", display: formatPhone(c.phone) })],
        ["Email", f("email", "Email", { type: "email" })],
        ["Date of birth", f("date_of_birth", "Date of birth", { type: "date", display: c.date_of_birth ? dateOnly(c.date_of_birth) : undefined })],
        ["Language", f("preferred_language", "Language", { options: Object.entries(LANGUAGES).map(([value, label]) => ({ value, label })), display: LANGUAGES[c.preferred_language as keyof typeof LANGUAGES] })],
        ["English proficiency", f("english_proficiency", "English proficiency", { options: [{ value: "", label: "Not provided" }, ...ENGLISH_PROFICIENCY_VALUES.map((value) => ({ value, label: value }))] })],
        ["Street", f("street", "Street")],
        ["City", f("city", "City")],
        ["State", f("state", "State")],
        ["ZIP", f("zip", "ZIP")],
        ["Availability", f("appointment_availability", "Appointment availability", { multiline: true })],
        ["Preferred Location", c.preferred_location ?? primary?.site_name ?? primary?.site_code ?? "—"],
        ["Location Option 1", c.location_option_1 ?? "—"],
        ["Location Option 2", c.location_option_2 ?? "—"],
        ["Shift Days", c.shift_days?.join(", ") ?? primary?.days ?? "—"],
        ["Shift Time", c.shift_start_time || c.shift_end_time ? `${c.shift_start_time ?? "—"} – ${c.shift_end_time ?? "—"}` : primary?.hours ?? primary?.shift_name ?? primary?.shift_code ?? "—"],
        ["Contact consent", c.communication_consent ? uiLabel("Yes") : uiLabel("No")],
        ["Source", c.source === "public_intake" ? uiLabel("Online application") : `Office${c.created_by_name ? ` (${c.created_by_name})` : ""}`],
        ["Created", dateTime(c.created_at)],
        ["Last updated", dateTime(c.updated_at)],
      ]} />
      {authorization ? (
        <p className="mt-3 rounded bg-slate-50 p-2 text-xs text-slate-600" data-testid="authorization-record"><StaffLabel en="Authorization v"/>{authorization.authorization_version}{" "}<StaffLabel en="signed “"/>{authorization.signature}<StaffLabel en="” (printed:"/>{" "}{authorization.printed_name}<StaffLabel en=") at"/>{" "}
          {dateTime(authorization.signed_at)}{" "}<StaffLabel en="(server time). Text SHA-256"/>{" "}{String(authorization.authorization_sha256).slice(0, 12)}…
        </p>
      ) : (
        c.source === "staff_manual" && <p className="mt-3 text-xs text-slate-500"><StaffLabel en="No signed authorization on file (office-created)."/></p>
      )}
    </Card>
  );
}

export function AmazonHistory({ c }: { c: Row }) {
  const uiLabel = useStaffLabel();
  return (
    <Card title={uiLabel("Amazon History")} id="amazon-history">
      <ProfileGrid rows={[
        ["Worked at Amazon", yn(c.amazon_worked_before)],
        ...(c.amazon_worked_before ? [["Dates", `${dateOnly(c.amazon_worked_from)} – ${dateOnly(c.amazon_worked_to)}`] as [string, string]] : []),
        ["Applied before", yn(c.amazon_applied_before)],
        ...(c.amazon_applied_before ? [["Amazon email", c.amazon_application_email ?? "UNKNOWN / NOT PROVIDED"] as [string, string]] : []),
        ["Currently at Amazon", yn(c.currently_amazon)],
        ["Via third-party agency", yn(c.via_agency)],
      ]} />
    </Card>
  );
}

export function EmploymentHistory({ rows, editHref }: { rows: Row[]; editHref: string }) {
  const uiLabel = useStaffLabel();
  return (
    <Card title={uiLabel("Employment History")} id="employment-history">
      {rows.length ? (
        <ul className="space-y-2">
          {rows.map((e) => (
            <li key={e.id}>
              <p className="font-medium">{e.job_title} — {e.employment_kind === "self_employed" ? uiLabel("Self-Employed") : e.company}</p>
              <p className="text-slate-500">{dateOnly(e.from_date)} – {e.to_date ? dateOnly(e.to_date) : uiLabel("Present")}</p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={uiLabel("No employment history")} text={uiLabel("Record the most recent paid work in the last five years, if any.")} action={<a href={editHref} className="text-sm text-brand-700 hover:underline"><StaffLabel en="+ Add in Edit Client"/></a>} />
      )}
    </Card>
  );
}

export function Preferences({ clientId, prefs }: { clientId: string; prefs: Row[] }) {
  const uiLabel = useStaffLabel();
  const { isManager } = useStaff();
  const a = useRowAction("Preferences updated");
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [rank, setRank] = useState<"primary" | "backup">("primary");
  const taken = new Set(prefs.map((p) => `${p.site_code}|${p.job_id}|${p.shift_code}`));
  const groups: ["primary" | "backup", Row[]][] = [["primary", prefs.filter((p) => p.rank === "primary")], ["backup", prefs.filter((p) => p.rank === "backup")]];

  return (
    <Card title={uiLabel("Job Preferences — Search Order")} id="preferences"
      actions={isManager && options.length > 0 && <SmallBtn onClick={() => setAdding(!adding)}><StaffLabel en="+ Add preference"/></SmallBtn>}>
      {adding && (
        <form className="mb-4 flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-3" onSubmit={async (e) => {
          e.preventDefault();
          if (!key) return a.setError("Choose an option");
          const [site_code, job_id, shift_code] = key.split("|");
          if (await a.go({ action: "add_preference", client_id: clientId, rank, selection: { site_code, job_id, shift_code } })) { setAdding(false); setKey(""); }
        }}>
          <RoyalSelect aria-label={uiLabel("Rank")} className="input w-32" value={rank} onChange={(e) => setRank(e.target.value as typeof rank)}>
            <RoyalOption labelAr="أساسي" value="primary">Primary</RoyalOption><RoyalOption labelAr="احتياطي" value="backup">Backup</RoyalOption>
          </RoyalSelect>
          <RoyalSelect aria-label={uiLabel("Catalog option")} className="input min-w-[18rem] flex-1" value={key} onChange={(e) => setKey(e.target.value)}>
            <RoyalOption labelAr="اختر الموقع · الوظيفة · الوردية…" value="">Select site · job · shift…</RoyalOption>
            {options.filter((o) => !taken.has(o.key)).map((o) => (
              <RoyalOption key={o.key} value={o.key}>{o.city} · {o.site_name} · {o.job_title} · {shiftLabel(o)}{o.pay ? ` · ${o.pay}` : ""}</RoyalOption>
            ))}
          </RoyalSelect>
          <Button type="submit" disabled={a.pending}><StaffLabel en="Add"/></Button>
        </form>
      )}
      {prefs.length === 0 ? (
        <EmptyState title={uiLabel("No job preferences")} text={options.length ? uiLabel("Add the sites, jobs and shifts this client wants, in search order.") : uiLabel("The job catalog lists no active openings yet.")} />
      ) : (
        <div className="space-y-4">
          {groups.map(([rk, rows]) => rows.length > 0 && (
            <div key={rk} className="overflow-x-auto">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{rk === "primary" ? uiLabel("Primary") : uiLabel("Backup")}</p>
              <table className="table">
                <thead><tr><th>#</th><th><StaffLabel en="City"/></th><th><StaffLabel en="Site"/></th><th><StaffLabel en="Job"/></th><th><StaffLabel en="Shift"/></th><th><StaffLabel en="Days"/></th><th><StaffLabel en="Hours"/></th><th><StaffLabel en="Pay snapshot"/></th><th><StaffLabel en="Catalog note"/></th>{isManager && <th />}</tr></thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} data-testid="preference-row">
                      <td className="font-semibold">{p.preference_order}</td>
                      <td>{p.city}</td>
                      <td>{p.site_name} <span className="text-slate-400">({p.site_code})</span>{p.site_address && <span className="block text-xs text-slate-500">{p.site_address}</span>}</td>
                      <td>{p.job_title}{p.employment_type && <span className="block text-xs text-slate-500">{p.employment_type}</span>}
                        {p.source_url && <a href={p.source_url} target="_blank" rel="noopener noreferrer" className="block text-xs text-brand-700 hover:underline"><StaffLabel en="Amazon job"/>{" "}{p.amazon_job_id}</a>}</td>
                      <td>{p.shift_code}</td>
                      <td>{p.days ?? "—"}</td>
                      <td>{p.hours ?? "—"}</td>
                      <td className="font-medium" data-testid="pay-snapshot">{p.pay_snapshot ?? "NOT_PUBLISHED"}{p.pay_detail?.shift_differential && <span className="block text-xs text-slate-500"><StaffLabel en="Differential:"/>{" "}{p.pay_detail.shift_differential}</span>}</td>
                      <td className="text-xs text-slate-500">{p.availability_snapshot ?? "—"}<span className="block"><StaffLabel en="Verified"/>{" "}{p.source_verified_at ?? "—"}</span><span className="block">{p.catalog_version}</span></td>
                      {isManager && <td><SmallBtn disabled={a.pending} onClick={() => a.go({ action: "remove_preference", client_id: clientId, preference_id: p.id })}><StaffLabel en="Remove"/></SmallBtn></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <p className="text-xs text-slate-500"><StaffLabel en="Snapshots show the catalog as of selection. They do not indicate current availability."/></p>
        </div>
      )}
      {a.error && <p role="alert" className="mt-2 text-red-600">{a.error}</p>}
    </Card>
  );
}
