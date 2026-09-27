"use client";

import { useState } from "react";
import { useAction } from "@/components/forms/useAction";
import { Button } from "@/components/ui/Button";

type S = { id: string; display_name: string; email: string | null; role: string; active: boolean; linked: boolean };

export function TeamSettings({ staff, meId }: { staff: S[]; meId: string }) {
  const a = useAction({ successMessage: "Team updated" });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Sign-in</th><th>Status</th><th /></tr></thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} data-testid="team-row">
                <td>{s.display_name}{s.id === meId && <span className="ml-1 text-xs text-slate-400">(you)</span>}</td>
                <td>{s.email ?? <span className="text-slate-400">UNKNOWN / NOT PROVIDED</span>}</td>
                <td>
                  <select aria-label={`Role for ${s.display_name}`} className="input w-32 py-1" value={s.role} disabled={a.pending}
                    onChange={(e) => a.run({ action: "update_staff_role", staff_id: s.id, role: e.target.value })}>
                    <option value="admin">admin</option><option value="manager">manager</option><option value="staff">staff</option>
                  </select>
                </td>
                <td>{s.linked ? "Linked" : "Not linked"}</td>
                <td>{s.active ? "Active" : "Disabled"}</td>
                <td className="space-x-1 whitespace-nowrap">
                  {s.active
                    ? <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-xs" disabled={a.pending} onClick={() => a.run({ action: "disable_staff", staff_id: s.id })}>Disable</button>
                    : <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-xs" disabled={a.pending} onClick={() => a.run({ action: "reactivate_staff", staff_id: s.id })}>Reactivate</button>}
                  {!s.linked && s.email && <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-xs" disabled={a.pending} onClick={() => a.run({ action: "invite_staff", staff_id: s.id })}>Invite</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-4" onSubmit={async (e) => {
        e.preventDefault();
        if (await a.run({ action: "create_staff", display_name: name, email: email || null, role })) { setName(""); setEmail(""); }
      }}>
        <div><label className="label" htmlFor="ts_name">Name</label><input id="ts_name" required className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="label" htmlFor="ts_email">Real email (for sign-in)</label><input id="ts_email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label className="label" htmlFor="ts_role">Role</label>
          <select id="ts_role" className="input" value={role} onChange={(e) => setRole(e.target.value)}><option value="staff">staff</option><option value="manager">manager</option><option value="admin">admin</option></select>
        </div>
        <Button type="submit" disabled={a.pending}>Add staff member</Button>
      </form>
      {a.error && <p role="alert" className="text-sm text-red-600">{a.error}</p>}
      <p className="text-xs text-slate-500">Staff sign in with an emailed code. A record links to its sign-in account on first sign-in with the same email, or through Invite.</p>
    </div>
  );
}
