"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useExecutiveSummary } from "@/components/staff/ExecutiveShell";
import { useStaff } from "@/components/staff/StaffContext";
import { useTargetedMutationBatch } from "@/components/staff/realtime/useTargetedMutation";

const currency=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value);
const kindLabels:Record<string,string>={appointment_repair:'حالة موعد بلا حجز نشط — يلزم تصحيح الربط',payment_overdue:'نجح بالمقابلة — متابعة المستحقات',schedule_interview:'جاهز — يحتاج حجز مقابلة',document_review:'وثائق معلقة — تحتاج تدقيقًا'};

export function OperationalDashboard(){
  const data=useExecutiveSummary();
  const {isManager}=useStaff();
  const [selected,setSelected]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [failed,setFailed]=useState(false);
  const router=useRouter();
  const changed=useTargetedMutationBatch();
  const team=[...data.team].sort((a,b)=>b.overdue_tasks-a.overdue_tasks||(b.active_clients+b.open_tasks)-(a.active_clients+a.open_tasks));
  const maximum=Math.max(1,...team.map(member=>member.active_clients+member.open_tasks));
  async function assign(clientId:string,staffId:string){
    if(!isManager||busy||!data.priorities.some(client=>client.id===clientId))return;
    setBusy(true);setMessage('');setFailed(false);
    try{
      const response=await fetch('/api/staff/operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'reassign_client',client_id:clientId,staff_id:staffId,reason:'Assigned from Executive Command Center',task_ids:[]}),signal:AbortSignal.timeout(20000)});
      const body=await response.json().catch(()=>null);
      if(!response.ok||!body?.ok)throw new Error(body?.error?.message??'تعذر تعيين الملف');
      setSelected(null);setMessage('تم تعيين الملف وتسجيل العملية');changed('reassign_client',[clientId]);router.refresh();
    }catch(error){setFailed(true);setMessage(error instanceof Error?error.message:'تعذر الاتصال');}finally{setBusy(false);}
  }
  return <div className="royal-dashboard" dir="rtl">
    <header className="royal-page-heading"><div><p className="royal-eyebrow">CAREER GATE · ROYAL EXECUTIVE</p><h1>Operations Command Center</h1><p>مركز القيادة · القرارات المهمة أمامك، والتفاصيل عند الحاجة</p></div><span className="royal-live-pill"><i/>متصل بالبيانات الفعلية</span></header>
    <section className="royal-pulse" aria-label="المؤشرات الحرجة">
      <article className="royal-glass royal-pulse-card"><div className="royal-pulse-label"><span>المستحقات المعلقة</span><span className="royal-metric-symbol">＄</span></div><strong dir="ltr">{currency(data.revenue_pending)}</strong><p>الرصيد الفعلي غير المسدد في دفتر الحسابات</p><Link href="/staff/accounting?status=unpaid" prefetch={false}>متابعة السداد <span>↗</span></Link></article>
      <article className="royal-glass royal-pulse-card"><Link className="royal-card-link" href="/staff/clients?attention=documents" aria-label="Documents Needing Action" prefetch={false}><div className="royal-pulse-label"><span>عوائق الوثائق</span><span className="royal-metric-symbol">▤</span></div><strong>{data.document_blockers}</strong><p>ملفات نشطة ذات وثائق تحتاج إجراءً</p><span className="royal-card-cta">مراجعة النواقص <span>↗</span></span></Link></article>
      <article className="royal-glass royal-pulse-card"><div className="royal-pulse-label"><span>معدل نجاح المقابلات</span><span className="royal-metric-symbol">↗</span></div><strong className="royal-turquoise">{data.conversion_rate==null?'—':`${data.conversion_rate}%`}</strong><p>النجاح ÷ نتائج النجاح والرسوب المسجلة لكل عميل</p><Link href="/staff/appointments?view=past" prefetch={false}>مراجعة النتائج <span>↗</span></Link></article>
    </section>
    <section className="royal-glass royal-pipeline" aria-label="Six-stage lifecycle"><div className="royal-section-title"><div><p className="royal-eyebrow">ONE CLIENT · ONE WORKFLOW</p><h2>مسار العمل الحي</h2></div><Link href="/staff/pipeline" prefetch={false}>عرض مسار العمل ↗</Link></div><div className="royal-stations grid">{data.stages.map((stage,index)=><Link key={stage.id} href={stage.href} prefetch={false} className={`royal-station station-${stage.id}`}><div><span className="royal-station-number">{String(index+1).padStart(2,'0')}</span><span aria-hidden="true">{index===5?'✓':'←'}</span></div><strong>{stage.total}</strong><b>{stage.labelAr}</b><small>{stage.label}</small><span className={`royal-wait ${(stage.wait_hours??0)>72&&index<5?'delayed':''}`}>{stage.wait_hours==null?'لا ملفات حاليًا':`متوسط البقاء: ${stage.wait_hours>=24?`${(stage.wait_hours/24).toFixed(1)} يوم`:`${Math.round(stage.wait_hours)} ساعة`}`}</span></Link>)}</div><div className="royal-loop"><span>↻ الرسوب أو الاعتذار مع استمرار الاهتمام: إعادة توجيه إلى تجهيز الوظيفة</span><Link href="/staff/clients?stage=job_ready" prefetch={false}>فتح ملفات إعادة التوجيه</Link><Link href="/staff/clients?stage=paperwork_pending" prefetch={false}>استكمال ما بعد المقابلة</Link></div></section>
    <section className="royal-cockpit">
      <div className="royal-glass royal-actions"><div className="royal-section-title"><div><p className="royal-eyebrow">ACTION CENTER</p><h2>أولويات المدير</h2></div><span className="royal-count-pill">{data.priorities.length} ملفات</span></div>
        {data.priorities.length===0?<p className="royal-empty">لا ملفات حرجة في قائمة التدخل الحالية.</p>:<div className="royal-action-list">{data.priorities.map(client=><article key={client.id} className="royal-action-row" draggable={isManager&&!busy} onDragStart={event=>{event.dataTransfer.setData('application/career-gate-client',client.id);event.dataTransfer.effectAllowed='move';}}><span className={`royal-action-marker ${client.kind==='payment_overdue'?'critical':''}`} aria-hidden="true"/><div className="royal-action-content"><strong>{client.full_name}</strong><p>{kindLabels[client.kind]}{client.kind==='payment_overdue'?` · ${currency(client.amount)}`:''}</p><small>{client.ref} · {Math.floor(client.age_days)} يوم</small></div><div className="royal-action-buttons"><Link href={client.href} prefetch={false}>{client.kind==='payment_overdue'?'متابعة الدفع':client.kind==='schedule_interview'?'جدولة':'مراجعة'} ↗</Link>{isManager&&<button type="button" aria-pressed={selected===client.id} disabled={busy} onClick={()=>setSelected(selected===client.id?null:client.id)}>تعيين</button>}</div></article>)}</div>}
        <Link className="royal-audit-link" href="/staff/audit-alerts" prefetch={false}><span className="royal-load-dot critical"/>{data.audit_alerts} تنبيه تدقيق مفتوح <span>مراجعة ↗</span></Link>
      </div>
      <div className="royal-glass royal-team"><div className="royal-section-title"><div><p className="royal-eyebrow">REAL TEAM LOAD</p><h2>حمل الفريق</h2></div><Link href="/staff/staff?tab=team" prefetch={false}>عرض الفريق ↗</Link></div><p className="royal-team-hint">{selected?'اختر الموظف لتعيين الملف المحدد':isManager?'اسحب ملفًا من الأولويات إلى الموظف، أو استخدم زر تعيين':'الحمل النسبي للملفات والمهام المفتوحة'}</p><div className="royal-team-list">{team.map(member=>{const load=member.active_clients+member.open_tasks;const tone=member.overdue_tasks?'critical':load/maximum>=.7?'busy':'available';return <article key={member.id} className={`royal-team-row ${tone}`} onDragOver={event=>{if(isManager&&!busy&&event.dataTransfer.types.includes('application/career-gate-client')){event.preventDefault();event.dataTransfer.dropEffect='move';}}} onDrop={event=>{event.preventDefault();const id=event.dataTransfer.getData('application/career-gate-client');if(id)void assign(id,member.id);}}><div className="royal-team-identity"><span className="royal-team-avatar">{member.display_name.trim().slice(0,1)}<i/></span><div><Link href={`/staff/staff?tab=team&member=${member.id}`} prefetch={false} aria-label={`${member.display_name} ${member.active_clients} files ${member.open_tasks} tasks ${member.overdue_tasks} overdue`}>{member.display_name}</Link><p>{member.active_clients} ملفات · {member.open_tasks} مهام{member.overdue_tasks>0?` · ${member.overdue_tasks} متأخرة`:''}</p></div><span className="royal-team-state">{member.overdue_tasks?'يحتاج تدخلًا':load===0?'متاح':'جارٍ العمل'}</span></div><div className="royal-load-track" role="meter" aria-label={`حمل ${member.display_name} النسبي`} aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={load}><span style={{width:`${100*load/maximum}%`}}/></div>{selected&&isManager&&<button type="button" className="royal-assign-button" disabled={busy} onClick={()=>void assign(selected,member.id)}>تعيين الملف لهذا الموظف</button>}</article>;})}</div><p className="royal-team-hint">الأشرطة نسبة إلى أعلى حمل حالي. أسماء الموظفين وأعدادهم من النظام.</p></div>
    </section>
    {message&&<p role={failed?'alert':'status'} className={`royal-feedback ${failed?'critical':''}`}>{message}</p>}
    <footer className="royal-dashboard-footer"><span>{currency(data.paid_total)} صافي محصل</span><Link href="/staff/tasks?view=overdue" aria-label="Overdue Tasks" prefetch={false}>{data.queues.overdue_tasks} مهام متأخرة</Link><Link href="/staff/follow-ups?view=overdue" aria-label="Overdue Follow-Ups" prefetch={false}>{data.queues.overdue_followups} متابعات متأخرة</Link><Link href="/staff/clients?assigned=none" aria-label="Unassigned Files" prefetch={false}>{data.queues.unassigned_clients} ملفات غير معينة</Link><Link href="/staff/clients?view=completed&completed_this_month=1" aria-label="Completed This Month" prefetch={false}>{data.queues.completed_this_month} مكتمل هذا الشهر</Link><Link href="/staff/today" prefetch={false}>عمل اليوم</Link><Link href="/staff/week" prefetch={false}>هذا الأسبوع</Link><Link href="/staff/clients?view=all" prefetch={false}>جميع السجلات</Link></footer>
  </div>;
}
