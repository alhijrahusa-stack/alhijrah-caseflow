"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { STATUS_LABELS, type Status } from "@/lib/domain";
import { useStaff } from "./StaffContext";

type Item = { id: string; label: string; hint?: string; href: string };

export function CommandPalette() {
  const router = useRouter();
  const { t, dir } = useStaffLanguage();
  const dialog = useRef<HTMLDivElement>(null);
  const { isManager, activeStaff } = useStaff();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [clients, setClients] = useState<Item[]>([]);
  const [searching,setSearching]=useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const pages: Item[] = useMemo(() => [
    { id: "p-dash", label: t("Dashboard", "مركز القيادة"), href: "/staff" },
    { id: "p-pipeline", label: t("Pipeline", "مسار العمل"), href: "/staff/pipeline" },
    { id: "p-clients", label: t("Clients", "الاستقبال والتدقيق"), href: "/staff/clients" },
    { id: "p-completed", label: t("Completed clients", "السجل المكتمل"), href: "/staff/clients?view=completed" },
    { id: "p-appt", label: t("Appointments", "المواعيد والمقابلات"), href: "/staff/appointments" },
    { id: "p-tasks", label: t("Tasks · overdue", "المهام والمتأخرات"), href: "/staff/tasks?view=overdue" },
    { id: "p-fu", label: t("Follow-ups", "المتابعات"), href: "/staff/follow-ups" },
    { id: "p-docs", label: t("Documents needing action", "الوثائق المعلقة"), href: "/staff/clients?attention=documents" },
    ...activeStaff.map(member=>({id:`s-${member.id}`,label:member.display_name,hint:t("Team load", "حمل الفريق"),href:`/staff/staff?tab=team&member=${member.id}`})),
    { id: "p-team", label: t("Staff · Team", "الفريق"), href: "/staff/staff?tab=team" },
    ...(isManager ? [
      { id: "p-manager", label: t("Manager\'s inbox", "صندوق وارد المدير"), href: "/staff/manager-inbox" },
      { id: "p-assign", label: t("Staff · Assignments", "توزيع الملفات"), href: "/staff/staff?tab=assignments" },
      { id: "p-finance", label: t("Accounting", "المالية والسداد"), href: "/staff/accounting" },
      { id: "p-new", label: t("New client", "إضافة عميل"), href: "/staff/new-client" },
      { id: "p-audit", label: t("Audit alerts", "تنبيهات التدقيق"), href: "/staff/audit-alerts" },
      { id: "p-reports", label: t("Reports", "التقارير"), href: "/staff/reports" },
      { id: "p-settings", label: t("System settings", "إعدادات النظام"), href: "/staff/settings" },
      { id: "p-avail", label: t("Office availability", "أوقات المكتب"), href: "/staff/settings/availability" },
    ] : []),
    ...(["new_intake", "needs_review", "ready_to_apply", "application_in_progress", "screening_pending", "i9_available", "ready_for_first_day"] as Status[]).map((s) => ({
      id: `f-${s}`, label: `${t("Filter", "تصفية")}: ${STATUS_LABELS[s]}`, hint: t("Active clients", "ملفات نشطة"), href: `/staff/clients?view=active&status=${s}`,
    })),
  ], [isManager, activeStaff, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        opener.current = document.activeElement as HTMLElement;
        setOpen((o) => !o);
      }
    };
    const onOpen = () => { opener.current = document.activeElement as HTMLElement; setOpen(true); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("career-gate:open-command", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("career-gate:open-command", onOpen); };
  }, []);

  useEffect(() => {
    if (!open) { opener.current?.focus?.(); return; }
    const timer = window.setTimeout(() => input.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
      if (event.key !== "Tab") return;
      const controls = dialog.current?.querySelectorAll<HTMLElement>('input,button,[tabindex="0"]');
      const first = controls?.[0];
      const last = controls?.[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { window.clearTimeout(timer); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const res = await fetch(`/api/staff/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal }).catch(() => null);
      const data = await res?.json().catch(() => null);
      if (data?.ok&&!ctrl.signal.aborted) {
        setClients(data.results.map((c: { id: string; ref: string; full_name: string; current_status: Status }) => ({
          id: c.id, label: `${c.full_name} · ${c.ref}`, hint: STATUS_LABELS[c.current_status], href: `/staff/client/${c.id}`,
        })));
      }
      if(!ctrl.signal.aborted)setSearching(false);
    }, 200);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, open]);

  const items = [...(q.trim().length >= 2 ? clients : []), ...pages.filter((p) => p.label.toLowerCase().includes(q.trim().toLowerCase()))];
  const go = (it: Item | undefined) => { if (!it) return; setOpen(false); setQ(""); router.push(it.href); };

  if (!open) return <button type="button" onClick={() => { opener.current = document.activeElement as HTMLElement; setOpen(true); }} className="hidden rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-500 md:block" aria-label={t("Open command palette", "فتح لوحة الأوامر")}>{t("Search…", "بحث…")} <kbd className="ml-2 rounded bg-slate-100 px-1">⌘K</kbd></button>;

  return createPortal(<div className="royal-command-overlay fixed inset-0 z-[120] flex items-start justify-center bg-slate-950/70 px-4 pt-24" dir={dir} onMouseDown={() => setOpen(false)}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={t("Command palette", "لوحة الأوامر")} data-testid="command-palette" className="w-full max-w-xl overflow-hidden rounded-2xl border border-amber-300/30 bg-[#101f42]/95 text-slate-100 shadow-xl backdrop-blur-xl" onMouseDown={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-4 border-b border-amber-300/15 px-4 py-3"><span className="text-xs font-semibold text-amber-100">{t("Command palette", "لوحة الأوامر")}</span><button type="button" className="min-h-9 min-w-9 rounded-lg border border-white/10 text-slate-300" aria-label={t("Close command palette", "إغلاق لوحة الأوامر")} onClick={() => setOpen(false)}>×</button></div>
      <input ref={input} role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant={items[active] ? `cmdk-${items[active].id}` : undefined} className="w-full border-b border-amber-300/15 bg-transparent px-4 py-4 text-sm text-slate-100 outline-none placeholder:text-slate-400 focus:bg-white/[.02]" placeholder={t("Search clients or jump to a page…", "ابحث عن عميل أو انتقل إلى قسم…")} aria-label={t("Search commands and clients", "البحث في الأوامر والعملاء")} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); setClients([]);setSearching(e.target.value.trim().length>=2); }} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); } if (e.key === "Enter") { e.preventDefault(); go(items[active]); } }}/>
      <ul id="cmdk-list" role="listbox" className="max-h-80 overflow-y-auto py-1">{items.map((it, i) => <li key={it.id} id={`cmdk-${it.id}`} role="option" aria-selected={i === active} className={`flex cursor-pointer justify-between px-4 py-2 text-sm ${i === active ? "bg-teal-300/10 text-teal-100" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => go(it)}><span>{it.label}</span>{it.hint && <span className="text-xs text-slate-400">{it.hint}</span>}</li>)}{!items.length && <li className="px-4 py-3 text-sm text-slate-500">{searching ? t("Searching…", "جارٍ البحث…") : t("No matches.", "لا نتائج مطابقة.")}</li>}</ul>
    </div>
  </div>, document.body);
}
