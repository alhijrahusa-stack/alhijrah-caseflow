"use client";

import { useState, type ReactNode } from "react";
import { shiftLabel } from "@/components/forms/PreferenceSteps";
import { InlineField } from "@/components/staff/InlineField";
import { useStaff } from "@/components/staff/StaffContext";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { options } from "@/lib/catalog";
import { LANGUAGES } from "@/lib/domain";
import { dateOnly, dateTime, formatPhone } from "@/lib/format";
import { Card, Dl, SmallBtn, useRowAction, yn, type Row } from "./common";

export function ClientInfo({ c, authorization }: { c: Row; authorization: Row | null }) {
  const f = (field: string, label: string, extra: Partial<Parameters<typeof InlineField>[0]> = {}) => (
    <InlineField clientId={c.id} field={field} label={label} value={c[field] ?? null} {...extra} />
  );
  const identity = [
    ["Full name", f("full_name", "Full name")],
    ["Phone", f("phone", "Phone", { type: "tel", display: formatPhone(c.phone) })],
    ["Email", f("email", "Email", { type: "email" })],
    ["Date of birth", f("date_of_birth", "Date of birth", { type: "date", display: c.date_of_birth ? dateOnly(c.date_of_birth) : undefined })],
    ["Language", f("preferred_language", "Language", { options: Object.entries(LANGUAGES).map(([value, label]) => ({ value, label })), display: LANGUAGES[c.preferred_language as keyof typeof LANGUAGES] })],
    ["Availability", f("appointment_availability", "Appointment availability", { multiline: true })],
  ] as const;
  const address = [
    ["Street", f("street", "Street")],
    ["City", f("city", "City")],
    ["State", f("state", "State")],
    ["ZIP", f("zip", "ZIP")],
  ] as const;
  const record = [
    ["Contact consent", c.communication_consent ? "Yes" : "No"],
    ["Source", c.source === "public_intake" ? "Online application" : `Office${c.created_by_name ? ` (${c.created_by_name})` : ""}`],
    ["Created", dateTime(c.created_at)],
    ["Last updated", dateTime(c.updated_at)],
  ] as const;

  const group = (title: string, rows: readonly (readonly [string, ReactNode])[]) => (
    <section className="rounded-2xl border border-white/[.07] bg-gradient-to-br from-white/[.045] to-white/[.012] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,.04)]">
      <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[.16em] text-slate-500">{title}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-xl border border-white/[.055] bg-black/[.08] px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-[.12em] text-slate-600">{label}</div>
            <div className="mt-1 min-w-0 break-words text-[13px] leading-6 text-slate-200">{value}</div>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <Card title="Client Information" id="client-info">
      <div className="grid gap-3 lg:grid-cols-2">
        {group("Identity", identity)}
        {group("Address", address)}
        <div className="lg:col-span-2">{group("Record", record)}</div>
      </div>
      {authorization ? (
        <p className="mt-3 rounded-xl border border-white/[.06] bg-white/[.025] p-3 text-xs text-slate-500" data-testid="authorization-record">
          Authorization v{authorization.authorization_version} signed “{authorization.signature}” (printed: {authorization.printed_name}) at{" "}
          {dateTime(authorization.signed_at)} (server time). Text SHA-256 {String(authorization.authorization_sha256).slice(0, 12)}…
        </p>
      ) : (
        c.source === "staff_manual" && <p className="mt-3 text-xs text-slate-500">No signed authorization on file (office-created).</p>
      )}
    </Card>
  );
}

export function AmazonHistory({ c }: { c: Row }) {
  return (
    <Card title="Amazon History" id="amazon-history">
      <Dl rows={[
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
  return (
    <Card title="Employment History" id="employment-history">
      {rows.length ? (
        <ul className="space-y-2">
          {rows.map((e) => (
            <li key={e.id}>
              <p className="font-medium">{e.job_title} — {e.employment_kind === "self_employed" ? "Self-Employed" : e.company}</p>
              <p className="text-slate-500">{dateOnly(e.from_date)} – {e.to_date ? dateOnly(e.to_date) : "Present"}</p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No employment history" text="Record the most recent paid work in the last five years, if any." action={<a href={editHref} className="text-sm text-brand-700 hover:underline">+ Add in Edit Client</a>} />
      )}
    </Card>
  );
}

export function Preferences({ clientId, prefs }: { clientId: string; prefs: Row[] }) {
  const { isManager } = useStaff();
  const a = useRowAction("Preferences updated");
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [rank, setRank] = useState<"primary" | "backup">("primary");
  const taken = new Set(prefs.map((p) => `${p.site_code}|${p.job_id}|${p.shift_code}`));
  const groups: ["primary" | "backup", Row[]][] = [["primary", prefs.filter((p) => p.rank === "primary")], ["backup", prefs.filter((p) => p.rank === "backup")]];

  return (
    <Card title="Job Preferences — Search Order" id="preferences"
      actions={isManager && options.length > 0 && <SmallBtn onClick={() => setAdding(!adding)}>+ Add preference</SmallBtn>}>
      {adding && (
        <form className="mb-4 flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-3" onSubmit={async (e) => {
          e.preventDefault();
          if (!key) return a.setError("Choose an option");
          const [site_code, job_id, shift_code] = key.split("|");
          if (await a.go({ action: "add_preference", client_id: clientId, rank, selection: { site_code, job_id, shift_code } })) { setAdding(false); setKey(""); }
        }}>
          <select aria-label="Rank" className="input w-32" value={rank} onChange={(e) => setRank(e.target.value as typeof rank)}>
            <option value="primary">Primary</option><option value="backup">Backup</option>
          </select>
          <select aria-label="Catalog option" className="input min-w-[18rem] flex-1" value={key} onChange={(e) => setKey(e.target.value)}>
            <option value="">Select site · job · shift…</option>
            {options.filter((o) => !taken.has(o.key)).map((o) => (
              <option key={o.key} value={o.key}>{o.city} · {o.site_name} · {o.job_title} · {shiftLabel(o)}{o.pay ? ` · ${o.pay}` : ""}</option>
            ))}
          </select>
          <Button type="submit" disabled={a.pending}>Add</Button>
        </form>
      )}
      {prefs.length === 0 ? (
        <EmptyState title="No job preferences" text={options.length ? "Add the sites, jobs and shifts this client wants, in search order." : "The job catalog lists no active openings yet."} />
      ) : (
        <div className="space-y-4">
          {groups.map(([rk, rows]) => rows.length > 0 && (
            <div key={rk} className="overflow-x-auto">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{rk === "primary" ? "Primary" : "Backup"}</p>
              <table className="table">
                <thead><tr><th>#</th><th>City</th><th>Site</th><th>Job</th><th>Shift</th><th>Days</th><th>Hours</th><th>Pay snapshot</th><th>Catalog note</th>{isManager && <th />}</tr></thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} data-testid="preference-row">
                      <td className="font-semibold">{p.preference_order}</td>
                      <td>{p.city}</td>
                      <td>{p.site_name} <span className="text-slate-400">({p.site_code})</span>{p.site_address && <span className="block text-xs text-slate-500">{p.site_address}</span>}</td>
                      <td>{p.job_title}{p.employment_type && <span className="block text-xs text-slate-500">{p.employment_type}</span>}
                        {p.source_url && <a href={p.source_url} target="_blank" rel="noopener noreferrer" className="block text-xs text-brand-700 hover:underline">Amazon job {p.amazon_job_id}</a>}</td>
                      <td>{p.shift_code}</td>
                      <td>{p.days ?? "—"}</td>
                      <td>{p.hours ?? "—"}</td>
                      <td className="font-medium" data-testid="pay-snapshot">{p.pay_snapshot ?? "NOT_PUBLISHED"}{p.pay_detail?.shift_differential && <span className="block text-xs text-slate-500">Differential: {p.pay_detail.shift_differential}</span>}</td>
                      <td className="text-xs text-slate-500">{p.availability_snapshot ?? "—"}<span className="block">Verified {p.source_verified_at ?? "—"}</span><span className="block">{p.catalog_version}</span></td>
                      {isManager && <td><SmallBtn disabled={a.pending} onClick={() => a.go({ action: "remove_preference", client_id: clientId, preference_id: p.id })}>Remove</SmallBtn></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <p className="text-xs text-slate-500">Snapshots show the catalog as of selection. They do not indicate current availability.</p>
        </div>
      )}
      {a.error && <p role="alert" className="mt-2 text-red-600">{a.error}</p>}
    </Card>
  );
}
