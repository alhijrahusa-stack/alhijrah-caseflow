"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction } from "@/components/forms/useAction";
import { Button } from "@/components/ui/Button";

type S = {
  id: string;
  display_name: string;
  email: string | null;
  role: "admin" | "manager" | "staff";
  active: boolean;
  linked: boolean;
  staff_code?: string | null;
  commission_type?: "fixed" | "percent";
  commission_value?: number;
  eligible_for_round_robin?: boolean;
  permission_mode: "full" | "custom";
  custom_permissions: string[];
  updated_at: string;
};

async function postOperation(body: Record<string, unknown>) {
  const res = await fetch("/api/staff/operations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
  return data.data;
}

async function updateComp(staff: S, type: "fixed" | "percent", value: number, eligible: boolean) {
  return postOperation({ operation: "update_staff_comp", staff_id: staff.id, commission_type: type, commission_value: value, eligible_for_round_robin: eligible });
}

function Compensation({ staff }: { staff: S }) {
  const router = useRouter();
  const [type, setType] = useState<"fixed" | "percent">(staff.commission_type ?? "fixed");
  const [value, setValue] = useState(String(Number(staff.commission_value ?? 0)));
  const [eligible, setEligible] = useState(staff.eligible_for_round_robin ?? true);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "saved" | "error">("idle");

  async function save() {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) { setState("error"); return; }
    setBusy(true); setState("idle");
    try { await updateComp(staff, type, number, eligible); setState("saved"); router.refresh(); }
    catch { setState("error"); }
    finally { setBusy(false); }
  }

  return <div className="flex min-w-[300px] flex-wrap items-center gap-1.5">
    <select className="input w-24 py-1" value={type} disabled={busy} onChange={(e) => setType(e.target.value as "fixed" | "percent")}><option value="fixed">fixed</option><option value="percent">percent</option></select>
    <input className="input w-24 py-1" inputMode="decimal" value={value} disabled={busy} onChange={(e) => setValue(e.target.value)} aria-label={`Commission for ${staff.display_name}`} />
    <label className="flex items-center gap-1.5 rounded-lg border border-white/[.07] px-2 py-1.5 text-[10px] text-slate-400"><input type="checkbox" checked={eligible} disabled={busy} onChange={(e) => setEligible(e.target.checked)} /> Round-robin</label>
    <button type="button" className="rounded-lg border border-white/[.09] px-2.5 py-1.5 text-[10px] text-slate-300 hover:bg-white/[.05]" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
    {state === "saved" && <span className="text-[9px] text-emerald-400">Saved</span>}{state === "error" && <span className="text-[9px] text-red-400">Check value</span>}
  </div>;
}

function PermissionEditor({ staff, registry }: { staff: S; registry: string[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"full" | "custom">(staff.permission_mode ?? "full");
  const [selected, setSelected] = useState(() => new Set(staff.custom_permissions ?? []));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (staff.role !== "staff") return <span className="text-xs text-slate-500">Role-controlled</span>;

  async function save() {
    setBusy(true); setMessage(null);
    try {
      await postOperation({
        operation: "update_staff_permissions",
        staff_id: staff.id,
        permission_mode: mode,
        custom_permissions: mode === "custom" ? [...selected] : [],
        expected_updated_at: staff.updated_at,
      });
      setMessage("Saved");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Permission update failed");
    } finally { setBusy(false); }
  }

  return <div className="min-w-[360px] space-y-2">
    <div className="flex items-center gap-2">
      <select aria-label={`Permission mode for ${staff.display_name}`} className="input w-28 py-1" value={mode} disabled={busy} onChange={(e) => setMode(e.target.value as "full" | "custom")}>
        <option value="full">Full staff</option><option value="custom">Custom</option>
      </select>
      <button type="button" className="rounded-lg border border-amber-300/30 bg-amber-300/10 px-2.5 py-1.5 text-[10px] font-semibold text-amber-200" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save permissions"}</button>
      {message && <span role="status" className={message === "Saved" ? "text-[10px] text-emerald-300" : "text-[10px] text-red-300"}>{message}</span>}
    </div>
    {mode === "custom" && <div className="grid max-h-40 grid-cols-2 gap-1 overflow-auto rounded-xl border border-white/[.07] bg-slate-950/30 p-2">
      {registry.map((permission) => <label key={permission} className="flex items-center gap-1.5 text-[10px] text-slate-300"><input type="checkbox" checked={selected.has(permission)} disabled={busy} onChange={(e) => setSelected((current) => { const next = new Set(current); if (e.target.checked) next.add(permission); else next.delete(permission); return next; })} />{permission.replace(/_/g, " ")}</label>)}
    </div>}
    <p className="text-[10px] text-slate-500">Full includes staff-eligible permissions only. Manager/admin authority is never included.</p>
  </div>;
}

export function TeamSettings({ staff, meId, canManageRoles, staffEligiblePermissions }: { staff: S[]; meId: string; canManageRoles: boolean; staffEligiblePermissions: string[] }) {
  const a = useAction({ successMessage: "Team updated" });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  return <div className="space-y-4">
    <div className="overflow-x-auto rounded-2xl border border-white/[.08] bg-white/[.025] shadow-[inset_0_1px_0_rgba(255,255,255,.025)]">
      <table className="table min-w-[1480px]">
        <thead><tr><th>Staff ID</th><th>Name</th><th>Email</th><th>Role</th><th>Sign-in</th><th>Status</th><th>Staff Permissions</th><th>Commission & Distribution</th><th /></tr></thead>
        <tbody>{staff.map((s) => <tr key={s.id} data-testid="team-row">
          <td><code className="text-amber-300/80">{s.staff_code ?? "—"}</code></td>
          <td>{s.display_name}{s.id === meId && <span className="ml-1 text-xs text-slate-400">(you)</span>}</td>
          <td>{s.email ?? <span className="text-slate-500">Not provided</span>}</td>
          <td>{canManageRoles ? <select aria-label={`Role for ${s.display_name}`} className="input w-32 py-1" value={s.role} disabled={a.pending || s.id === meId} onChange={(e) => a.run({ action: "update_staff_role", staff_id: s.id, role: e.target.value })}><option value="admin">admin</option><option value="manager">manager</option><option value="staff">staff</option></select> : <span className="text-sm text-slate-300">{s.role}</span>}</td>
          <td>{s.linked ? "Linked" : "Not linked"}</td><td>{s.active ? "Active" : "Disabled"}</td>
          <td><PermissionEditor staff={s} registry={staffEligiblePermissions} /></td>
          <td>{canManageRoles ? <Compensation staff={s} /> : <span className="text-xs text-slate-500">Admin only</span>}</td>
          <td className="space-x-1 whitespace-nowrap">{canManageRoles && <>{s.active ? <button type="button" className="rounded border border-white/[.1] px-2 py-0.5 text-xs" disabled={a.pending || s.id === meId} onClick={() => a.run({ action: "disable_staff", staff_id: s.id })}>Disable</button> : <button type="button" className="rounded border border-white/[.1] px-2 py-0.5 text-xs" disabled={a.pending} onClick={() => a.run({ action: "reactivate_staff", staff_id: s.id })}>Reactivate</button>}{!s.linked && s.email && <button type="button" className="rounded border border-white/[.1] px-2 py-0.5 text-xs" disabled={a.pending} onClick={() => a.run({ action: "invite_staff", staff_id: s.id })}>Invite</button>}</>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {canManageRoles && <form className="flex flex-wrap items-end gap-2 rounded-2xl border border-white/[.08] bg-white/[.025] p-4" onSubmit={async (e) => { e.preventDefault(); if (await a.run({ action: "create_staff", display_name: name, email: email || null, role })) { setName(""); setEmail(""); } }}>
      <div><label className="label" htmlFor="ts_name">Name</label><input id="ts_name" required className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label className="label" htmlFor="ts_email">Real email (for sign-in)</label><input id="ts_email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div><label className="label" htmlFor="ts_role">Role</label><select id="ts_role" className="input" value={role} onChange={(e) => setRole(e.target.value)}><option value="staff">staff</option><option value="manager">manager</option><option value="admin">admin</option></select></div>
      <Button type="submit" disabled={a.pending}>Add staff member</Button>
    </form>}
    {a.error && <p role="alert" className="text-sm text-red-400">{a.error}</p>}
  </div>;
}
