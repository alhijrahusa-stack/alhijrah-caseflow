"use client";

import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { RoyalOption, RoyalSelect } from "@/components/forms/RoyalSelect";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { useWorkspaceActions } from "@/components/staff/WorkspaceSearchProvider";
import { STATUS_LABELS, STATUSES } from "@/lib/domain";
import { registryFilterValues, registryHighlightParts, type RegistryFilters } from "@/lib/registry-filters";

type Saved = { id: string; name: string; filters: RegistryFilters };

export function ClientSearchHighlight({value,query}:{value:string;query:string}) {
  return <>{registryHighlightParts(value,query).map((part,index) => part.match ? <mark className="registry-search-match" key={index}>{part.text}</mark> : part.text)}</>;
}

export function ClientRegistryToolbar({management,staff,views,employmentYears=[]}:{management:boolean;staff:{id:string;display_name:string}[];views:{href:string;en:string;ar:string;active:boolean}[];employmentYears?:number[]}) {
  const { t } = useStaffLanguage();
  const { navigate, prepareNavigation } = useWorkspaceActions();
  const searchParams = useSearchParams();
  const params = searchParams.toString();
  const [search,setSearch] = useState({ value:searchParams.get("q") ?? "", base:params });
  const query=search.value;
  const [pending,startTransition] = useTransition();
  const [saved,setSaved] = useState<Saved[]>([]);
  const [saving,setSaving] = useState(false);
  const [saveOpen,setSaveOpen] = useState(false);
  const [name,setName] = useState("");
  const [notice,setNotice] = useState("");
  const [error,setError] = useState("");
  // Reconcile navigation during render using state alone. A newer uncommitted edit survives
  // an earlier search response, while back/forward navigation restores the committed query.
  if(search.base!==params) {
    const previousQuery=new URLSearchParams(search.base).get("q")??"";
    setSearch({base:params,value:search.value.trim()===previousQuery.trim()?searchParams.get("q")??"":search.value});
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/staff/saved-filters",{cache:"no-store",signal:controller.signal})
      .then(response=>response.json()).then(result=>{if(result.ok)setSaved(result.filters);})
      .catch(()=>{});
    return()=>controller.abort();
  },[]);
  useEffect(()=>{
    if(!notice)return;
    const timer=setTimeout(()=>setNotice(""),4000);
    return()=>clearTimeout(timer);
  },[notice]);
  useEffect(() => {
    const change = (event: Event) => setSearch(current=>({...current,value:String((event as CustomEvent<string>).detail??"")}));
    window.addEventListener("career-gate:registry-query",change);
    return()=>window.removeEventListener("career-gate:registry-query",change);
  },[]);

  function update(key:string,value:string) {
    const next=new URLSearchParams(registryFilterValues(new URLSearchParams(params),management) as Record<string,string>);
    if(value)next.set(key,value);else next.delete(key);
    if(key === "view") { next.delete("stage");next.delete("group");next.delete("urgent");if(value!=="completed"){next.delete("year");next.delete("confirmation");next.delete("sort");} }
    if(key === "year" && value && next.get("confirmation") === "unconfirmed") next.delete("confirmation");
    if(query.trim())next.set("q",query.trim());else next.delete("q");
    next.delete("page");
    startTransition(()=>navigate(`/staff/clients?${next}`,{replace:true,scroll:false}));
  }
  async function saveFilter() {
    if(!name.trim()||saving)return;
    setSaving(true);setError("");
    try {
      const next = new URLSearchParams(registryFilterValues(new URLSearchParams(params),management) as Record<string,string>);
      if(query.trim())next.set("q",query.trim());else next.delete("q");
      const response=await fetch("/api/staff/saved-filters",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim(),filters:registryFilterValues(next,management)})});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error?.message??"Could not save filter");
      setSaved(current=>[...current.filter(item=>item.id!==result.filter.id),result.filter].sort((a,b)=>a.name.localeCompare(b.name)));
      setSaveOpen(false);setName("");setNotice(t("Filter saved to your account","تم حفظ الفلتر في حسابك"));
    } catch(error) {setError(error instanceof Error?error.message:t("Could not save filter","تعذر حفظ الفلتر"));}
    finally {setSaving(false);}
  }
  async function removeFilter(id:string) {
    setError("");
    try {
      const response=await fetch("/api/staff/saved-filters",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error?.message??"Could not remove filter");
      setSaved(current=>current.filter(item=>item.id!==id));
    } catch(error) {setError(error instanceof Error?error.message:t("Could not remove filter","تعذر حذف الفلتر"));}
  }
  const canonical=registryFilterValues(new URLSearchParams(params),management);
  const clearParams=new URLSearchParams(canonical.view==="completed"?{view:"completed"}:canonical.stage?{stage:canonical.stage}:canonical.group?{group:canonical.group}:{view:canonical.view??"active"});
  const clearHref=`/staff/clients?${clearParams}`;
  const exportParams=new URLSearchParams(canonical as Record<string,string>);exportParams.delete("page");
  if(query.trim())exportParams.set("q",query.trim());else exportParams.delete("q");
  const priorityParams=new URLSearchParams(exportParams);priorityParams.set("view","active");priorityParams.delete("stage");priorityParams.delete("group");priorityParams.delete("year");priorityParams.delete("confirmation");priorityParams.delete("sort");
  if(canonical.urgent)priorityParams.delete("urgent");else priorityParams.set("urgent","1");
  const isFinal=canonical.view==="completed";
  const scope=views.find(view=>view.active);
  const searching=pending || query.trim()!==(searchParams.get("q")??"").trim();
  return <section className="registry-toolbar registry-command-deck registry-unified-toolbar ops-glass-card" data-testid="client-registry-toolbar" data-management={management} aria-label={t("Client search and filters","بحث العملاء والفلاتر")}>
    <div className="registry-toolbar-top">
      <span className="registry-scope-label">{scope?t(scope.en,scope.ar):t("Clients Registry","سجل العملاء")}</span>
      <div className="registry-compact-tools">
        {!isFinal&&<Link prefetch={false} href={`/staff/clients?${priorityParams}`} onNavigate={()=>prepareNavigation(`/staff/clients?${priorityParams}`)} className="cg-command-button registry-priority-filter" data-active={!!canonical.urgent} aria-current={canonical.urgent?"page":undefined}>✦ {t("Urgent","أولوية قصوى")}</Link>}
        <details className="registry-filter-details" data-testid="registry-filters" onKeyDown={event=>{if(event.key==="Escape"){event.currentTarget.open=false;event.currentTarget.querySelector("summary")?.focus();}}}>
          <summary className="cg-command-button">⌘ {t("Filters","فلاتر")}</summary>
          <div className="registry-filter-popover">
            <label className="registry-filter"><span>{t("Records view","عرض السجلات")}</span><RoyalSelect aria-label={t("Records view","عرض السجلات")} value={canonical.view??"active"} onChange={event=>update("view",event.target.value)} className="input">
              {views.map(view=>{const value=new URL(view.href,"https://career-gate.invalid").searchParams.get("view")??"active";return <RoyalOption key={value} value={value}>{t(view.en,view.ar)}</RoyalOption>;})}
            </RoyalSelect></label>
            <label className="registry-filter"><span>{t("Status","الحالة")}</span><RoyalSelect name="status" aria-label={t("Status","الحالة")} value={searchParams.get("status")??""} onChange={event=>update("status",event.target.value)} className="input"><RoyalOption value="">{t("All statuses","جميع الحالات")}</RoyalOption>{STATUSES.map(status=><RoyalOption value={status} key={status}>{STATUS_LABELS[status]}</RoyalOption>)}</RoyalSelect></label>
            {management&&<label className="registry-filter"><span>{t("Specialist","الموظف المختص")}</span><RoyalSelect aria-label={t("Filter by specialist","فلترة حسب الموظف")} value={searchParams.get("assigned")??""} onChange={event=>update("assigned",event.target.value)} className="input"><RoyalOption value="">{t("All specialists","جميع الموظفين")}</RoyalOption><RoyalOption value="none">{t("Unassigned","غير معيّن")}</RoyalOption>{staff.map(member=><RoyalOption key={member.id} value={member.id}>{member.display_name}</RoyalOption>)}</RoyalSelect></label>}
            {isFinal&&<>
              <label className="registry-filter"><span>{t("Employment year","سنة المباشرة")}</span><RoyalSelect aria-label={t("Employment year","سنة المباشرة")} value={canonical.year??""} onChange={event=>update("year",event.target.value)} className="input"><RoyalOption value="">{t("All years · unconfirmed included","جميع السنوات · تشمل غير المؤكد")}</RoyalOption>{employmentYears.map(year=><RoyalOption value={String(year)} key={year}>{year}</RoyalOption>)}</RoyalSelect></label>
              <label className="registry-filter"><span>{t("Start confirmation","تأكيد المباشرة")}</span><RoyalSelect aria-label={t("Start confirmation","تأكيد المباشرة")} value={canonical.confirmation??""} onChange={event=>{if(event.target.value==="unconfirmed"){const next=new URLSearchParams(exportParams);next.set("confirmation","unconfirmed");next.delete("year");next.delete("page");startTransition(()=>navigate(`/staff/clients?${next}`,{replace:true,scroll:false}));}else update("confirmation",event.target.value);}} className="input"><RoyalOption value="">{t("All records","جميع السجلات")}</RoyalOption><RoyalOption value="confirmed">{t("Actual start confirmed","المباشرة مؤكدة")}</RoyalOption><RoyalOption value="unconfirmed">{t("Actual start not confirmed","تأكيد المباشرة غير مسجل")}</RoyalOption></RoyalSelect></label>
              <label className="registry-filter"><span>{t("Sort records","ترتيب السجلات")}</span><RoyalSelect aria-label={t("Sort records","ترتيب السجلات")} value={canonical.sort??"updated"} onChange={event=>update("sort",event.target.value==="updated"?"":event.target.value)} className="input"><RoyalOption value="updated">{t("Recently updated","آخر تحديث")}</RoyalOption><RoyalOption value="started_desc">{t("Actual start · newest first","المباشرة · الأحدث أولًا")}</RoyalOption><RoyalOption value="started_asc">{t("Actual start · oldest first","المباشرة · الأقدم أولًا")}</RoyalOption></RoyalSelect></label>
              {canonical.year&&<p className="registry-filter-note">{t("Year filters use confirmed actual dates. Clear the year to include unconfirmed records.","فلتر السنة يعتمد تاريخ المباشرة المؤكد. امسح السنة لعرض السجلات غير المؤكدة.")}</p>}
            </>}
            <Link prefetch={false} href={clearHref} onNavigate={()=>{setSearch({base:params,value:""});prepareNavigation(clearHref);}} className="registry-clear">{t("Clear filters","مسح الفلاتر")}</Link>
          </div>
        </details>
        <details className="registry-actions" data-testid="registry-actions" onKeyDown={event=>{if(event.key==="Escape"){event.currentTarget.open=false;event.currentTarget.querySelector("summary")?.focus();}}}>
          <summary className="cg-command-button">{t("Actions","إجراءات")} ▾</summary>
          <div className="registry-actions-popover">
            <button type="button" className="cg-command-button" onClick={event=>{setSaveOpen(value=>!value);event.currentTarget.closest("details")?.removeAttribute("open");}}><span aria-hidden="true">☆</span> {t("Save filter","حفظ الفلتر")}</button>
            <a className="cg-command-button" href={`/api/staff/clients/export?${exportParams}&format=xlsx`}>↓ Excel</a>
            <a className="cg-command-button" href={`/api/staff/clients/export?${exportParams}&format=print`} target="_blank" rel="noopener noreferrer">↗ {t("Print / Save PDF","طباعة / حفظ PDF")}</a>
            {management&&<Link href="/staff/archive" prefetch={false} className="cg-command-button">{t("Deleted records","المحذوفات")}</Link>}
          </div>
        </details>
      </div>
    </div>
    {searching&&<p className="registry-toolbar-meta" role="status">{t("Updating filtered results…","جارٍ تحديث النتائج…")}</p>}
    {saveOpen&&<form className="registry-save-form" onSubmit={event=>{event.preventDefault();void saveFilter();}}><label><span>{t("Filter name","اسم الفلتر")}</span><input className="input" aria-label={t("Filter name","اسم الفلتر")} value={name} onChange={event=>setName(event.target.value)} maxLength={80} required placeholder={t("e.g. Unassigned intake files","مثلاً: ملفات استقبال غير معيّنة")}/></label><button type="submit" className="ops-primary-button" disabled={saving}>{saving?t("Saving…","جارٍ الحفظ…"):t("Save current filters","حفظ الفلاتر الحالية")}</button><button type="button" className="cg-command-button" onClick={()=>setSaveOpen(false)}>{t("Cancel","إلغاء")}</button></form>}
    {!!saved.length&&<div className="registry-saved-filters" aria-label={t("Saved filters","الفلاتر المحفوظة")}>{saved.map(item=><span className="registry-saved-filter" key={item.id}><Link href={`/staff/clients?${new URLSearchParams(item.filters as Record<string,string>)}`} onNavigate={()=>{const href=`/staff/clients?${new URLSearchParams(item.filters as Record<string,string>)}`;setSearch({base:params,value:item.filters.q??""});prepareNavigation(href);}} prefetch={false}>☆ {item.name}</Link><button type="button" aria-label={`${t("Remove filter","حذف الفلتر")} ${item.name}`} onClick={()=>void removeFilter(item.id)}>×</button></span>)}</div>}
    {error&&<p role="alert" className="registry-error">{error}</p>}{notice&&<p role="status" className="royal-sync-toast">✓ {notice}</p>}
  </section>;
}

export function RegistryEmptyState({completed}:{completed:boolean}) {
  const {t}=useStaffLanguage();
  return <EmptyState title={completed?t("No registry records","لا توجد سجلات مطابقة"):t("No matching clients","لا توجد ملفات مطابقة")} text={t("No client records match this filtered registry view.","لا توجد سجلات عملاء تطابق الفلاتر الحالية.")}/>;
}

export function RegistryPaginationSummary({total,page,pages}:{total:number;page:number;pages:number}) {
  const {t}=useStaffLanguage();
  return <span data-testid="client-total">{t(`${total} client${total===1?"":"s"} · page ${page} of ${pages}`,`${total} عميل · الصفحة ${page} من ${pages}`)}</span>;
}
