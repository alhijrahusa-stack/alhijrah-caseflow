"use client";

import Link from "next/link";
import { usePathname,useRouter,useSearchParams } from "next/navigation";
import { createContext,useContext,useEffect,useRef,useState,type ReactNode } from "react";
import type { ExecutiveSummary } from "@/lib/executive-summary";
import { RealtimeRefresher } from "@/components/staff/RealtimeRefresher";
import { RECOVERY_EVENT,subscribeResources } from "@/components/staff/realtime/update-bus";
import { timeOnly } from "@/lib/format";

const Context=createContext<ExecutiveSummary|null>(null);
export function useExecutiveSummary(){const value=useContext(Context);if(!value)throw new Error("Executive summary provider missing");return value;}

export function ExecutiveShell({initial,management,header,children}:{initial:ExecutiveSummary;management:boolean;header:ReactNode;children:ReactNode}){
  const [data,setData]=useState(initial);
  const [seed,setSeed]=useState(initial);
  if(seed!==initial){setSeed(initial);setData(initial);}
  const [collapsed,setCollapsed]=useState(false);
  const [mobile,setMobile]=useState(false);
  const [stale,setStale]=useState(false);
  const [notice,setNotice]=useState("");
  const pathname=usePathname();
  const params=useSearchParams();
  const currentStage=params.get("stage");
  const inFlight=useRef<AbortController|null>(null);
  const toastTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>()=>{if(toastTimer.current)clearTimeout(toastTimer.current);},[]);
  const router=useRouter();
  useEffect(()=>{
    let disposed=false;let timer:ReturnType<typeof setTimeout>|null=null;let again=false;let financePending=false;
    const refresh=async()=>{
      if(document.visibilityState==='hidden'){again=true;return;}
      if(inFlight.current){again=true;return;}
      const controller=new AbortController();inFlight.current=controller;const financeChanged=financePending;financePending=false;
      try{
        const response=await fetch('/api/staff/dashboard-summary',{cache:'no-store',signal:controller.signal});
        const result=await response.json().catch(()=>null);
        if(!response.ok||!result?.ok||!result.summary)throw new Error('summary_unavailable');
        if(!disposed){setData(result.summary);setStale(false);if(financeChanged){setNotice("تمت مزامنة المالية ومؤشرات لوحة القيادة");if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setNotice(""),4500);}}
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
    return()=>{disposed=true;unsubscribe();if(timer)clearTimeout(timer);inFlight.current?.abort();inFlight.current=null;
      window.removeEventListener('career-gate:executive-refresh',onExecutiveChange);window.removeEventListener(RECOVERY_EVENT,queue);
      window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);};
  },[pathname]);
  const active=(href:string)=>{
    if(href==='/staff')return pathname==='/staff';
    if(href==='/staff/clients')return pathname==='/staff/clients'&&!currentStage&&!params.get('view');
    const [path,query]=href.split('?');
    if(path!==pathname)return false;
    if(!query)return true;
    return [...new URLSearchParams(query)].every(([key,value])=>params.get(key)===value);
  };
  const nav=(label:string,arabic:string,href:string,icon:string,count?:number)=><Link key={href} href={href} prefetch={false} aria-label={label} aria-current={active(href)?'page':undefined}
    title={arabic} onClick={()=>setMobile(false)} className="royal-nav-item staff-nav-link"><span className="royal-nav-icon" aria-hidden="true">{icon}</span><span className="royal-nav-copy">{arabic}<small>{label}</small></span>{count!=null&&<b className="royal-nav-badge">{count}</b>}</Link>;
  const ranked=[...data.team].sort((a,b)=>b.overdue_tasks-a.overdue_tasks||(b.active_clients+b.open_tasks)-(a.active_clients+a.open_tasks)).slice(0,3);
  const status=data.health?.status??'LIVE';
  return <Context value={data}><div className="royal-shell" data-collapsed={collapsed}>
    <button type="button" className="royal-mobile-toggle" aria-label="فتح قائمة الأقسام" aria-expanded={mobile} onClick={()=>setMobile(value=>!value)}>☰</button>
    {mobile&&<button type="button" className="royal-mobile-backdrop" aria-label="إغلاق قائمة الأقسام" onClick={()=>setMobile(false)}/>}
    <aside className="royal-sidebar" data-open={mobile} dir="rtl" aria-label="القائمة التنفيذية">
      <div className="royal-brand"><Link href="/staff" prefetch={false} aria-label="Career Gate"><span className="royal-crown" aria-hidden="true">♛</span><span className="royal-nav-copy"><strong>CAREER GATE</strong><small>EXECUTIVE COMMAND</small></span></Link><button type="button" className="royal-collapse" aria-label="طي الشريط الجانبي" aria-expanded={!collapsed} onClick={()=>setCollapsed(value=>!value)}>⇆</button></div>
      <nav aria-label="Staff operations" className="royal-nav">
        <p className="royal-group-label">القيادة · EXECUTIVE</p>
        {nav('Dashboard','مركز القيادة','/staff','◈')}
        {management&&nav('Reports','التقارير الاستراتيجية','/staff/reports','▥')}
        <div className="royal-group-heading"><p className="royal-group-label">مسار العمل · WORKFLOW</p><Link href="/staff/pipeline" prefetch={false} aria-label="Pipeline">↗</Link></div>
        {data.stages.map((stage,index)=>nav(index===0?'Clients':stage.label,stage.labelAr,index===0?'/staff/clients':stage.href,String(index+1).padStart(2,'0'),stage.total))}
        <p className="royal-group-label">العمليات · OPERATIONS</p>
        {nav('Staff','حمل الفريق','/staff/staff?tab=team','♧')}
        {nav('Tasks','المهام والمتابعات','/staff/tasks','☷')}
        {nav('Follow-Ups','المتابعات','/staff/follow-ups','↻')}
        {nav('Gate Job Account','إدارة الحسابات','/staff/gate-job-account','⌘')}
        {management&&<details className="royal-tools"><summary>أدوات الإدارة <span>＋</span></summary>
          {nav('Accounting','دفتر المالية','/staff/accounting','＄')}
          {nav('Archive','الأرشيف المؤقت','/staff/archive','▣')}
          {nav('Smart Career Collect Client','الاستقبال الذكي','/staff/import','✧')}
          {nav('New Client','إضافة عميل','/staff/new-client','＋')}
        </details>}
      </nav>
      <section className="royal-sidebar-team" aria-label="حمل الفريق المختصر"><p className="royal-group-label">حمل الفريق الآن</p>{ranked.map(member=><Link key={member.id} href={`/staff/staff?tab=team&member=${member.id}`} prefetch={false} title={`${member.display_name} · ${member.active_clients} ملفات · ${member.open_tasks} مهام`}><span className="royal-nav-copy">{member.display_name}<small>{member.active_clients} ملفات · {member.open_tasks} مهام</small></span><span className={`royal-load-dot ${member.overdue_tasks?'critical':member.open_tasks>8?'busy':''}`}/></Link>)}</section>
      <Link className="royal-system" href={management?'/staff/audit-alerts':'/staff'} prefetch={false}><span className={`royal-load-dot ${status!=='HEALTHY'&&status!=='LIVE'?'critical':''}`}/><span className="royal-nav-copy">SYSTEM {status}<small>{stale?'تعذر التحديث — أعد المحاولة':`DB ${data.health?.db_ms??'—'} ms · ${timeOnly(data.generated_at)}`}</small></span></Link>
    </aside>
    <div className="royal-main"><header className="royal-topbar">{header}{!pathname.startsWith('/staff/client/')&&<RealtimeRefresher/>}</header><main className="royal-content">{children}</main></div>
    <button type="button" className="royal-orb" aria-label="فتح مساعد الأوامر" title="مساعد الأوامر · Ctrl+K" onClick={()=>{window.dispatchEvent(new Event('career-gate:open-command'));}}>✧</button>
    {notice&&<p role="status" className="royal-sync-toast">◈ {notice}</p>}
    {stale&&<button className="royal-stale" type="button" onClick={()=>router.refresh()}>تعذر تحديث المؤشرات · إعادة المحاولة</button>}
  </div></Context>;
}
