"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  STAFF_PERMISSION_REGISTRY,
  effectivePermissions,
  type PermissionMode,
  type StaffPermission,
} from "@/lib/permissions";
import type { StaffPermissionDirectoryRow } from "@/lib/staff-permission-directory";

type Props = {
  staff: StaffPermissionDirectoryRow[];
  actorRole: "admin" | "manager";
  actorId: string;
};

type Draft = { mode: PermissionMode; permissions: StaffPermission[] };

export function PermissionSettings({ staff, actorRole, actorId }: Props) {
  const router = useRouter();
  const initial = useMemo(
    () => Object.fromEntries(staff.map((member) => [member.id, { mode: member.permission_mode, permissions: member.permissions } satisfies Draft])),
    [staff],
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<Record<string, string>>({});

  const groups = useMemo(() => {
    const result = new Map<string, typeof STAFF_PERMISSION_REGISTRY[number][]>();
    for (const permission of STAFF_PERMISSION_REGISTRY) {
      const list = result.get(permission.group) ?? [];
      list.push(permission);
      result.set(permission.group, list);
    }
    return [...result.entries()];
  }, []);

  function setMode(id: string, mode: PermissionMode) {
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? { mode: "full", permissions: [] }), mode } }));
    setMessage((current) => ({ ...current, [id]: "" }));
  }

  function toggle(id: string, permission: StaffPermission) {
    setDrafts((current) => {
      const draft = current[id] ?? { mode: "custom" as const, permissions: [] };
      const selected = draft.permissions.includes(permission)
        ? draft.permissions.filter((item) => item !== permission)
        : [...draft.permissions, permission];
      return { ...current, [id]: { mode: "custom", permissions: selected } };
    });
    setMessage((current) => ({ ...current, [id]: "" }));
  }

  async function save(id: string) {
    const draft = drafts[id];
    if (!draft || saving) return;
    setSaving(id);
    setMessage((current) => ({ ...current, [id]: "" }));
    try {
      const response = await fetch("/api/staff/permissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ staff_id: id, permission_mode: draft.mode, permissions: draft.permissions }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; error?: { message?: string } } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error?.message ?? "Permission update failed");
      setMessage((current) => ({ ...current, [id]: "Saved" }));
      router.refresh();
    } catch (error) {
      setMessage((current) => ({ ...current, [id]: error instanceof Error ? error.message : "Permission update failed" }));
    } finally {
      setSaving(null);
    }
  }

  return <div className="space-y-4">
    <div className="rounded-xl border border-cyan-400/15 bg-cyan-400/[.035] px-4 py-3 text-sm text-slate-300">
      Role remains the maximum authority. Full Access grants every canonical permission allowed by the member&apos;s role; Custom Access grants only selected permissions and never bypasses the role ceiling.
    </div>
    {staff.map((member) => {
      const draft = drafts[member.id] ?? { mode: member.permission_mode, permissions: member.permissions };
      const effective = effectivePermissions(draft.mode, draft.permissions);
      const managerBlocked = actorRole === "manager" && member.role === "admin";
      const disabled = managerBlocked || saving === member.id;
      return <section key={member.id} className="rounded-2xl border border-white/[.07] bg-white/[.025] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-100">{member.display_name}</h3>
            <p className="mt-1 text-xs text-slate-500">{member.staff_code ?? "—"} · {member.role} · {member.email ?? "No email"}{member.id === actorId ? " · You" : ""}</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-400" htmlFor={`permission-mode-${member.id}`}>Access</label>
            <select
              id={`permission-mode-${member.id}`}
              value={draft.mode}
              disabled={disabled}
              onChange={(event) => setMode(member.id, event.target.value as PermissionMode)}
              className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
            >
              <option value="full">Full Access</option>
              <option value="custom">Custom Access</option>
            </select>
            <button
              type="button"
              disabled={disabled}
              onClick={() => save(member.id)}
              className="ops-primary-button disabled:cursor-not-allowed disabled:opacity-50"
            >{saving === member.id ? "Saving…" : "Save"}</button>
          </div>
        </div>

        {managerBlocked ? <p className="mt-3 text-sm text-amber-300">Administrator access profiles can only be changed by an administrator.</p> : null}
        <p className="mt-3 text-xs text-slate-500">Effective permission-layer access: {effective.length} / {STAFF_PERMISSION_REGISTRY.length}</p>

        <div className="mt-4 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {groups.map(([group, permissions]) => <fieldset key={group} className="rounded-xl border border-white/[.06] bg-slate-950/25 p-3" disabled={disabled || draft.mode === "full"}>
            <legend className="px-1 text-xs font-semibold uppercase tracking-[.12em] text-slate-400">{group}</legend>
            <div className="mt-2 space-y-2">
              {permissions.map((permission) => {
                const checked = draft.mode === "full" || draft.permissions.includes(permission.key);
                return <label key={permission.key} className="flex items-start gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(member.id, permission.key)}
                    className="mt-0.5 size-4 rounded border-white/20 bg-slate-950"
                  />
                  <span>{permission.label}<span className="block text-[11px] text-slate-600">{permission.key}</span></span>
                </label>;
              })}
            </div>
          </fieldset>)}
        </div>
        {message[member.id] ? <p role="status" className={`mt-3 text-sm ${message[member.id] === "Saved" ? "text-emerald-300" : "text-rose-300"}`}>{message[member.id]}</p> : null}
      </section>;
    })}
  </div>;
}
