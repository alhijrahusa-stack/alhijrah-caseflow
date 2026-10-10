"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { QuickDate } from "@/components/staff/QuickDate";
import { useStaff } from "@/components/staff/StaffContext";
import { PostHire } from "@/components/staff/sections/Work";
import type { Row } from "@/components/staff/sections/common";

const STATUSES = ["missing", "pending_review", "complete", "rejected", "expired", "not_applicable"] as const;

type Readiness = { total_requirements: number; completed_requirements: number; readiness_percent: number | null } | null;

async function postRequirement(body: Record<string, unknown>) {
  const res = await fetch("/api/staff/requirements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
  return data;
}

function RequirementRow({ row }: { row: Row }) {
  const router = useRouter();
  const [status, setStatus] = useState(String(row.status));
  const [due, setDue] = useState(row.due_at ? String(row.due_at).slice(0, 10) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null);
    try {
      await postRequirement({ operation: "update_requirement", requirement_id: row.id, status, due_on: due || null });
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update requirement"); }
    finally { setBusy(false); }
  }

  return (
    <div id={`requirement-${String(row.id)}`} className="scroll-mt-28 rounded-xl border border-white/[.06] bg-white/[.02] p-3" data-testid="requirement-row">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-slate-200">{String(row.title)}</strong><code className="text-[9px] text-slate-600">{String(row.requirement_key)}</code></div>
          {row.why && <p className="mt-1 text-xs text-slate-400">{String(row.why)}</p>}
          {row.completion_rule && <p className="mt-1 text-[10px] text-slate-500">Complete when: {String(row.completion_rule)}</p>}
        </div>
        <select className="ops-select" aria-label={`${String(row.title)} status`} value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
        <QuickDate ariaLabel={`${String(row.title)} due date`} value={due} onChange={setDue} />
        <button className="ops-primary-button" type="button" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
      </div>
      {error && <p className="ops-inline-error mt-2" role="alert">{error}</p>}
    </div>
  );
}

export function RequirementsPanel({ clientId, rows, readiness, postHire, startDate }: { clientId: string; rows: Row[]; readiness: Readiness; postHire: Row[]; startDate: string | null }) {
  const { isManager } = useStaff();
  const router = useRouter();
  const [showNew, setShowNew] = useState(false);
  const [key, setKey] = useState("");
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [rule, setRule] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const standaloneRows = rows.filter((row) => !String(row.requirement_key ?? "").startsWith("post_hire:"));

  async function create() {
    setBusy(true); setError(null);
    try {
      await postRequirement({ operation: "create_requirement", client_id: clientId, requirement_key: key, title, why: why || null, completion_rule: rule || null, due_on: due || null, status: "missing" });
      setKey(""); setTitle(""); setWhy(""); setRule(""); setDue(""); setShowNew(false); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create requirement"); }
    finally { setBusy(false); }
  }

  return (
    <section className="staff-glass rounded-2xl p-4" data-testid="section-requirements">
      <div className="flex flex-wrap items-center gap-3">
        <div><p className="text-[10px] uppercase tracking-[.14em] text-slate-500">Unified Workflow</p><h2 className="text-base font-semibold">Readiness / Post-Hire</h2></div>
        <div className="ms-auto text-right"><strong className="text-2xl text-slate-100">{readiness?.readiness_percent == null ? "—" : `${readiness.readiness_percent}%`}</strong><p className="text-[10px] text-slate-500">{readiness ? `${readiness.completed_requirements}/${readiness.total_requirements} complete` : "No requirements generated"}</p></div>
        {isManager && <button type="button" className="ops-secondary-button" onClick={() => setShowNew((v) => !v)}>{showNew ? "Cancel" : "Add requirement"}</button>}
      </div>
      {showNew && (
        <div className="mt-3 grid gap-2 rounded-xl border border-white/[.06] bg-white/[.02] p-3 md:grid-cols-2">
          <input className="ops-input" aria-label="Requirement key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="requirement-key" />
          <input className="ops-input" aria-label="Requirement title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Requirement title" />
          <input className="ops-input" aria-label="Requirement reason" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why this is required" />
          <input className="ops-input" aria-label="Completion rule" value={rule} onChange={(e) => setRule(e.target.value)} placeholder="Completion rule" />
          <QuickDate ariaLabel="Requirement due date" value={due} onChange={setDue} />
          <button type="button" className="ops-primary-button" disabled={busy || !key.trim() || !title.trim()} onClick={create}>{busy ? "Adding…" : "Add requirement"}</button>
          {error && <p className="ops-inline-error md:col-span-2" role="alert">{error}</p>}
        </div>
      )}
      <div className="mt-4 border-t border-white/[.06] pt-4"><PostHire clientId={clientId} items={postHire} startDate={startDate} embedded /></div>
      <div className="mt-4 space-y-2">{standaloneRows.map((row) => <RequirementRow key={String(row.id)} row={row} />)}{!standaloneRows.length && <p className="text-xs text-slate-500">No additional requirements.</p>}</div>
    </section>
  );
}
