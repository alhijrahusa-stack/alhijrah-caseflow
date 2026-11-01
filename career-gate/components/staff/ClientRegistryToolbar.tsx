"use client";

import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { RoyalOption, RoyalSelect } from "@/components/forms/RoyalSelect";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { STATUS_LABELS, STATUSES } from "@/lib/domain";
import { registryFilterValues, registryHighlightParts, type RegistryFilters } from "@/lib/registry-filters";

type Saved = { id: string; name: string; filters: RegistryFilters };

export function ClientSearchHighlight({value,query}:{value:string;query:string}) {
  return <>{registryHighlightParts(value,query).map((part,index) => part.match ? <mark className="registry-search-match" key={index}>{part.text}</mark> : part.text)}</>;
}

export function ClientRegistryToolbar({management,staff}:{management:boolean;staff:{id:string;display_name:string}[]}) {
  const { t } = useStaffLanguage();
  const router = useRouter();
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
  useEffect(()=>{
    if(query===(new URLSearchParams(params).get("q")??""))return;
    const timer=setTimeout(()=>{
      const next = new URLSearchParams(registryFilterValues(new URLSearchParams(params),management) as Record<string,string>);
      if(query.trim())next.set("q",query.trim());else next.delete("q");
      next.delete("page");
      startTransition(()=>router.replace(`/staff/clients?${next}`,{scroll:false}));
    },220);
    return()=>clearTimeout(timer);
  },[query,params,router,management]);

  function update(key:string,value:string) {
    const next=new URLSearchParams(registryFilterValues(new URLSearchParams(params),management) as Record<string,string>);
    if(value)next.set(key,value);else next.delete(key);
    if(query.trim())next.set("q",query.trim());else next.delete("q");
    next.delete("page");
    startTransition(()=>router.replace(`/staff/clients?${next}`,{scroll:false}));
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
  const clearHref=canonical.stage?`/staff/clients?stage=${canonical.stage}`:`/staff/clients?view=${canonical.view??"active"}`;
  const exportParams=new URLSearchParams(params);exportParams.delete("page");
  return <section className="registry-toolbar ops-glass-card" aria-label={t("Client search and filters","بحث العملاء والفلاتر")}>
    <form role="search" className="registry-search-form" onSubmit={event=>{event.preventDefault();update("q",query.trim());}}>
      <label className="registry-query"><span>{t("Search all matching files","البحث في جميع الملفات المطابقة")}</span><span className="registry-query-box"><span aria-hidden="true">⌕</span><input type="search" name="q" value={query} maxLength={100} onChange={event=>{setSearch({base:params,value:event.target.value});window.dispatchEvent(new CustomEvent("career-gate:registry-query",{detail:event.target.value}));}} placeholder={t("Reference, name, phone, email or extracted document field…","رقم الملف، الاسم، الهاتف، البريد أو بيانات الوثائق المستخرجة…")} aria-label={t("Search clients","بحث العملاء")} autoComplete="off"/></span></label>
      <label className="registry-filter"><span>{t("Status","الحالة")}</span><RoyalSelect name="status" aria-label={t("Status","الحالة")} value={searchParams.get("status")??""} onChange={event=>update("status",event.target.value)} className="input"><RoyalOption value="">{t("All statuses","جميع الحالات")}</RoyalOption>{STATUSES.map(status=><RoyalOption value={status} key={status}>{STATUS_LABELS[status]}</RoyalOption>)}</RoyalSelect></label>
      {management&&<label className="registry-filter"><span>{t("Specialist","الموظف المختص")}</span><RoyalSelect aria-label={t("Filter by specialist","فلترة حسب الموظف")} value={searchParams.get("assigned")??""} onChange={event=>update("assigned",event.target.value)} className="input"><RoyalOption value="">{t("All specialists","جميع الموظفين")}</RoyalOption><RoyalOption value="none">{t("Unassigned","غير معيّن")}</RoyalOption>{staff.map(member=><RoyalOption key={member.id} value={member.id}>{member.display_name}</RoyalOption>)}</RoyalSelect></label>}
      <button className="ops-primary-button" type="submit">{t("Apply","تطبيق")}</button><Link prefetch={false} href={clearHref} className="registry-clear">{t("Clear","مسح")}</Link>
    </form>
    <div className="registry-toolbar-meta"><p role="status" aria-live="polite">{pending?t("Searching all permitted files…","جارٍ البحث في الملفات المسموح بها…"):t("Searches identity and retained document extraction fields. Results stay in their current workflow stage.","البحث في الهوية والبيانات المستخرجة المحفوظة من الوثائق، مع الحفاظ على قسم الملف الحالي.")}</p><div className="registry-toolbar-actions"><button type="button" className="cg-command-button" aria-expanded={saveOpen} onClick={()=>setSaveOpen(value=>!value)}><span aria-hidden="true">☆</span> {t("Save filter","حفظ الفلتر")}</button><a className="cg-command-button" href={`/api/staff/clients/export?${exportParams}&format=xlsx`}>↓ Excel</a><a className="cg-command-button" href={`/api/staff/clients/export?${exportParams}&format=print`} target="_blank" rel="noopener noreferrer">↗ {t("Print / Save PDF","طباعة / حفظ PDF")}</a></div></div>
    {saveOpen&&<form className="registry-save-form" onSubmit={event=>{event.preventDefault();void saveFilter();}}><label><span>{t("Filter name","اسم الفلتر")}</span><input className="input" aria-label={t("Filter name","اسم الفلتر")} value={name} onChange={event=>setName(event.target.value)} maxLength={80} required placeholder={t("e.g. Unassigned intake files","مثلاً: ملفات استقبال غير معيّنة")}/></label><button type="submit" className="ops-primary-button" disabled={saving}>{saving?t("Saving…","جارٍ الحفظ…"):t("Save current filters","حفظ الفلاتر الحالية")}</button><button type="button" className="cg-command-button" onClick={()=>setSaveOpen(false)}>{t("Cancel","إلغاء")}</button></form>}
    {!!saved.length&&<div className="registry-saved-filters" aria-label={t("Saved filters","الفلاتر المحفوظة")}>{saved.map(item=><span className="registry-saved-filter" key={item.id}><Link href={`/staff/clients?${new URLSearchParams(item.filters as Record<string,string>)}`} prefetch={false}>☆ {item.name}</Link><button type="button" aria-label={`${t("Remove filter","حذف الفلتر")} ${item.name}`} onClick={()=>void removeFilter(item.id)}>×</button></span>)}</div>}
    {error&&<p role="alert" className="registry-error">{error}</p>}{notice&&<p role="status" className="royal-sync-toast">✓ {notice}</p>}
  </section>;
}

export function RegistryEmptyState({completed}:{completed:boolean}) {
  const {t}=useStaffLanguage();
  return <EmptyState title={completed?t("No completed clients","لا توجد ملفات مكتملة"):t("No matching clients","لا توجد ملفات مطابقة")} text={t("No client records match this filtered registry view.","لا توجد سجلات عملاء تطابق الفلاتر الحالية.")}/>;
}

export function RegistryPaginationSummary({total,page,pages}:{total:number;page:number;pages:number}) {
  const {t}=useStaffLanguage();
  return <span data-testid="client-total">{t(`${total} client${total===1?"":"s"} · page ${page} of ${pages}`,`${total} عميل · الصفحة ${page} من ${pages}`)}</span>;
}
