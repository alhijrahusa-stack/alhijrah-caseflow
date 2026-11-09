"use client";

import { ActionButton } from "@/components/ui/ActionButton";

import { NavigationFeedback } from "@/components/ui/NavigationFeedback";
import Link from "next/link";
import { usePathname,useRouter,useSearchParams } from "next/navigation";
import { createContext,useContext,useEffect,useRef,useState,type ReactNode } from "react";
import type { ExecutiveSummary } from "@/lib/executive-summary";
import { RealtimeRefresher } from "@/components/staff/RealtimeRefresher";
import { RECOVERY_EVENT,subscribeResources } from "@/components/staff/realtime/update-bus";
import { timeOnly, toLocalInput } from "@/lib/format";
import { WORKFLOW_GROUPS, SPECIAL_WORKFLOW_DESTINATIONS, PRIORITY_VIEW } from "@/lib/workflow-registry";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { DeferredOperationalAssistant } from "@/components/staff/DeferredOperationalAssistant";
import { SessionDraftBoundary } from "@/components/staff/SessionDraftBoundary";
import { useWorkspaceActions } from "@/components/staff/WorkspaceSearchProvider";

const Context=createContext<ExecutiveSummary|null>(null);
export function useExecutiveSummary(){const value=useContext(Context);if(!value)throw new Error("Executive summary provider missing");return value;}

const NAVIGATION_PATHS: Record<string, ReactNode> = {
    "◈": <><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" /></>,
    "▥": <><path d="M4 3v18h17M8 16v-5M13 16V7M18 16V4" /></>,
    "↳": <><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 12h5l2 3h4l2-3h5M8 8h8"/></>,
    "♧": <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2"/></>,
    "☷": <><path d="m3 6 1 1 2-2M10 6h11M3 12h3M10 12h11M3 18h3M10 18h11"/></>,
    "↻": <><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/></>,
    "⌘": <><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M6 16a3 3 0 0 1 6 0M15 9h3M15 13h3"/></>,
    "＄": <><path d="M12 2v20M17 6H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H6"/></>,
    "▣": <><rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v12h14V8M9 12h6"/></>,
    "✧": <><path d="m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8L12 3Z"/></>,
    "＋": <path d="M12 4v16M4 12h16"/>,
  };

function NavigationIcon({ icon }: { icon: string }) {
  if (/^\d+$/.test(icon)) return <span className="royal-step-number">{icon}</span>;

  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{NAVIGATION_PATHS[icon] ?? <path d="M4 12h16"/>}</svg>;
}

function NavigationCount({ value, urgent = false }: { value: number | undefined; urgent?: boolean }) {
  const [seen, setSeen] = useState(value);
  const [revision, setRevision] = useState(0);
  if (seen !== value) { setSeen(value); setRevision(current => current + 1); }
  return <b className={`royal-nav-badge${urgent ? " royal-urgent-micro-badge" : ""}`} dir="ltr" aria-label={urgent ? `${value ?? 0} urgent files` : undefined}>
    {urgent && <span aria-hidden="true">✦</span>}<span key={revision} className={revision ? "royal-counter-changed" : undefined}>{value == null ? "—" : value.toLocaleString("en-US")}</span>
    {revision > 0 && <i key={`pulse-${revision}`} className="royal-counter-confirmed-pulse" aria-hidden="true"/>}
  </b>;
}

export function ExecutiveShell({initial,management,header,children}:{initial:ExecutiveSummary;management:boolean;header:ReactNode;children:ReactNode}){
  const { language, dir, t } = useStaffLanguage();
  const { prepareNavigation } = useWorkspaceActions();
  const [data,setData]=useState(initial);
  const [seed,setSeed]=useState(initial);
  if(seed!==initial){setSeed(initial);setData(initial);}
  const [collapsed,setCollapsed]=useState(false);
  const [mobile,setMobile]=useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const navigationTrigger = useRef<HTMLButtonElement>(null);
  const [stale,setStale]=useState(false);
  const [notice,setNotice]=useState("");
  const pathname=usePathname();
  const spatialMode=management&&pathname==='/staff/manager-inbox';
  const summaryPaused=useRef(spatialMode);
  const [navigationPath,setNavigationPath]=useState(pathname);
  if(navigationPath!==pathname){setNavigationPath(pathname);if(mobile)setMobile(false);}
  const params=useSearchParams();
  const currentStage=params.get("stage");
  const inFlight=useRef<AbortController|null>(null);
  const toastTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>()=>{if(toastTimer.current)clearTimeout(toastTimer.current);},[]);
  useEffect(() => {
    if (!mobile || spatialMode) return;
    const trigger = navigationTrigger.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => [...(sidebar.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),summary') ?? [])].filter(element => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setMobile(false); }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); trigger?.focus(); };
  }, [mobile,spatialMode]);
  const router=useRouter();
  useEffect(()=>{
    // The spatial manager view renders its own live aggregate and hides the
    // executive sidebar. Its focus/recovery events must not fetch that hidden summary.
    if(spatialMode){summaryPaused.current=true;return;}
    let disposed=false;let timer:ReturnType<typeof setTimeout>|null=null;let again=false;let financePending=false;
    const refresh=async()=>{
      if(document.visibilityState==='hidden'){again=true;return;}
      if(inFlight.current){again=true;return;}
      const controller=new AbortController();inFlight.current=controller;const financeChanged=financePending;financePending=false;
      try{
        const response=await fetch('/api/staff/dashboard-summary',{cache:'no-store',signal:controller.signal});
        const result=await response.json().catch(()=>null);
        if(!response.ok||!result?.ok||!result.summary)throw new Error('summary_unavailable');
        if(!disposed){summaryPaused.current=false;setData(result.summary);setStale(false);if(financeChanged){setNotice("finance_synced");if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setNotice(""),4500);}}
      }catch{if(!disposed)setStale(true);}
      finally{inFlight.current=null;if(again&&!disposed){again=false;queue();}}
    };
    const queue=()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>{timer=null;void refresh();},250);};
    const onExecutiveChange=(event:Event)=>{if((event as CustomEvent<{resources?:string[]}>).detail?.resources?.includes('finance'))financePending=true;queue();};
    const unsubscribe=pathname==='/staff'?subscribeResources({clientId:null,
      resources:['client_identity','pipeline','placement','finance','account','readiness','documents','appointments','tasks','followups','alerts','attention'],onUpdate:({resources})=>{if(resources.includes('finance'))financePending=true;queue();}}):()=>{};
    const visible=()=>{if(document.visibilityState==='visible')queue();};
    window.addEventListener('career-gate:executive-refresh',onExecutiveChange);
    window.addEventListener(RECOVERY_EVENT,queue);
    window.addEventListener('focus',visible);
    document.addEventListener('visibilitychange',visible);
    if(summaryPaused.current)queue();
    return()=>{disposed=true;unsubscribe();if(timer)clearTimeout(timer);inFlight.current?.abort();inFlight.current=null;
      window.removeEventListener('career-gate:executive-refresh',onExecutiveChange);window.removeEventListener(RECOVERY_EVENT,queue);
      window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);};
  },[pathname,spatialMode]);
  const active = (href: string) => {
    if (href === "/staff") return pathname === "/staff";
    const [path, query] = href.split("?");
    if (path !== pathname) return false;
    if (href === WORKFLOW_GROUPS[0].href && pathname === "/staff/clients" && !currentStage && !params.get("view") && !params.get("group") && params.get("urgent") !== "1") return true;
    if (href === WORKFLOW_GROUPS.find(group => group.id === "paperwork")?.href && ["payment_required", "paperwork_pending"].includes(currentStage ?? "")) return true;
    if (!query) return true;
    return [...new URLSearchParams(query)].every(([key, value]) => params.get(key) === value);
  };
  const nav = (label: string, arabic: string, href: string, icon: string, count?: number, urgentCount?: number, registry = false) => (
    <Link key={href} href={href} prefetch={false} aria-label={t(label, arabic)} aria-current={active(href) ? "page" : undefined}
      title={t(label, arabic)} onClick={() => setMobile(false)} onNavigate={() => prepareNavigation(href)} className={`royal-nav-item staff-nav-link${registry ? " royal-final-registry-link" : ""}`}>
      <NavigationFeedback /><span className="royal-nav-icon" aria-hidden="true"><NavigationIcon icon={icon}/></span>
      <span className="royal-nav-copy"><span>{t(label, arabic)}</span><small lang={language === "en" ? "ar" : "en"}>{t(arabic, label)}</small>{registry && <small className="royal-registry-year" title={t("Office year · choose a year inside the registry", "سنة المكتب · يمكن اختيار السنة داخل السجل")}>{/^\d{4}$/.test(params.get("year") ?? "") && (params.get("view") === "completed" || currentStage === "completed") ? params.get("year") : toLocalInput(data.generated_at).slice(0, 4)}</small>}</span>
      <span className="royal-nav-counts">{count != null && <NavigationCount value={count}/>}{urgentCount != null && urgentCount > 0 && <NavigationCount value={urgentCount} urgent/>}</span>
    </Link>
  );
  const ranked = [...data.team].sort((a, b) => b.overdue_tasks - a.overdue_tasks || (b.active_clients + b.open_tasks) - (a.active_clients + a.open_tasks)).slice(0, 3);
  const status = data.health?.status;
  const critical = status && status !== "HEALTHY";
  return <Context value={data}><div className="staff-shell royal-shell" data-collapsed={collapsed} data-spatial-mode={spatialMode} lang={language} dir={dir} data-testid="executive-shell">
    <span className="royal-mesh" aria-hidden="true" />
    <a className="royal-skip-link" href="#staff-main-content">{t("Skip to workspace", "الانتقال إلى مساحة العمل")}</a>
    {!spatialMode&&<><ActionButton ref={navigationTrigger} type="button" className="royal-mobile-toggle" aria-label={t("Open navigation", "فتح قائمة الأقسام")} aria-controls="royal-navigation" aria-expanded={mobile} onClick={() => setMobile(value => !value)}>☰</ActionButton>
    {mobile && <ActionButton type="button" className="royal-mobile-backdrop" aria-label={t("Close navigation", "إغلاق قائمة الأقسام")} onClick={() => setMobile(false)} />}
    <aside ref={sidebar} id="royal-navigation" className="royal-sidebar" data-open={mobile} aria-label={t("Executive navigation", "القائمة التنفيذية")}>
      <div className="royal-brand">
        <Link href="/staff" prefetch={false} aria-label="Career Gate">
          <span className="royal-crown" aria-hidden="true"><svg viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="m5 10 7 6 6-10 6 10 7-6-3 17H8L5 10Z"/><path d="M10 31h16M10 23h16"/><circle cx="5" cy="9" r="1.5"/><circle cx="18" cy="5" r="1.5"/><circle cx="31" cy="9" r="1.5"/></svg></span>
          <span className="royal-nav-copy" dir="ltr"><strong>CAREER GATE</strong><small>EXECUTIVE COMMAND</small></span>
        </Link>
        <ActionButton type="button" className="royal-mobile-close" aria-label={t("Close navigation", "إغلاق قائمة الأقسام")} onClick={() => setMobile(false)}>×</ActionButton>
        <ActionButton type="button" className="royal-collapse" aria-label={collapsed ? t("Expand sidebar", "توسيع الشريط الجانبي") : t("Collapse sidebar", "طي الشريط الجانبي")} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>⇆</ActionButton>
      </div>
      <nav aria-label={t("Staff operations", "أقسام العمل")} className="royal-nav">
        <p className="royal-group-label">{t("Executive", "القيادة التنفيذية")}</p>
        {nav("Dashboard", "مركز القيادة", "/staff", "◈")}
        {management && nav("Reports", "التقارير الاستراتيجية", "/staff/reports", "▥")}
        {management && nav("Manager's Inbox", "صندوق وارد المدير", "/staff/manager-inbox", "↳", undefined, data.manager_urgent)}
        <div className="royal-group-heading"><p className="royal-group-label">{t("Live workflow", "مسار العمل الحي")}</p><Link href={PRIORITY_VIEW.href} prefetch={false} className="royal-priority-quick-view" data-active={params.get("urgent") === "1" || currentStage === "urgent"} onClick={() => setMobile(false)} onNavigate={() => prepareNavigation(PRIORITY_VIEW.href)} aria-label={t("Urgent priority filter", "فلتر ملفات الأولوية القصوى")} title={t("Urgent priority · all active sections", "الأولوية القصوى · جميع الأقسام النشطة")}><span aria-hidden="true">✦</span><NavigationCount value={data.urgent_total}/></Link><Link href="/staff/pipeline" prefetch={false} aria-label={t("Pipeline", "مسار العمل")}>↗</Link></div>
        {WORKFLOW_GROUPS.map((group, index) => {
          const live = data.stages.find(stage => stage.id === group.id);
          return nav(group.label, group.labelAr, group.href, String(index + 1).padStart(2, "0"), live?.total, live?.urgent_count, group.sidebarOnly);
        })}
        {SPECIAL_WORKFLOW_DESTINATIONS.map(destination => nav(destination.label, destination.labelAr, destination.href, "⇄", data.worksite_total, data.worksite_urgent))}
        <p className="royal-group-label">{t("Operations", "العمليات")}</p>
        {nav("Staff", "حمل الفريق", "/staff/staff?tab=team", "♧")}
        {nav("Import Queue", "قائمة انتظار الاستيراد", "/staff/import", "⇄")}
        {nav("Tasks", "المهام والمتابعات", "/staff/tasks", "☷")}
        {nav("Follow-Ups", "المتابعات", "/staff/follow-ups", "↻")}
        {nav("Gate Job Account", "إدارة الحسابات", "/staff/gate-job-account", "⌘")}
      </nav>
      <section className="royal-sidebar-team" aria-label={t("Team load snapshot", "حمل الفريق المختصر")}>
        <p className="royal-group-label">{t("Team load now", "حمل الفريق الآن")}</p>
        {ranked.map(member => <Link key={member.id} href={`/staff/staff?tab=team&member=${member.id}`} prefetch={false} title={`${member.display_name} · ${member.active_clients} ${t("files", "ملفات")} · ${member.open_tasks} ${t("tasks", "مهام")}`}>
          <span className="royal-nav-copy"><bdi>{member.display_name}</bdi><small><bdi dir="ltr">{member.active_clients}</bdi> {t("files", "ملفات")} · <bdi dir="ltr">{member.open_tasks}</bdi> {t("tasks", "مهام")}</small></span>
          <span className={`royal-load-dot ${member.overdue_tasks ? "critical" : member.open_tasks > 8 ? "busy" : ""}`} aria-label={member.overdue_tasks ? t("Overdue tasks", "مهام متأخرة") : member.open_tasks > 8 ? t("Busy", "تحت ضغط") : t("Available", "متاح")} />
        </Link>)}
      </section>
      <Link className="royal-system" href={management ? "/staff/audit-alerts" : "/staff"} prefetch={false}>
        <span className={`royal-load-dot ${critical ? "critical" : ""}`} />
        <span className="royal-nav-copy">{status ? t(`SYSTEM ${status}`, status === "HEALTHY" ? "النظام متصل" : "النظام يحتاج مراجعة") : t("Operations sync", "مزامنة العمليات")}
          <small>{stale ? t("Update unavailable · retry", "تعذر التحديث · أعد المحاولة") : <><bdi dir="ltr">{data.health ? `DB ${data.health.db_ms} ms · ` : ""}{timeOnly(data.generated_at)}</bdi></>}</small>
        </span>
      </Link>
    </aside></>}
    <div className="royal-main"><header className="royal-topbar" hidden={spatialMode} inert={spatialMode} aria-hidden={spatialMode || undefined}>{header}{!pathname.startsWith("/staff/client/") && <RealtimeRefresher />}</header><main id="staff-main-content" className="royal-content" tabIndex={-1}>{children}</main></div>
    <ActionButton type="button" className="royal-orb" aria-label={management ? t("Open operational assistant", "فتح مساعد العمليات") : t("Open command assistant", "فتح مساعد الأوامر")} title={management ? t("Operational assistant", "مساعد العمليات") : t("Command assistant · Ctrl+K", "مساعد الأوامر · Ctrl+K")} onClick={() => window.dispatchEvent(new Event(management ? "career-gate:open-assistant" : "career-gate:open-command"))}>✧</ActionButton>
    <DeferredOperationalAssistant enabled={management}/>
    <SessionDraftBoundary/>
    {notice && <p role="status" className="royal-sync-toast">◈ {t("Finance and dashboard figures are up to date", "تمت مزامنة المالية ومؤشرات لوحة القيادة")}</p>}
    {stale && <ActionButton className="royal-stale" type="button" onClick={() => router.refresh()}>{t("Could not update summary · Retry", "تعذر تحديث المؤشرات · إعادة المحاولة")}</ActionButton>}
  </div></Context>;
}
