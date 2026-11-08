"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { RoyalOption, RoyalSelect } from "@/components/forms/RoyalSelect";
import { ClientWorkflowControl } from "@/components/staff/ClientWorkflowControl";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { GlassReviewDialog } from "@/components/staff/smart/GlassReviewDialog";
import { publishMutation, RECOVERY_EVENT, subscribeResources } from "@/components/staff/realtime/update-bus";
import { dateOnly, dateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { CLIENT_STAGES } from "@/lib/client-lifecycle-filters";
import { WORKSITE_OPTIONS, type WorksiteChangeData, type WorksiteChangeRow } from "@/lib/worksite-change-schema";

type Tab = "pending" | "confirmed";
type Operation = "save_request" | "confirm" | "retry_email";
type Draft = {
  current_site_code: string; requested_site_code: string; final_site_code: string;
  shift_days: string; shift_start: string; shift_end: string; new_start_date: string; confirmed_at: string; expected_updated_at: string;
};
type Intent = { operation: Operation; body: Record<string, unknown>; client_id: string };
const RESOURCES = ["client_identity", "pipeline", "placement", "activity", "alerts"] as const;
const siteName = (code: string | null, fallback?: string | null) => WORKSITE_OPTIONS.find(site => site.code === code)?.name ?? fallback ?? "—";
const siteAddress = (code: string) => WORKSITE_OPTIONS.find(site => site.code === code)?.address ?? "";
const draftFrom = (row: WorksiteChangeRow): Draft => ({
  expected_updated_at: row.client_version, current_site_code: row.current_site_code ?? "", requested_site_code: row.requested_site_code ?? "",
  final_site_code: row.final_site_code ?? row.requested_site_code ?? "", shift_days: row.shift_days ?? "",
  shift_start: row.shift_start?.slice(0, 5) ?? "", shift_end: row.shift_end?.slice(0, 5) ?? "",
  new_start_date: row.new_start_date?.slice(0, 10) ?? "", confirmed_at: toLocalInput(row.confirmed_at ?? new Date()),
});

function WorksiteIcon({ kind = "route" }: { kind?: "route" | "check" | "search" | "file" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "search" ? <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></> : kind === "check" ? <><path d="m7 12 3 3 7-7"/><path d="M21 11v1a9 9 0 1 1-5.3-8.2"/></> : kind === "file" ? <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 14h8M8 18h5"/></> : <><circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M5 8v5a5 5 0 0 0 5 5h7M19 16V8a2 2 0 0 0-2-2h-5m3-3-3 3 3 3"/></>}
  </svg>;
}

function spotlight(event: PointerEvent<HTMLElement>) {
  if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--worksite-spot-x", `${event.clientX - bounds.left}px`);
  event.currentTarget.style.setProperty("--worksite-spot-y", `${event.clientY - bounds.top}px`);
}

function RoutePoint({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="worksite-change-route-point" data-tone={tone}><i aria-hidden="true"/><div><small>{label}</small><strong dir="auto">{value}</strong></div></div>;
}

function SiteSelect({ label, value, onChange, disabled, requireAddress = false }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean; requireAddress?: boolean }) {
  const { t } = useStaffLanguage();
  return <label className="worksite-change-field">{label}
    <RoyalSelect className="input" aria-label={label} value={value} required disabled={disabled} searchable onChange={event => onChange(event.target.value)}>
      <RoyalOption value="" labelAr="اختر موقع العمل">Choose worksite</RoyalOption>
      {WORKSITE_OPTIONS.map(site => <RoyalOption key={site.code} value={site.code} disabled={requireAddress && !site.address?.trim()}>{site.name}{site.code.startsWith("MI_LOC_") ? "" : ` · ${site.code}`}{requireAddress && !site.address?.trim() ? t(" · address not recorded", " · العنوان غير مسجل") : ""}</RoyalOption>)}
    </RoyalSelect>
    {value && <small dir="auto">{siteAddress(value) || "—"}</small>}
  </label>;
}

function Section({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return <section className="worksite-change-section"><h4><span>{number}</span>{title}</h4>{children}</section>;
}

export function WorksiteChangeCenter({ initial, viewerId }: { initial: WorksiteChangeData; viewerId: string }) {
  const { t, dir } = useStaffLanguage();
  const [data, setData] = useState(initial);
  const [dataTab, setDataTab] = useState<Tab>("pending");
  const [tab, setTab] = useState<Tab>("pending");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<WorksiteChangeRow | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [liveState, setLiveState] = useState("connecting");
  const selectedRef = useRef(selected);
  const draftStore = useRef<Record<string, Draft>>({});
  const busyRef = useRef(false);
  const intentRef = useRef<Intent | null>(null);
  const controls = useRef({ tab: "pending" as Tab, q: "", page: initial.page });
  const search = useRef<HTMLInputElement>(null);
  const fetched = useRef({ tab: "pending" as Tab, q: "" });
  const fetchSequence = useRef(0);
  const selectedSequence = useRef(0);
  const request = useRef<AbortController | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshQueued = useRef(false);
  const storageKey = `career-gate:worksite-drafts:${viewerId}`;
  const intentKey = `career-gate:worksite-intent:${viewerId}`;
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const persistDraft = useCallback(() => { try { sessionStorage.setItem(storageKey, JSON.stringify(draftStore.current)); } catch { /* The current draft remains in memory. */ } }, [storageKey]);
  const saveIntent = useCallback((next: Intent | null) => {
    intentRef.current = next; setIntent(next);
    try { if (next) sessionStorage.setItem(intentKey, JSON.stringify(next)); else sessionStorage.removeItem(intentKey); } catch { /* The current operation remains in memory. */ }
  }, [intentKey]);
  useEffect(() => {
    let frame: number | null = null;
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) draftStore.current = stored;
      const saved = JSON.parse(sessionStorage.getItem(intentKey) ?? "null") as Intent | null;
      if (saved?.client_id && saved.body?.operation_id && ["save_request", "confirm", "retry_email"].includes(saved.operation)) { intentRef.current = saved; frame = requestAnimationFrame(() => setIntent(saved)); }
    } catch { /* Ignore invalid local drafts. */ }
    return () => { if (frame !== null) cancelAnimationFrame(frame); };
  }, [storageKey, intentKey]);

  const refresh = useCallback(async (nextPage = controls.current.page) => {
    if (busyRef.current) return null;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const sequence = ++fetchSequence.current;
    const requestedTab = controls.current.tab;
    const params = new URLSearchParams({ tab: requestedTab, q: controls.current.q, page: String(nextPage) });
    setLoading(true);
    try {
      const response = await fetch(`/api/staff/worksite-changes?${params}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message ?? "Worksite changes are unavailable");
      if (sequence !== fetchSequence.current || controller.signal.aborted) return null;
      const next = result.data as WorksiteChangeData;
      controls.current.page = next.page; setData(next); setDataTab(requestedTab); setStale(false);
      const current = selectedRef.current;
      if (current && current.status !== "confirmed") {
        const updated = next.rows.find(row => current.id ? row.id === current.id : row.client_id === current.client_id);
        if (updated) setSelected(updated);
      }
      return next;
    } catch { if (!controller.signal.aborted) setStale(true); return null; }
    finally { if (sequence === fetchSequence.current) setLoading(false); }
  }, []);

  const reloadSelected = useCallback(async (row: WorksiteChangeRow, kind: Tab = row.status === "confirmed" ? "confirmed" : "pending") => {
    const sequence = ++selectedSequence.current;
    const params = new URLSearchParams({ tab: kind, q: row.ref, page: "1" });
    const response = await fetch(`/api/staff/worksite-changes?${params}`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error?.message ?? "The latest file is unavailable");
    const next = (result.data as WorksiteChangeData).rows.find(item => row.id ? item.id === row.id : item.client_id === row.client_id);
    const current = selectedRef.current;
    if (next && sequence === selectedSequence.current && current?.client_id === row.client_id && current.id === row.id) { setSelected(next); selectedRef.current = next; }
    return next ?? null;
  }, []);

  const scheduleRefresh = useCallback(() => {
    refreshQueued.current = true;
    if (refreshTimer.current !== null) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      // A mutation owns the record until it finishes. Keep this queued so its
      // completion (or the resulting mutation event) flushes one fresh read.
      if (busyRef.current || !refreshQueued.current) return;
      refreshQueued.current = false;
      void refresh();
      const row = selectedRef.current;
      if (row?.status === "confirmed") void reloadSelected(row).catch(() => setStale(true));
    }, 100);
  }, [refresh, reloadSelected]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const q = query.trim();
      if (fetched.current.tab === tab && fetched.current.q === q) return;
      fetched.current = { tab, q }; controls.current = { tab, q, page: 1 }; void refresh(1);
    }, fetched.current.tab === tab ? 250 : 0);
    return () => clearTimeout(timer);
  }, [tab, query, refresh]);
  useEffect(() => {
    const unsubscribe = subscribeResources({ clientId: null, resources: RESOURCES, onUpdate: scheduleRefresh });
    const visible = () => {
      if (document.visibilityState !== "visible") return;
      scheduleRefresh();
    };
    const stateChanged = (event: Event) => { const next = (event as CustomEvent<{ state?: string }>).detail?.state; if (next) setLiveState(next); };
    const observed = requestAnimationFrame(() => { const state = document.querySelector('[data-testid="realtime-state"]')?.getAttribute("data-state"); if (state) setLiveState(state); });
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || selectedRef.current) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.matches("input,textarea,select") || target.isContentEditable)) return;
      event.preventDefault(); search.current?.focus();
    };
    window.addEventListener("career-gate:realtime-state", stateChanged);
    window.addEventListener("focus", visible); document.addEventListener("visibilitychange", visible); window.addEventListener(RECOVERY_EVENT, visible); window.addEventListener("keydown", shortcut);
    return () => { unsubscribe(); request.current?.abort(); cancelAnimationFrame(observed); if (refreshTimer.current !== null) clearTimeout(refreshTimer.current); refreshTimer.current = null; window.removeEventListener("career-gate:realtime-state", stateChanged); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); window.removeEventListener(RECOVERY_EVENT, visible); window.removeEventListener("keydown", shortcut); };
  }, [scheduleRefresh]);

  const open = (row: WorksiteChangeRow) => {
    selectedSequence.current++;
    setSelected(row); selectedRef.current = row;
    setDraft({ ...draftFrom(row), ...draftStore.current[row.client_id] }); setError(""); setNotice(""); setConflict(false);
  };
  const updateDraft = (patch: Partial<Draft>) => {
    if (!selected || !draft || busyRef.current || intentRef.current?.client_id === selected.client_id) return;
    const next = { ...draft, ...patch }; setDraft(next); draftStore.current[selected.client_id] = next; persistDraft();
  };
  const close = () => { if (!busyRef.current) { selectedSequence.current++; setSelected(null); selectedRef.current = null; setError(""); setConflict(false); } };

  async function submit(operation: Operation) {
    if (!selected || !draft || busyRef.current || conflict) return;
    if (intentRef.current && intentRef.current.client_id !== selected.client_id) { setError(t("Resolve the interrupted operation before changing another file.", "تحقق من العملية المنقطعة قبل تعديل ملف آخر.")); return; }
    let nextIntent = intentRef.current;
    if (!nextIntent) {
      const body: Record<string, unknown> = { operation, client_id: selected.client_id, operation_id: crypto.randomUUID(), expected_updated_at: operation === "retry_email" ? selected.client_version : draft.expected_updated_at };
      if (operation === "retry_email") body.change_id = selected.id;
      else {
        if (!draft.current_site_code || !draft.requested_site_code) { setError(t("Choose the current and requested worksites.", "اختر موقع العمل الحالي والموقع المطلوب.")); return; }
        Object.assign(body, { current_site_code: draft.current_site_code, requested_site_code: draft.requested_site_code });
        if (operation === "confirm") {
          if (!draft.final_site_code || !draft.shift_days.trim() || !draft.shift_start || !draft.shift_end || !draft.new_start_date || !draft.confirmed_at) { setError(t("Complete the final site, shift, start date, and confirmation time.", "أكمل الموقع النهائي والشفت وموعد البداية ووقت التأكيد.")); return; }
          const instant = fromLocalInput(draft.confirmed_at);
          if (!Number.isFinite(instant.getTime()) || toLocalInput(instant) !== draft.confirmed_at) { setError(t("Choose a valid confirmation time in Detroit time.", "اختر وقت تأكيد صحيحًا بتوقيت ديترويت.")); return; }
          Object.assign(body, { final_site_code: draft.final_site_code, shift_days: draft.shift_days.trim(), shift_start: draft.shift_start, shift_end: draft.shift_end, new_start_date: draft.new_start_date, confirmed_at: instant.toISOString() });
        }
      }
      nextIntent = { operation, client_id: selected.client_id, body }; saveIntent(nextIntent);
    }
    busyRef.current = true; request.current?.abort(); fetchSequence.current++; selectedSequence.current++; setBusy(true); setError(""); setNotice("");
    let published = false;
    try {
      const response = await fetch("/api/staff/worksite-changes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextIntent.body), signal: AbortSignal.timeout(25000) });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) {
          saveIntent(null); if (response.status === 409 && ["client_changed", "already_confirmed", "worksite_file_not_active"].includes(result?.error?.code)) setConflict(true);
        }
        throw new Error(result?.error?.message ?? t("The update could not be confirmed. Retry the same operation.", "تعذر التحقق من التحديث. أعد محاولة العملية نفسها."));
      }
      saveIntent(null);
      if (nextIntent.operation === "confirm") {
        delete draftStore.current[selected.client_id]; persistDraft();
        setNotice(t("Worksite confirmed. The notification status and workflow routing are shown below.", "تم تأكيد الموقع. تظهر حالة الإشعار وخيارات نقل الملف أدناه."));
      } else setNotice(nextIntent.operation === "save_request" ? t("Requested worksite saved.", "تم حفظ الموقع المطلوب.") : t("Email retry recorded. Its status will update here.", "سُجّلت إعادة محاولة الإرسال. ستتحدث حالتها هنا."));
      const returnedRow = result.row as WorksiteChangeRow | undefined;
      if (returnedRow) {
        selectedSequence.current++;
        setSelected(returnedRow); selectedRef.current = returnedRow;
        const nextDraft = { ...draft, expected_updated_at: returnedRow.client_version }; setDraft(nextDraft);
        if (nextIntent.operation !== "confirm") { draftStore.current[selected.client_id] = nextDraft; persistDraft(); }
      }
      else await reloadSelected(selected, nextIntent.operation === "confirm" ? "confirmed" : undefined);
      published = publishMutation("worksite_change", selected.client_id) === null;
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Connection interrupted. Retry to verify the same operation.", "انقطع الاتصال. أعد المحاولة للتحقق من العملية نفسها.")); }
    finally {
      busyRef.current = false; setBusy(false); setLoading(false);
      // Successful changes already publish to this surface's coalesced bus.
      // Avoid a second eager read before that same event is delivered.
      if (!published) scheduleRefresh();
    }
  }

  async function latest() {
    if (!selected || busyRef.current) return;
    setError(""); setBusy(true); busyRef.current = true; request.current?.abort(); fetchSequence.current++; selectedSequence.current++;
    try {
      const current = await reloadSelected(selected);
      if (!current) { setError(t("This file is no longer active here. Open its full record to see its current workflow.", "لم يعد الملف نشطًا في هذا القسم. افتح ملفه الكامل للاطلاع على موقعه الحالي.")); return; }
      setConflict(false);
      if (draft) { const next = { ...draft, expected_updated_at: current.client_version }; setDraft(next); draftStore.current[current.client_id] = next; persistDraft(); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("The latest record is unavailable.", "تعذر تحميل السجل الأحدث.")); }
    finally { busyRef.current = false; setBusy(false); setLoading(false); scheduleRefresh(); }
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.page_size));
  const switchingTab = dataTab !== tab;
  const visibleRows = switchingTab ? [] : data.rows;
  const surfaceLoading = loading || (switchingTab && !stale);
  const selectedIntent = selected && intent?.client_id === selected.client_id ? intent : null;
  const formDisabled = busy || !!selectedIntent || selected?.status === "confirmed";
  const notification = (row: WorksiteChangeRow) => row.notification_status === "sent" ? t("Sent", "تم الإرسال") : row.notification_status === "queued" ? t("Queued for sending", "في قائمة الإرسال") : row.notification_status === "sending" ? t("Sending…", "جارٍ الإرسال…") : row.notification_status === "failed" ? t("Sending failed", "تعذر الإرسال") : row.notification_status === "not_configured" ? t("Email service unavailable", "خدمة البريد غير مهيأة") : t("Not sent", "لم يُرسل");
  const workflowName = (location: string) => {
    const stage = CLIENT_STAGES.find(item => item.id === location);
    return stage ? t(stage.label, stage.labelAr) : location === "manager" ? t("Manager’s Task Center", "مركز مهام المدير") : location.replaceAll("_", " ");
  };

  return <section className="worksite-change-center" dir={dir} data-testid="worksite-change-center">
    <header className="worksite-change-heading"><div><span className="worksite-change-kicker">CAREER GATE · WORKSITE TRANSITIONS</span><h1>{t("Worksite changes", "عملاء نجحوا ويريدون تغيير موقع العمل")}</h1><div className="worksite-change-signature">{t("Salah Almoraisy Department", "قسم صلاح المريسي")}</div><p>{t("One client file. A clear destination. Every confirmation recorded.", "ملف واحد للعميل. وجهة واضحة. وتأكيد موثّق لكل تغيير.")}</p></div>
      <span className="worksite-change-connection" data-state={stale ? "offline" : liveState} role="status"><i aria-hidden="true"/>{stale ? t("Refresh unavailable", "تعذر التحديث") : liveState === "live" ? t("Live", "مباشر") : liveState === "connecting" ? t("Connecting…", "جارٍ الاتصال…") : t("Connection unverified", "الاتصال غير متحقق")}</span>
    </header>
    <div className="worksite-change-overview"><div className="worksite-change-metric"><WorksiteIcon/><div><strong>{data.counts.pending.toLocaleString("en-US")}</strong><small>{t("Awaiting worksite change", "بانتظار تغيير الموقع")}</small></div></div><div className="worksite-change-metric"><WorksiteIcon kind="check"/><div><strong>{data.counts.confirmed.toLocaleString("en-US")}</strong><small>{t("Recorded confirmations", "تغييرات مؤكدة وموثقة")}</small></div></div></div>
    <div className="worksite-change-toolbar"><div className="worksite-change-tabs" role="tablist" aria-label={t("Worksite change status", "حالة تغيير الموقع")}>
      {(["pending", "confirmed"] as const).map((key, index) => <button key={key} id={`worksite-tab-${key}`} data-testid={`worksite-tab-${key}`} role="tab" type="button" aria-selected={tab === key} aria-controls="worksite-change-results" tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)} onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const next = event.key === "Home" ? "pending" : event.key === "End" ? "confirmed" : index === 0 ? "confirmed" : "pending"; setTab(next); document.getElementById(`worksite-tab-${next}`)?.focus(); }}>{key === "pending" ? t("Awaiting worksite change", "بانتظار تغيير الموقع") : t("Confirmed changes", "تم تأكيد الموقع")}<b>{data.counts[key]}</b></button>)}
    </div><label className="worksite-change-search"><WorksiteIcon kind="search"/><input ref={search} type="search" aria-label={t("Search worksite changes", "البحث في تغييرات الموقع")} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("Client name, file or email…", "اسم العميل أو رقم الملف أو البريد…")} maxLength={100}/><kbd>/</kbd></label></div>
    {notice && !selected && <p role="status" className="worksite-change-notice">{notice}</p>}
    {intent && (!selected || selected.client_id !== intent.client_id) && <p className="worksite-change-notice" role="status">{t("An interrupted operation is retained. Open that client file to retry it safely.", "حُفظت عملية انقطع اتصالها. افتح ملف العميل لإعادة المحاولة بأمان.")}</p>}
    {stale && <div className="worksite-change-error" role="status">{t("The last saved data is shown. Refresh to check for new changes.", "تظهر آخر بيانات محفوظة. أعد التحديث للتحقق من التغييرات الجديدة.")} <button className="worksite-change-button" type="button" onClick={() => void refresh()}>{t("Refresh", "تحديث")}</button></div>}
    <div id="worksite-change-results" role="tabpanel" aria-labelledby={`worksite-tab-${tab}`} aria-busy={surfaceLoading}>
      <div className="worksite-change-grid">
        {surfaceLoading && visibleRows.length === 0 ? Array.from({ length: 3 }, (_, index) => <div key={index} className="worksite-change-skeleton" aria-hidden="true"><span/><span/><span/><span/></div>) : visibleRows.map(row => <article key={row.id ?? row.client_id} className="worksite-change-card" data-testid={`worksite-card-${row.client_id}`} onPointerMove={spotlight}>
          <div className="worksite-change-card-top"><span className="worksite-change-reference" dir="ltr">{row.ref}</span><span className="worksite-change-status" data-confirmed={row.status === "confirmed"}>{row.status === "confirmed" ? t("Confirmed", "مؤكد") : t("Awaiting change", "بانتظار التغيير")}</span></div>
          <div className="worksite-change-person"><span className="worksite-change-avatar" aria-hidden="true">{row.full_name.trim().split(/\s+/).slice(0, 2).map(name => name.charAt(0)).join("")}</span><div><h2 dir="auto">{row.full_name}</h2><p dir="auto">{row.email ?? t("No email recorded", "لا يوجد بريد مسجل")}</p></div></div>
          <div className="worksite-change-route"><RoutePoint label={row.status === "confirmed" ? t("Previous worksite", "الموقع السابق") : t("Current worksite", "الموقع الحالي")} value={siteName(row.current_site_code, row.current_site_name)}/><RoutePoint label={t("Requested worksite", "الموقع المطلوب")} value={siteName(row.requested_site_code, row.requested_site_name)} tone="requested"/>{row.status === "confirmed" && <RoutePoint label={t("Final confirmed worksite", "الموقع النهائي المؤكد")} value={siteName(row.final_site_code, row.final_site_name)} tone="confirmed"/>}</div>
          {row.status === "confirmed" && <p className="worksite-change-moved">{notification(row)}{row.sent_at ? ` · ${dateTime(row.sent_at)}` : ""}{row.operational_location !== "worksite_change" && <><br/>{t("Current workflow", "المسار الحالي")}: {workflowName(row.operational_location)}</>}</p>}
          <div className="worksite-change-card-foot"><button className="worksite-change-button" type="button" aria-label={`${t("Review worksite change", "مراجعة تغيير الموقع")} ${row.ref}`} onClick={() => open(row)}>{row.status === "confirmed" ? t("View confirmation", "عرض التأكيد") : t("Review change", "مراجعة التغيير")} <span aria-hidden="true">↗</span></button><Link href={`/staff/client/${row.client_id}`} prefetch={false}>{t("Full record", "الملف الكامل")} ↗</Link></div>
        </article>)}
      </div>
      {!surfaceLoading && !stale && visibleRows.length === 0 && <div className="worksite-change-empty"><WorksiteIcon kind={tab === "confirmed" ? "check" : "file"}/><h2>{query.trim() ? t("No matching files", "لا توجد ملفات مطابقة") : tab === "confirmed" ? t("No confirmations recorded yet", "لم تُسجل تأكيدات بعد") : t("No files waiting here", "لا توجد ملفات بانتظار التغيير")}</h2><p>{query.trim() ? t("Try another name, reference or email.", "جرّب اسمًا أو رقم ملف أو بريدًا آخر.") : t("Use Workflow routing in a client file to move it into Worksite Changes. Its original record and full history are retained.", "استخدم توجيه المسار من ملف العميل لنقله إلى قسم تغيير موقع العمل، مع حفظ سجله الأصلي وتاريخه كاملًا.")}</p></div>}
    </div>
    <footer className="worksite-change-page-foot"><span>{data.total.toLocaleString("en-US")} {t("matching records", "سجلًا مطابقًا")}{loading ? ` · ${t("Updating…", "جارٍ التحديث…")}` : ""}</span><div className="worksite-change-pagination"><button type="button" className="worksite-change-button" disabled={loading || data.page <= 1} onClick={() => void refresh(data.page - 1)}>{t("Previous", "السابق")}</button><span dir="ltr">{data.page} / {totalPages}</span><button type="button" className="worksite-change-button" disabled={loading || data.page >= totalPages} onClick={() => void refresh(data.page + 1)}>{t("Next", "التالي")}</button></div></footer>
    {selected && draft && <GlassReviewDialog title={t("Worksite change workspace", "مساحة تغيير موقع العمل")} drawer wide closeLabel={t("Close worksite change", "إغلاق تغيير الموقع")} onClose={close}>
      <div className="worksite-change-workspace" data-testid="worksite-change-workspace" dir={dir}>
        <header className="worksite-change-workspace-head"><div><span className="worksite-change-reference">{selected.ref}</span><h3 dir="auto">{selected.full_name}</h3><Link href={`/staff/client/${selected.client_id}`} prefetch={false}>{t("Open the complete client file", "فتح ملف العميل كاملًا")} ↗</Link></div><span className="worksite-change-status" data-confirmed={selected.status === "confirmed"}>{selected.status === "confirmed" ? t("Confirmed", "مؤكد") : t("Awaiting change", "بانتظار التغيير")}</span></header>
        {notice && <p role="status" className="worksite-change-notice">{notice}</p>}
        {error && <p role="alert" className="worksite-change-error">{error}</p>}
        {conflict && <button type="button" className="worksite-change-button" disabled={busy} onClick={() => void latest()}>{t("Reload latest record", "تحميل أحدث سجل")}</button>}
        {selectedIntent && <div className="worksite-change-notice" role="status">{t("The previous operation has not been verified. Retry uses the same request, preventing a duplicate confirmation or email.", "لم يُتحقق من العملية السابقة. تستخدم إعادة المحاولة الطلب نفسه لمنع تكرار التأكيد أو الإشعار.")} <button type="button" disabled={busy} className="worksite-change-button" onClick={() => void submit(selectedIntent.operation)}>{t("Verify previous operation", "التحقق من العملية السابقة")}</button></div>}
        {selected.status !== "confirmed" ? <>
          <Section number="01" title={t("Worksite request", "طلب تغيير الموقع")}><div className="worksite-change-field-grid"><SiteSelect label={t("Current worksite", "موقع العمل الحالي")} value={draft.current_site_code} disabled={formDisabled} onChange={value => updateDraft({ current_site_code: value })}/><SiteSelect label={t("Requested worksite", "موقع العمل المطلوب")} value={draft.requested_site_code} disabled={formDisabled} onChange={value => updateDraft({ requested_site_code: value, ...(!draft.final_site_code ? { final_site_code: value } : {}) })}/></div><div className="worksite-change-section-foot"><p>{t("Choose from the existing Amazon location directory. Requesting a site does not claim an available opening.", "اختر من دليل مواقع أمازون الموجود في النظام. اختيار الموقع المطلوب لا يعني توفر شاغر فيه.")}</p><button className="worksite-change-button" type="button" disabled={formDisabled || conflict} onClick={() => void submit("save_request")}>{busy ? t("Saving…", "جارٍ الحفظ…") : t("Save requested worksite", "حفظ الموقع المطلوب")}</button></div></Section>
          <Section number="02" title={t("Final worksite & shift confirmation", "تأكيد الموقع النهائي والشفت")}><div className="worksite-change-field-grid"><div className="worksite-change-field-wide"><SiteSelect label={t("Final confirmed worksite", "الموقع النهائي المؤكد")} value={draft.final_site_code} requireAddress disabled={formDisabled} onChange={value => updateDraft({ final_site_code: value })}/></div>
            <label className="worksite-change-field worksite-change-field-wide">{t("Shift days", "أيام العمل")}<input className="input" aria-label={t("Shift days", "أيام العمل")} value={draft.shift_days} disabled={formDisabled} onChange={event => updateDraft({ shift_days: event.target.value })} maxLength={200} placeholder={t("e.g. Wednesday – Saturday", "مثال: الأربعاء – السبت")} dir="auto"/></label>
            <label className="worksite-change-field">{t("Shift start time", "بداية الشفت")}<input className="input" type="time" aria-label={t("Shift start time", "بداية الشفت")} value={draft.shift_start} disabled={formDisabled} onChange={event => updateDraft({ shift_start: event.target.value })}/></label>
            <label className="worksite-change-field">{t("Shift end time", "نهاية الشفت")}<input className="input" type="time" aria-label={t("Shift end time", "نهاية الشفت")} value={draft.shift_end} disabled={formDisabled} onChange={event => updateDraft({ shift_end: event.target.value })}/></label>
            <label className="worksite-change-field">{t("New start date", "تاريخ بدء العمل الجديد")}<input className="input" type="date" aria-label={t("New start date", "تاريخ بدء العمل الجديد")} value={draft.new_start_date} disabled={formDisabled} onChange={event => updateDraft({ new_start_date: event.target.value })}/></label>
            <label className="worksite-change-field">{t("Confirmation date and time", "تاريخ ووقت التأكيد")}<input className="input" type="datetime-local" aria-label={t("Confirmation date and time", "تاريخ ووقت التأكيد")} value={draft.confirmed_at} disabled={formDisabled} onChange={event => updateDraft({ confirmed_at: event.target.value })}/><small>{t("All times: America/Detroit · worksite local time", "جميع الأوقات: America/Detroit · التوقيت المحلي لموقع العمل")}</small></label>
          </div><div className="worksite-change-section-foot"><p>{t("Confirm the location and schedule obtained for this client. The official notification uses the email saved in the client profile.", "أكد الموقع والجدول اللذين حصل عليهما العميل. يُرسل الإشعار الرسمي إلى البريد المحفوظ في ملف العميل.")} <span dir="auto">{selected.email ?? t("No email recorded", "لا يوجد بريد مسجل")}</span></p><button className="worksite-change-button worksite-change-button-primary" type="button" disabled={formDisabled || conflict} onClick={() => void submit("confirm")}>{busy ? t("Confirming…", "جارٍ التأكيد…") : t("Confirm worksite and notify client", "تأكيد الموقع وإشعار العميل")}</button></div></Section>
        </> : <>
          <Section number="01" title={t("Recorded worksite change", "تغيير الموقع الموثّق")}><div className="worksite-change-route"><RoutePoint label={t("Previous worksite", "الموقع السابق")} value={siteName(selected.current_site_code, selected.current_site_name)}/><RoutePoint label={t("Requested worksite", "الموقع المطلوب")} value={siteName(selected.requested_site_code, selected.requested_site_name)} tone="requested"/><RoutePoint label={t("Final confirmed worksite", "الموقع النهائي المؤكد")} value={`${siteName(selected.final_site_code, selected.final_site_name)}${selected.final_site_address ? ` · ${selected.final_site_address}` : ""}`} tone="confirmed"/></div><dl className="worksite-change-facts" style={{ marginTop: 18 }}><div><dt>{t("Shift days", "أيام العمل")}</dt><dd dir="auto">{selected.shift_days ?? "—"}</dd></div><div><dt>{t("Shift time · Detroit", "وقت الشفت · ديترويت")}</dt><dd dir="ltr">{selected.shift_start?.slice(0, 5) ?? "—"} – {selected.shift_end?.slice(0, 5) ?? "—"}</dd></div><div><dt>{t("New start date", "تاريخ بدء العمل الجديد")}</dt><dd>{dateOnly(selected.new_start_date)}</dd></div><div><dt>{t("Confirmation date and time", "تاريخ ووقت التأكيد")}</dt><dd>{dateTime(selected.confirmed_at)}</dd></div><div><dt>{t("Confirmed by", "أكد التغيير")}</dt><dd dir="auto">{selected.confirmed_by_name ?? "—"}</dd></div><div><dt>{t("System recording time", "وقت التوثيق في النظام")}</dt><dd>{dateTime(selected.recorded_at)}</dd></div></dl></Section>
          <Section number="02" title={t("Client email notification", "إشعار العميل عبر البريد")}><div className="worksite-change-notification"><p><strong>{notification(selected)}</strong><br/><span dir="auto">{selected.notification_recipient ?? selected.email ?? t("No email recorded", "لا يوجد بريد مسجل")}</span><br/>{t("Actual send time", "وقت الإرسال الفعلي")}: {dateTime(selected.sent_at)}</p>{["failed", "not_configured"].includes(selected.notification_status ?? "") && <button className="worksite-change-button" type="button" disabled={busy || !!selectedIntent || conflict} onClick={() => void submit("retry_email")}>{t("Retry email", "إعادة إرسال الإشعار")}</button>}</div>{selected.notification_error && <p className="worksite-change-error">{selected.notification_error}</p>}</Section>
          <Section number="03" title={t("Continue the client workflow", "استكمال مسار العميل")}>
            {selected.operational_location === "worksite_change" ? <><p className="worksite-change-moved">{t("Choose the next workflow destination, including Completed Files. The original file moves out of this department; this confirmation remains in its history.", "اختر وجهة المسار التالية، ومنها الملفات المكتملة. ينتقل الملف الأصلي خارج هذا القسم ويُحفظ التأكيد في تاريخه.")}</p><ClientWorkflowControl clientId={selected.client_id} status={selected.current_status} /></> : <p className="worksite-change-moved">{t("This is a historical confirmation. The file now belongs to", "هذا تأكيد محفوظ في السجل. موقع الملف الحالي")}: <strong>{workflowName(selected.operational_location)}</strong>. <Link href={`/staff/client/${selected.client_id}`} prefetch={false}>{t("Full record", "فتح الملف الحالي")} ↗</Link></p>}
          </Section>
        </>}
      </div>
    </GlassReviewDialog>}
  </section>;
}
