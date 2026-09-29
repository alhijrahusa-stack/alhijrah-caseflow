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
    ...(["new_intake", "needs_review", "ready_to_apply", "application_in_progress", "screening_pending", "i9_available", "ready_for_first_day"] as Status[]).map((status) => ({
      id: `f-${status}`,
      label: `Filter: ${STATUS_LABELS[status]}`,
      hint: "Clients",
      href: `/staff/clients?status=${status}`,
    })),
    { id: "f-fu", label: "Filter: follow-up due", hint: "Clients", href: "/staff/clients?followup=due" },
  ], [isManager, isAdmin]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        opener.current = document.activeElement as HTMLElement;
        setOpen((current) => !current);
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
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/staff/search?q=${encodeURIComponent(q)}`, { signal: controller.signal }).catch(() => null);
      const data = await response?.json().catch(() => null);
      if (data?.ok) {
        setClients(data.results.map((client: { id: string; ref: string; full_name: string; current_status: Status }) => ({
          id: client.id,
          label: `${client.full_name} · ${client.ref}`,
          hint: STATUS_LABELS[client.current_status],
          href: `/staff/client/${client.id}`,
        })));
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, open]);

  const items = [
    ...(q.trim().length >= 2 ? clients : []),
    ...pages.filter((page) => page.label.toLowerCase().includes(q.trim().toLowerCase())),
  ];

  const go = (item: Item | undefined) => {
    if (!item) return;
    setOpen(false);
    setQ("");
    router.push(item.href);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="staff-header-action hidden md:inline-flex"
        aria-label="Open command palette"
      >
        Command <kbd className="ms-2 rounded-md border border-white/10 bg-white/[.04] px-1.5 py-0.5 text-[11px] text-slate-400">⌘K</kbd>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-4 pt-24 backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette"
        className="cg-command-shell w-full max-w-xl overflow-hidden"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-list"
          aria-activedescendant={items[active] ? `cmdk-${items[active].id}` : undefined}
          className="cg-command-input min-h-14 w-full border-0 border-b px-4 outline-none"
          placeholder="Search clients or jump to a page…"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setActive(0);
            if (event.target.value.trim().length < 2) setClients([]);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "ArrowDown") { event.preventDefault(); setActive((current) => Math.min(current + 1, items.length - 1)); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActive((current) => Math.max(current - 1, 0)); }
            if (event.key === "Enter") { event.preventDefault(); go(items[active]); }
          }}
        />
        <ul id="cmdk-list" role="listbox" className="max-h-96 overflow-y-auto p-2">
          {items.map((item, index) => (
            <li
              key={item.id}
              id={`cmdk-${item.id}`}
              role="option"
              aria-selected={index === active}
              data-active={index === active}
              className="cg-command-item flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-sm"
              onMouseEnter={() => setActive(index)}
              onClick={() => go(item)}
            >
              <span className="min-w-0 truncate">{item.label}</span>
              {item.hint && <span className="shrink-0 text-xs text-slate-500">{item.hint}</span>}
            </li>
          ))}
          {!items.length && <li className="px-4 py-5 text-sm text-slate-500">No matches.</li>}
        </ul>
      </div>
    </div>
  );
}
