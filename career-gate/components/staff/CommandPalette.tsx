"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { STATUS_LABELS, type Status } from "@/lib/domain";
import { useStaff } from "./StaffContext";

type Item = { id: string; label: string; hint?: string; href: string };

/** Cmd/Ctrl+K: pages, filters and client search, keyboard driven. */
export function CommandPalette() {
  const router = useRouter();
  const { isManager, isAdmin } = useStaff();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [clients, setClients] = useState<Item[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const pages: Item[] = useMemo(() => [
    { id: "p-dash", label: "Dashboard", href: "/staff" },
    { id: "p-clients", label: "Clients", href: "/staff/clients" },
    ...(isManager ? [{ id: "p-new", label: "New client", href: "/staff/new-client" }] : []),
    { id: "p-appt", label: "Appointments", href: "/staff/appointments" },
    { id: "p-tasks", label: "Tasks", href: "/staff/tasks" },
    { id: "p-fu", label: "Follow-ups", href: "/staff/follow-ups" },
    ...(isManager ? [{ id: "p-audit", label: "Audit alerts", href: "/staff/audit-alerts" }, { id: "p-reports", label: "Reports", href: "/staff/reports" }, { id: "p-avail", label: "Office availability", href: "/staff/settings/availability" }] : []),
    ...(isAdmin ? [{ id: "p-team", label: "Team settings", href: "/staff/settings/team" }] : []),
    ...(["new_intake", "needs_review", "ready_to_apply", "application_in_progress", "screening_pending", "i9_available", "ready_for_first_day"] as Status[]).map((s) => ({
      id: `f-${s}`, label: `Filter: ${STATUS_LABELS[s]}`, hint: "Clients", href: `/staff/clients?status=${s}`,
    })),
    { id: "f-fu", label: "Filter: follow-up due", hint: "Clients", href: "/staff/clients?followup=due" },
  ], [isManager, isAdmin]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        opener.current = document.activeElement as HTMLElement;
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
    else opener.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const res = await fetch(`/api/staff/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal }).catch(() => null);
      const data = await res?.json().catch(() => null);
      if (data?.ok) {
        setClients(data.results.map((c: { id: string; ref: string; full_name: string; current_status: Status }) => ({
          id: c.id, label: `${c.full_name} · ${c.ref}`, hint: STATUS_LABELS[c.current_status], href: `/staff/client/${c.id}`,
        })));
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open]);

  const items = [
    ...(q.trim().length >= 2 ? clients : []),
    ...pages.filter((p) => p.label.toLowerCase().includes(q.trim().toLowerCase())),
  ];

  const go = (it: Item | undefined) => {
    if (!it) return;
    setOpen(false);
    setQ("");
    router.push(it.href);
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="hidden rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-500 md:block" aria-label="Open command palette">
        Search… <kbd className="ml-2 rounded bg-slate-100 px-1">⌘K</kbd>
      </button>
    );
  }
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-slate-900/30 px-4 pt-24" onMouseDown={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" data-testid="command-palette"
        className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-list"
          aria-activedescendant={items[active] ? `cmdk-${items[active].id}` : undefined}
          className="w-full border-b border-slate-200 px-4 py-3 text-sm focus:outline-none"
          placeholder="Search clients or jump to a page…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === "Enter") { e.preventDefault(); go(items[active]); }
          }}
        />
        <ul id="cmdk-list" role="listbox" className="max-h-80 overflow-y-auto py-1">
          {items.map((it, i) => (
            <li key={it.id} id={`cmdk-${it.id}`} role="option" aria-selected={i === active}
              className={`flex cursor-pointer justify-between px-4 py-2 text-sm ${i === active ? "bg-brand-50 text-brand-700" : ""}`}
              onMouseEnter={() => setActive(i)} onClick={() => go(it)}>
              <span>{it.label}</span>
              {it.hint && <span className="text-xs text-slate-400">{it.hint}</span>}
            </li>
          ))}
          {!items.length && <li className="px-4 py-3 text-sm text-slate-500">No matches.</li>}
        </ul>
      </div>
    </div>
  );
}
