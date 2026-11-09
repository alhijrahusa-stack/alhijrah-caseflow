"use client";

import { ActionButton } from "@/components/ui/ActionButton";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RoyalOption, RoyalSelect } from "@/components/forms/RoyalSelect";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { useWorkspaceSearch } from "@/components/staff/WorkspaceSearchProvider";
import { STATUS_LABELS, type Status } from "@/lib/domain";
import { WORKFLOW_GROUPS, SPECIAL_WORKFLOW_DESTINATIONS, PRIORITY_VIEW } from "@/lib/workflow-registry";
import { dateOnly } from "@/lib/format";
import { useStaff } from "./StaffContext";
import { acquireModalLayer, isTopModalLayer, releaseModalLayer } from "@/lib/modal-layer";

type Item = { id: string; label: string; hint?: string; href: string };
type ClientResult = { id: string; ref: string; full_name: string; current_status: Status; operational_location?: string; employment_confirmed?: boolean; actual_start_date?: string | null };

export function CommandPalette() {
  const pathname = usePathname();
  const { t, dir } = useStaffLanguage();
  const { isManager, activeStaff } = useStaff();
  const { query: q, scope, registry, modalOpen: open, setModalOpen: setOpen, setQuery, setScope, navigate, currentHref, allHref } = useWorkspaceSearch();
  const dialog = useRef<HTMLDivElement>(null);
  const [clients, setClients] = useState<Item[]>([]);
  const [clientQuery, setClientQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const modalToken = useRef(Symbol("command-palette"));
  const pages: Item[] = useMemo(() => [
    { id: "p-dash", label: t("Dashboard", "مركز القيادة"), href: "/staff" },
    { id: "p-pipeline", label: t("Pipeline", "مسار العمل"), href: "/staff/pipeline" },
    { id: "p-clients", label: t("All client records", "جميع سجلات العملاء"), href: "/staff/clients?view=all" },
    ...WORKFLOW_GROUPS.map(group => ({ id: `p-${group.id}`, label: t(group.label, group.labelAr), href: group.href })),
    { id: "p-urgent", label: t(PRIORITY_VIEW.label, PRIORITY_VIEW.labelAr), hint: t("Priority filter · keeps the actual stage", "فلتر أولوية · يحفظ المرحلة الفعلية"), href: PRIORITY_VIEW.href },
    ...SPECIAL_WORKFLOW_DESTINATIONS.map(destination => ({ id: `p-${destination.id}`, label: t(destination.label, destination.labelAr), href: destination.href })),
    { id: "p-tasks", label: t("Tasks · overdue", "المهام والمتأخرات"), href: "/staff/tasks?view=overdue" },
    { id: "p-fu", label: t("Follow-ups", "المتابعات"), href: "/staff/follow-ups" },
    { id: "p-docs", label: t("Documents needing action", "الوثائق المعلقة"), href: "/staff/clients?attention=documents" },
    ...activeStaff.map(member => ({ id: `s-${member.id}`, label: member.display_name, hint: t("Team load", "حمل الفريق"), href: `/staff/staff?tab=team&member=${member.id}` })),
    { id: "p-team", label: t("Staff · Team", "الفريق"), href: "/staff/staff?tab=team" },
    ...(isManager ? [
      { id: "p-manager", label: t("Manager's inbox", "صندوق وارد المدير"), href: "/staff/manager-inbox" },
      { id: "p-assign", label: t("Staff · Assignments", "توزيع الملفات"), href: "/staff/staff?tab=assignments" },
      { id: "p-finance", label: t("Accounting", "المالية والسداد"), href: "/staff/accounting" },
      { id: "p-new", label: t("New client", "إضافة عميل"), href: "/staff/new-client" },
      { id: "p-deleted", label: t("Deleted files · review and reason", "الملفات المحذوفة · المراجعة والسبب"), href: "/staff/archive" },
      { id: "p-audit", label: t("Audit alerts", "تنبيهات التدقيق"), href: "/staff/audit-alerts" },
      { id: "p-reports", label: t("Reports", "التقارير"), href: "/staff/reports" },
      { id: "p-settings", label: t("System settings", "إعدادات النظام"), href: "/staff/settings" },
      { id: "p-avail", label: t("Office availability", "أوقات المكتب"), href: "/staff/settings/availability" },
    ] : []),
    ...(["new_intake", "needs_review", "ready_to_apply", "application_in_progress", "screening_pending", "i9_available", "ready_for_first_day"] as Status[]).map(status => ({ id: `f-${status}`, label: `${t("Filter", "تصفية")}: ${STATUS_LABELS[status]}`, hint: t("Active clients", "ملفات نشطة"), href: `/staff/clients?view=active&status=${status}` })),
  ], [isManager, activeStaff, t]);

  useEffect(() => {
    const show = () => { setClients([]); setClientQuery(""); setFailed(false); if (!open) opener.current = document.activeElement as HTMLElement; setActive(0); setOpen(true); };
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) setOpen(false); else show();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("career-gate:open-command", show);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("career-gate:open-command", show); };
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const token = modalToken.current;
    acquireModalLayer(token);
    const timer = setTimeout(() => input.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isTopModalLayer(token)) return;
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
      if (event.key !== "Tab") return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('input,button,a[href],[tabindex="0"]') ?? [])].filter(control => control.getClientRects().length && !control.matches(":disabled"));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { const wasTop = isTopModalLayer(token); releaseModalLayer(token); clearTimeout(timer); document.removeEventListener("keydown", onKeyDown); if (wasTop && opener.current?.isConnected) opener.current.focus(); };
  }, [open, setOpen]);

  useEffect(() => {
    if (!open || scope !== "all" || q.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true); setFailed(false);
      try {
        const response = await fetch(`/api/staff/search?q=${encodeURIComponent(q.trim())}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !body?.ok) throw new Error("search_unavailable");
        if (!controller.signal.aborted) { setClientQuery(q.trim()); setClients((body.results as ClientResult[]).map(client => ({
          id: client.id, label: `${client.full_name} · ${client.ref}`,
          hint: client.operational_location === "completed"
            ? `${t("Confirmed Registry", "سجل التوظيف")} · ${client.employment_confirmed && client.actual_start_date ? dateOnly(client.actual_start_date) : t("Actual start not confirmed", "تأكيد المباشرة غير مسجل")}`
            : STATUS_LABELS[client.current_status], href: `/staff/client/${client.id}`,
        }))); }
      } catch { if (!controller.signal.aborted) { setClients([]); setFailed(true); } }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q, open, scope, t]);

  const term = q.trim();
  const items: Item[] = [
    ...(scope === "all" && term.length >= 2 && clientQuery === term ? clients : []),
    ...(term ? [{ id: "search-all", label: scope === "current" ? t("Apply search to this view", "تطبيق البحث على العرض الحالي") : t("Show all matching records · all years", "عرض جميع السجلات المطابقة · كل السنوات"), href: scope === "current" ? currentHref : allHref }] : []),
    ...pages.filter(page => page.label.toLowerCase().includes(term.toLowerCase())),
  ];
  const go = (item: Item | undefined) => { if (item) navigate(item.href); };
  if (!open) return null;
  return createPortal(<div className={`royal-command-overlay unified-command-overlay fixed inset-0 z-[300] flex items-start justify-center bg-slate-950/70 px-4 pt-24 ${pathname === "/staff/manager-inbox" ? "cg-spatial-command-overlay" : ""}`} dir={dir} onMouseDown={() => setOpen(false)}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={t("Command palette", "لوحة الأوامر")} data-testid="command-palette" className="unified-command-panel w-full max-w-xl overflow-hidden rounded-2xl border border-amber-300/30 bg-[#101f42]/95 text-slate-100 shadow-xl backdrop-blur-xl" onMouseDown={event => event.stopPropagation()}>
      <div className="unified-command-heading"><span>{t("Search and commands", "البحث والأوامر")}</span>{registry && <RoyalSelect className="workspace-command-scope" aria-label={t("Search scope", "نطاق البحث")} value={scope} onChange={event => { setScope(event.target.value === "current" ? "current" : "all"); setClients([]); setActive(0); }}><RoyalOption value="current">{t("This view", "العرض الحالي")}</RoyalOption><RoyalOption value="all">{t("All permitted files", "جميع الملفات المسموح بها")}</RoyalOption></RoyalSelect>}<ActionButton type="button" className="min-h-9 min-w-9 rounded-lg border border-white/10 text-slate-300" aria-label={t("Close command palette", "إغلاق لوحة الأوامر")} onClick={() => setOpen(false)}>×</ActionButton></div>
      <input ref={input} role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant={items[active] ? `cmdk-${items[active].id}` : undefined} className="w-full border-b border-amber-300/15 bg-transparent px-4 py-4 text-sm text-slate-100 outline-none placeholder:text-slate-400" placeholder={t("Search clients or jump to a page…", "ابحث عن عميل أو انتقل إلى قسم…")} aria-label={t("Search commands and clients", "البحث في الأوامر والعملاء")} value={q} onChange={event => { setQuery(event.target.value); setActive(0); setClients([]); setSearching(scope === "all" && event.target.value.trim().length >= 2); setFailed(false); }} onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        if (event.key === "ArrowDown") { event.preventDefault(); setActive(value => Math.max(0, Math.min(value + 1, items.length - 1))); }
        if (event.key === "ArrowUp") { event.preventDefault(); setActive(value => Math.max(value - 1, 0)); }
        if (event.key === "Enter") { event.preventDefault(); go(items[active]); }
      }}/>
      <ul id="cmdk-list" role="listbox" className="max-h-80 overflow-y-auto py-1">{items.map((item, index) => <li key={item.id} id={`cmdk-${item.id}`} role="option" aria-selected={index === active} className={`flex cursor-pointer justify-between gap-3 px-4 py-3 text-sm ${index === active ? "bg-teal-300/10 text-teal-100" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => go(item)}><span>{item.label}</span>{item.hint && <span className="text-xs text-slate-400">{item.hint}</span>}</li>)}{!items.length && <li className="px-4 py-3 text-sm text-slate-400">{searching ? t("Searching…", "جارٍ البحث…") : t("No matches.", "لا نتائج مطابقة.")}</li>}</ul>
      {failed && <p role="status" className="unified-command-error">{t("Client search is temporarily unavailable. Commands remain available.", "تعذر البحث مؤقتًا. أوامر التنقل متاحة.")}</p>}
    </div>
  </div>, document.body);
}
