"use client";

import { ActionButton } from "@/components/ui/ActionButton";

import { useEffect, useId, useRef, useState } from "react";
import { RoyalOption, RoyalSelect } from "@/components/forms/RoyalSelect";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { useWorkspaceSearch } from "@/components/staff/WorkspaceSearchProvider";
import { dateOnly } from "@/lib/format";
import { WORKFLOW_DESTINATIONS } from "@/lib/workflow-registry";

type Result = {
  id: string; ref: string; full_name: string; phone: string; email: string | null;
  current_status: string; pipeline_stage: string; next_step: string;
  assigned_name: string | null; staff_code: string | null; site_code: string | null;
  shift_code: string | null; payment_status: string | null; fee_amount: number | null;
  operational_location?: string; employment_confirmed?: boolean; actual_start_date?: string | null;
};
function pretty(value: string | null | undefined) { return value ? value.replace(/_/g, " ") : "—"; }

export function QuickClientSearch() {
  const { t } = useStaffLanguage();
  const { query: q, scope, registry, modalOpen, pending, setQuery, setScope, navigate, currentHref, allHref } = useWorkspaceSearch();
  const listId = useId();
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const visible = open && scope === "all" && !modalOpen && q.trim().length >= 2;

  useEffect(() => {
    const close = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  useEffect(() => {
    if (scope !== "all" || modalOpen || q.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setFailed(false); setResults([]);
      try {
        const response = await fetch(`/api/staff/search?q=${encodeURIComponent(q.trim())}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !body?.ok) throw new Error("search_unavailable");
        if (!controller.signal.aborted) { setResults(body.results); setActive(0); setOpen(true); }
      } catch {
        if (!controller.signal.aborted) { setResults([]); setFailed(true); setOpen(true); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q, scope, modalOpen]);

  function openCommands() {
    setOpen(false);
    window.dispatchEvent(new Event("career-gate:open-command"));
  }
  return <div ref={root} className="staff-quick-search unified-workspace-search" data-testid="workspace-search" inert={modalOpen || undefined} aria-hidden={modalOpen || undefined}>
    <div className="staff-quick-search-field">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
      <input type="search" value={q} maxLength={100}
        onFocus={() => { if (scope === "all" && q.trim().length >= 2) setOpen(true); }}
        onChange={event => { setQuery(event.target.value); setActive(0); setResults([]); setOpen(false); setLoading(false); setFailed(false); }}
        placeholder={t("Name, file, phone or document…", "الاسم، الملف، الهاتف أو بيانات الوثائق…")}
        aria-label={scope === "current" ? t("Search clients", "بحث العملاء") : t("Search all permitted clients", "البحث في جميع العملاء المسموح بهم")}
        role="combobox" aria-expanded={visible} aria-controls={visible ? listId : undefined} aria-autocomplete="list"
        aria-activedescendant={visible && results[active] ? `${listId}-${results[active].id}` : undefined}
        aria-busy={scope === "current" ? pending : loading && q.trim().length >= 2 && !modalOpen}
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
          if (event.key === "ArrowDown" && results.length) { event.preventDefault(); setOpen(true); setActive(value => Math.min(value + 1, results.length - 1)); }
          if (event.key === "ArrowUp" && results.length) { event.preventDefault(); setActive(value => Math.max(value - 1, 0)); }
          if (event.key === "Enter") { event.preventDefault(); setOpen(false); navigate(scope === "current" ? currentHref : visible && results[active] ? `/staff/client/${results[active].id}` : allHref); }
        }}/>
      {(scope === "current" ? pending : loading && q.trim().length >= 2 && !modalOpen) && <span className="staff-search-pulse" aria-hidden="true"/>}
      {registry && !modalOpen ? <RoyalSelect className="workspace-search-scope" aria-label={t("Search scope", "نطاق البحث")} value={scope} onChange={event => { setScope(event.target.value === "current" ? "current" : "all"); setOpen(false); setLoading(false); }}>
        <RoyalOption value="current">{t("This view", "العرض الحالي")}</RoyalOption><RoyalOption value="all">{t("All permitted files", "جميع الملفات المسموح بها")}</RoyalOption>
      </RoyalSelect> : <span className="workspace-search-scope-label">{t("All files", "كل الملفات")}</span>}
      <ActionButton type="button" className="workspace-search-shortcut" aria-label={t("Open command palette", "فتح لوحة الأوامر")} title={t("Commands and global search · Ctrl / Cmd + K", "الأوامر والبحث الشامل · Ctrl / Cmd + K")} onClick={openCommands}><kbd>⌘ K</kbd></ActionButton>
    </div>
    {visible && <div className="staff-search-results"><div id={listId} role="listbox" aria-label={t("Client search results", "نتائج البحث عن العملاء")}>
      {results.map((result, index) => <ActionButton key={result.id} type="button" className="staff-search-result" role="option" id={`${listId}-${result.id}`} aria-selected={active === index} onMouseEnter={() => setActive(index)} onClick={() => { setOpen(false); navigate(`/staff/client/${result.id}`); }}>
        <span className="staff-search-result-head"><span><strong dir="auto">{result.full_name}</strong><code dir="ltr">{result.ref}</code></span><span className="workspace-search-result-location">{result.operational_location === "completed" ? t("Confirmed Registry", "سجل التوظيف") : (() => { const destination = WORKFLOW_DESTINATIONS.find(item => item.id === result.operational_location); return destination ? t(destination.label, destination.labelAr) : result.operational_location === "manager" ? t("Manager review", "مراجعة المدير") : pretty(result.operational_location ?? result.pipeline_stage); })()}</span></span>
        <span className="staff-search-report workspace-search-report">
          <span><small>{t("Phone", "الهاتف")}</small><bdi dir="ltr">{result.phone}</bdi></span>
          <span><small>{t("Owner", "الموظف")}</small><bdi>{result.staff_code ? `${result.staff_code} · ` : ""}{result.assigned_name ?? t("Unassigned", "غير معيّن")}</bdi></span>
          <span><small>{t("Location", "الموقع")}</small><bdi dir="ltr">{result.site_code ?? "—"} · {result.shift_code ?? "—"}</bdi></span>
          <span><small>{t("Payment", "السداد")}</small><bdi dir="ltr">{result.payment_status === "paid" ? `${t("Paid", "مدفوع")} $${Number(result.fee_amount ?? 0).toFixed(0)}` : pretty(result.payment_status)}</bdi></span>
        </span>
        {result.operational_location === "completed" && <span className="workspace-search-result-meta">{result.employment_confirmed && result.actual_start_date ? `${t("Actual start", "المباشرة الفعلية")}: ${dateOnly(result.actual_start_date)}` : t("Actual start not confirmed", "تأكيد المباشرة غير مسجل")}</span>}
        <span className="staff-search-next"><span>{t("Next", "التالي")}</span>{result.next_step}</span>
      </ActionButton>)}</div>
      {!results.length && !loading && <div className="staff-search-empty" role="status">{failed ? t("Search is unavailable. Try again.", "تعذر البحث. أعد المحاولة.") : t("No matching client.", "لا يوجد عميل مطابق.")}</div>}
      <ActionButton type="button" className="workspace-search-all" onClick={() => { setOpen(false); navigate(allHref); }}>{t("Show all matching records · all years", "عرض جميع السجلات المطابقة · كل السنوات")} <span aria-hidden="true">↗</span></ActionButton>
    </div>}
  </div>;
}
