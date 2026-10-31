import { createClient } from '@supabase/supabase-js';
import type { ExecutiveSummary } from '../../lib/executive-summary';
import { timeOnly } from '../../lib/format';

const root=document.querySelector<HTMLElement>('#dashboard')!;
const nav=document.querySelector<HTMLElement>('#workflow-nav')!;
const status=document.querySelector<HTMLElement>('#connection')!;
const dialog=document.querySelector<HTMLDialogElement>('#commands')!;
const search=document.querySelector<HTMLInputElement>('#command-search')!;
const results=document.querySelector<HTMLElement>('#command-results')!;
let current:ExecutiveSummary|null=null;
let canAssign=false;
let loading=false;
let rerun=false;
let stopped=false;
let searchAbort:AbortController|null=null;
let searchTimer:ReturnType<typeof setTimeout>;
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const money=(value:unknown)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(value)||0);
const link=(url:string,label:string)=>`<a href="${escape(url)}">${escape(label)}</a>`;
type Language = 'en' | 'ar';
let language: Language = 'en';
try { if(localStorage.getItem('cg:staff-language:v1') === 'ar') language = 'ar'; } catch {}
const languageCookie = document.cookie.split('; ').find(value => value.startsWith('cg-staff-language='))?.split('=')[1];
if(languageCookie === 'en' || languageCookie === 'ar') language = languageCookie;
const t = (en: string, ar: string) => language === 'ar' ? ar : en;
let connectionState = 'connecting';
const connectionLabels: Record<string, [string, string]> = {
  connecting: ['Connecting…', 'جارٍ الاتصال…'],
  live: ['● Connected and synchronized', '● متصل ومتزامن'],
  reconnecting: ['Live updates interrupted · recovering', 'التحديث المباشر منقطع · جارٍ الاسترداد'],
  unavailable: ['Live updates unavailable · periodic refresh', 'التحديث المباشر غير متاح · استرداد دوري للبيانات'],
  fetch_error: ['Could not update data · retrying', 'تعذر تحديث البيانات · إعادة المحاولة'],
};
function showConnection(value: string) { connectionState = value; status.textContent = t(...(connectionLabels[value] ?? connectionLabels.connecting)); }
const names: Record<string, [string, string]> = {
  appointment_repair: ['Appointment needs routing review', 'موعد يحتاج تصحيح الربط'],
  payment_overdue: ['Post-interview payment due', 'مستحقات بعد المقابلة'],
  schedule_interview: ['Ready to schedule an interview', 'جاهز لحجز مقابلة'],
  document_review: ['Documents need review', 'وثائق تحتاج المراجعة'],
};
function applyLanguage(next: Language, persist = false) {
  language = next;
  document.documentElement.lang = next;
  document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
  const shell = document.querySelector<HTMLElement>('.royal-shell')!;
  shell.lang = next; shell.dir = document.documentElement.dir;
  for(const element of document.querySelectorAll<HTMLElement>('[data-en][data-ar]')) element.textContent = next === 'ar' ? element.dataset.ar! : element.dataset.en!;
  const toggle = document.querySelector<HTMLElement>('#language-toggle')!;
  toggle.textContent = next === 'en' ? 'AR' : 'EN';
  toggle.setAttribute('aria-label', t('Switch interface to Arabic', 'تغيير لغة الواجهة إلى الإنجليزية'));
  search.placeholder = t('Name, phone or file number', 'الاسم أو الهاتف أو رقم الملف');
  dialog.setAttribute('aria-label', t('Command palette', 'لوحة الأوامر'));
  document.querySelector('#assignment')!.setAttribute('aria-label', t('Assign specialist', 'تعيين الموظف'));
  document.querySelector('#mobile-nav')!.setAttribute('aria-label', t('Open navigation', 'فتح قائمة الأقسام'));
  for(const id of ['mobile-close', 'mobile-backdrop']) document.querySelector(`#${id}`)!.setAttribute('aria-label', t('Close navigation', 'إغلاق قائمة الأقسام'));
  document.querySelector('#orb')!.setAttribute('aria-label', t('Open command assistant', 'فتح مساعد الأوامر'));
  const collapsed = shell.dataset.collapsed === 'true';
  document.querySelector('#collapse')!.setAttribute('aria-label', collapsed ? t('Expand sidebar', 'توسيع الشريط الجانبي') : t('Collapse sidebar', 'طي الشريط الجانبي'));
  showConnection(connectionState);
  if(current) render(current);
  if(persist) {
    document.cookie = `cg-staff-language=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    try { localStorage.setItem('cg:staff-language:v1', next); } catch {}
  }
}
function render(data:ExecutiveSummary){
  const previous=root.querySelector<HTMLElement>('[data-client]:focus');
  const focusId=previous?.dataset.client;
  nav.innerHTML=data.stages.map((s,i)=>`<a class="royal-nav-item" href="${escape(s.href)}"><span class="royal-nav-icon">${String(i+1).padStart(2,'0')}</span><span class="royal-nav-copy">${escape(t(s.label, s.labelAr))}<small>${escape(t(s.labelAr, s.label))}</small></span><b class="royal-nav-badge">${Number(s.total)}</b></a>`).join('');
  const cards:[string,string|number,string,string][]=[[t('Revenue pending','المستحقات المعلقة'),money(data.revenue_pending),canAssign?'/staff/accounting?status=unpaid':'/staff/clients?stage=payment_required',t('Follow up payment','متابعة السداد')],[t('Document blockers','عوائق الوثائق'),Number(data.document_blockers),'/staff/clients?attention=documents',t('Review missing items','مراجعة النواقص')],[t('Interview conversion','معدل نجاح المقابلات'),data.conversion_rate==null?'—':`${Number(data.conversion_rate)}%`,'/staff/appointments?view=past',t('Review outcomes','مراجعة النتائج')]];
  document.querySelectorAll<HTMLElement>('[data-management]').forEach(element=>{element.hidden=!canAssign;});
  document.querySelector('#system-health')?.parentElement?.setAttribute('href',canAssign?'/staff/audit-alerts':'/staff');
  const max=Math.max(1,...data.team.map((m)=>Number(m.active_clients)+Number(m.open_tasks)));
  root.innerHTML=`<header class="royal-page-heading"><div><p class="royal-eyebrow">CAREER GATE · ROYAL EXECUTIVE</p><h1>${t("Operations Command Center","مركز قيادة العمليات")}</h1><p>${t("Focus on critical decisions and operational data","مركز القيادة · البيانات الفعلية فقط")}</p></div><span class="royal-live-pill">${escape(timeOnly(data.generated_at))}</span></header><section class="royal-pulse">${cards.map(([label,value,url,cta])=>`<article class="royal-glass royal-pulse-card"><div class="royal-pulse-label">${label}</div><strong dir="ltr">${value}</strong><p>${t("From the operational ledger","من السجل التشغيلي المعتمد")}</p>${link(String(url),String(cta))}</article>`).join('')}</section><section class="royal-glass royal-pipeline"><div class="royal-section-title"><div><p class="royal-eyebrow">ONE CLIENT · ONE WORKFLOW</p><h2>${t("Live workflow","مسار العمل الحي")}</h2></div>${link('/staff/pipeline',t('Open pipeline ↗','عرض المسار ↗'))}</div><div class="royal-stations">${data.stages.map((s,i)=>`<a class="royal-station station-${escape(s.id)}" href="${escape(s.href)}"><div><span class="royal-station-number">${String(i+1).padStart(2,'0')}</span><span>${t("→","←")}</span></div><strong>${Number(s.total)}</strong><b>${escape(t(s.label,s.labelAr))}</b><small>${escape(t(s.labelAr,s.label))}</small><span class="royal-wait ${Number(s.wait_hours)>72&&i<5?'delayed':''}">${s.wait_hours==null?(s.total?t('Entry time not recorded','زمن الدخول غير مسجل'):t('No files now','لا ملفات حاليًا')):`${t('Avg wait','متوسط البقاء')}: ${(Number(s.wait_hours)/24).toFixed(1)} ${t('days','يوم')}`}</span></a>`).join('')}</div><div class="royal-loop"><span>${t("↻ Failed or declined, still interested: return to Job Ready","↻ الرسوب أو الاعتذار مع استمرار الاهتمام: إعادة توجيه إلى تجهيز الوظيفة")}</span>${link('/staff/clients?stage=job_ready',t('Open rerouted files','ملفات إعادة التوجيه'))}</div></section><section class="royal-cockpit"><div class="royal-glass royal-actions"><div class="royal-section-title"><div><p class="royal-eyebrow">ACTION CENTER</p><h2>${t("Priority actions","أولويات المدير")}</h2></div></div><div class="royal-action-list">${data.priorities.map((c)=>`<article class="royal-action-row" ${canAssign?'draggable="true"':''} data-client="${escape(c.id)}"><span class="royal-action-marker ${c.kind==='payment_overdue'?'critical':''}"></span><div class="royal-action-content"><strong>${escape(c.full_name)}</strong><p>${escape(t(...(names[c.kind] ?? [c.kind,c.kind])))}${c.kind==='payment_overdue'?` · ${money(c.amount)}`:''}</p><small>${escape(c.ref)} · ${Math.floor(Number(c.age_days))} ${t("days","يوم")}</small></div><div class="royal-action-buttons">${link(c.href,t('Open ↗','فتح ↗'))}${canAssign?`<button data-select="${escape(c.id)}">${t("Assign","تعيين")}</button>`:''}</div></article>`).join('')||`<p class="royal-empty">${t('No critical files in the current list','لا ملفات حرجة في القائمة الحالية')}</p>`}</div>${canAssign?`<a href="/staff/audit-alerts" class="royal-audit-link">${Number(data.audit_alerts)} ${t("audit alerts · review ↗","تنبيه تدقيق · مراجعة ↗")}</a>`:`<p class="royal-audit-link">${Number(data.audit_alerts)} ${t("audit alerts · reviewed by management","تنبيه تدقيق · يراجعها المدير")}</p>`}</div><div class="royal-glass royal-team"><div class="royal-section-title"><div><p class="royal-eyebrow">REAL TEAM LOAD</p><h2>${t("Team load","حمل الفريق")}</h2></div>${link('/staff/staff?tab=team',t('View team ↗','عرض الفريق ↗'))}</div><p class="royal-team-hint">${canAssign?t('Drag a file to a specialist or choose Assign','اسحب الملف إلى الموظف أو اختر تعيين'):t('Relative load of files and tasks','الحمل النسبي للملفات والمهام')}</p><div class="royal-team-list">${data.team.map((m)=>{const load=Number(m.active_clients)+Number(m.open_tasks);return `<article class="royal-team-row ${Number(m.overdue_tasks)?'critical':load/max>.7?'busy':''}" data-staff="${escape(m.id)}"><div class="royal-team-identity"><span class="royal-team-avatar">${escape(m.display_name.trim().slice(0,1))}<i></i></span><div>${link(`/staff/staff?tab=team&member=${encodeURIComponent(m.id)}`,m.display_name)}<p>${Number(m.active_clients)} ${t("files","ملفات")} · ${Number(m.open_tasks)} ${t("tasks","مهام")} · ${Number(m.overdue_tasks)} ${t("overdue","متأخرة")}</p></div></div><div class="royal-load-track"><span style="width:${100*load/max}%"></span></div></article>`;}).join('')}</div></div></section><footer class="royal-dashboard-footer"><span>${Number(data.completed)} ${t("completed files","ملف مكتمل")} · ${money(data.paid_total)} ${t("net collected","صافي محصل")}</span>${link('/staff/clients?view=all',t('All records','جميع السجلات'))}${link('/staff/today',t('Today','عمل اليوم'))}</footer>`;
  if(focusId)root.querySelector<HTMLElement>(`[data-client="${CSS.escape(focusId)}"]`)?.focus();
  document.querySelector('#system-health')!.textContent=data.health ? `${t('SYSTEM','النظام')} ${data.health.status} · DB ${data.health.db_ms} ms` : `${t('Operations sync','مزامنة العمليات')} · ${timeOnly(data.generated_at)}`;
}
async function refresh(){
  if(stopped)return;if(loading){rerun=true;return;}loading=true;
  try{const response=await fetch('/api/staff/dashboard-summary',{cache:'no-store',signal:AbortSignal.timeout(15000)});const result=await response.json();
    if(response.status===401){root.innerHTML=`<section class="royal-glass royal-pipeline"><h1>${t('Sign in required','تسجيل الدخول مطلوب')}</h1><p>${t('Open this view on the Career Gate domain and sign in to access operational data.','افتح النسخة على نطاق Career Gate وسجّل الدخول لعرض بيانات النظام.')}</p><a href="/staff/login">${t('Sign in ↗','تسجيل الدخول ↗')}</a></section>`;return;}
    if(!response.ok||!result.ok)throw new Error(t('Could not update summary','تعذر تحديث المؤشرات'));const summary=result.summary as ExecutiveSummary;current=summary;canAssign=Boolean(result.permissions?.can_assign);render(summary);
  }catch{showConnection('fetch_error');status.setAttribute('role','alert');}finally{loading=false;if(rerun){rerun=false;void refresh();}}
}
async function assign(clientId:string,staffId:string){
  if(!canAssign||!current?.priorities.some(c=>c.id===clientId))return false;
  const feedback=document.querySelector('#feedback')!;feedback.textContent=t('Assigning file…','جارٍ تعيين الملف…');
  try{const response=await fetch('/api/staff/operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'reassign_client',client_id:clientId,staff_id:staffId,task_ids:[],reason:'Executive HTML command center assignment'}),signal:AbortSignal.timeout(15000)});const body=await response.json();if(!response.ok||!body.ok)throw Error(body.error?.message??t('Could not assign file','تعذر التعيين'));feedback.textContent=t('File assigned and recorded in the audit log','تم تعيين الملف وتسجيل العملية');await refresh();return true;}catch(error){feedback.textContent=error instanceof Error?error.message:t('Connection unavailable','تعذر الاتصال');return false;}
}
root.addEventListener('dragstart',event=>{const row=(event.target as Element).closest<HTMLElement>('[data-client]');if(row)(event as DragEvent).dataTransfer?.setData('application/career-gate-client',row.dataset.client!);});
root.addEventListener('dragover',event=>{if((event.target as Element).closest('[data-staff]')&&(event as DragEvent).dataTransfer?.types.includes('application/career-gate-client'))event.preventDefault();});
root.addEventListener('drop',event=>{const target=(event.target as Element).closest<HTMLElement>('[data-staff]');if(!target)return;event.preventDefault();const clientId=(event as DragEvent).dataTransfer?.getData('application/career-gate-client');if(clientId)void assign(clientId,target.dataset.staff!);});
let selected = '';
let selectedStaff = '';
let activeStaff = 0;
let assigning = false;
const assignment = document.querySelector<HTMLDialogElement>('#assignment')!;
const staffTrigger = document.querySelector<HTMLButtonElement>('#assign-staff')!;
const staffOptions = document.querySelector<HTMLElement>('#assign-options')!;
const staffValue = document.querySelector<HTMLInputElement>('#assign-staff-value')!;
const assignConfirm = document.querySelector<HTMLButtonElement>('#assign-confirm')!;
const members = () => current?.team ?? [];
function paintStaffOptions() {
  staffOptions.innerHTML = members().map((member,index) => `<button type="button" id="assign-option-${index}" role="option" tabindex="-1" data-staff-index="${index}" data-active="${index===activeStaff}" aria-selected="${member.id===selectedStaff}"><bdi>${escape(member.display_name)}</bdi></button>`).join('');
  document.querySelector('#assign-value')!.textContent = members().find(member => member.id === selectedStaff)?.display_name ?? t('Choose a specialist','اختر موظفاً');
  staffValue.value = selectedStaff;
  staffTrigger.disabled = members().length === 0 || assigning;
  assignConfirm.disabled = !selectedStaff || assigning;
  if(!staffOptions.hidden && members()[activeStaff]) {
    staffTrigger.setAttribute('aria-activedescendant',`assign-option-${activeStaff}`);
    staffOptions.querySelector(`[data-staff-index="${activeStaff}"]`)?.scrollIntoView({block:'nearest'});
  } else staffTrigger.removeAttribute('aria-activedescendant');
}
function showStaffOptions(open: boolean) {
  staffOptions.hidden = !open;
  staffTrigger.setAttribute('aria-expanded', String(open));
  paintStaffOptions();
}
function chooseStaff(index: number) {
  const member = members()[index]; if(!member) return;
  activeStaff = index; selectedStaff = member.id;
  showStaffOptions(false); staffTrigger.focus();
}
root.addEventListener('click',event => {
  const button = (event.target as Element).closest<HTMLElement>('[data-select]');
  if(!button || !current || !canAssign) return;
  selected = button.dataset.select!;
  if(!members().some(member => member.id === selectedStaff)) selectedStaff = members()[0]?.id ?? '';
  activeStaff = Math.max(0,members().findIndex(member => member.id===selectedStaff));
  showStaffOptions(false); assignment.showModal(); staffTrigger.focus();
});
staffTrigger.addEventListener('click', () => showStaffOptions(staffOptions.hidden));
staffOptions.addEventListener('click', event => {
  const option = (event.target as Element).closest<HTMLElement>('[data-staff-index]');
  if(option) chooseStaff(Number(option.dataset.staffIndex));
});
let typeAhead = ''; let typeAheadTimer: ReturnType<typeof setTimeout>;
staffTrigger.addEventListener('keydown', event => {
  const count = members().length;
  if(!count) return;
  if(event.key==='Tab') { showStaffOptions(false); return; }
  if(event.key==='Escape' && !staffOptions.hidden) { event.preventDefault(); event.stopPropagation(); showStaffOptions(false); return; }
  if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)) {
    event.preventDefault();
    if(event.key==='Enter'||event.key===' ') { if(staffOptions.hidden) showStaffOptions(true); else chooseStaff(activeStaff); return; }
    if(event.key==='Home') activeStaff=0;
    else if(event.key==='End') activeStaff=count-1;
    else if(!staffOptions.hidden) activeStaff=(activeStaff+(event.key==='ArrowDown'?1:-1)+count)%count;
    showStaffOptions(true); return;
  }
  if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey) {
    typeAhead += event.key.toLocaleLowerCase(); clearTimeout(typeAheadTimer); typeAheadTimer=setTimeout(()=>{typeAhead='';},700);
    const index=members().findIndex(member=>member.display_name.toLocaleLowerCase().startsWith(typeAhead));
    if(index>=0) { activeStaff=index; showStaffOptions(true); }
  }
});
document.addEventListener('pointerdown', event => { if(!(event.target as Element).closest('.royal-html-selector')) showStaffOptions(false); });
assignment.addEventListener('close',()=>showStaffOptions(false));
assignConfirm.addEventListener('click', async () => {
  if(assigning || !selectedStaff) return;
  assigning=true; paintStaffOptions();
  try { if(await assign(selected, selectedStaff)) assignment.close(); }
  finally { assigning=false; paintStaffOptions(); }
});
function openCommands(){dialog.showModal();search.focus();}
document.querySelector('#open-commands')!.addEventListener('click',openCommands);document.querySelector('#orb')!.addEventListener('click',openCommands);
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(dialog.open)dialog.close();else openCommands();}});
search.addEventListener('input',()=>{clearTimeout(searchTimer);searchAbort?.abort();searchTimer=setTimeout(async()=>{const q=search.value.trim();if(q.length<2){results.textContent=t('Enter at least two characters','اكتب حرفين على الأقل');return;}searchAbort=new AbortController();try{const response=await fetch(`/api/staff/search?q=${encodeURIComponent(q)}`,{signal:searchAbort.signal,cache:'no-store'});const body=await response.json();if(!response.ok||!body.ok)throw Error();results.innerHTML=(body.results??[]).map((c: {id:string;full_name:string;ref:string})=>`<a class="royal-nav-item" href="/staff/client/${encodeURIComponent(c.id)}">${escape(c.full_name)} · ${escape(c.ref)}</a>`).join('')||`<p>${t('No results','لا توجد نتائج')}</p>`;}catch(error){if(!(error instanceof Error&&error.name==='AbortError'))results.textContent=t('Search unavailable','تعذر البحث');}},200);});
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog')!.close()));
document.querySelector('#collapse')!.addEventListener('click',()=>{
  const shell=document.querySelector<HTMLElement>('.royal-shell')!;
  shell.dataset.collapsed=String(shell.dataset.collapsed!=='true');
  document.querySelector('#collapse')!.setAttribute('aria-expanded',String(shell.dataset.collapsed!=='true'));
  applyLanguage(language);
});
function showMobile(open: boolean) {
  document.querySelector<HTMLElement>('.royal-sidebar')!.dataset.open=String(open);
  document.querySelector('#mobile-nav')!.setAttribute('aria-expanded',String(open));
  document.querySelector<HTMLElement>('#mobile-backdrop')!.hidden=!open;
  if(!open) document.querySelector<HTMLElement>('#mobile-nav')!.focus();
}
document.querySelector('#mobile-nav')!.addEventListener('click',()=>showMobile(document.querySelector<HTMLElement>('.royal-sidebar')!.dataset.open!=='true'));
for(const id of ['mobile-backdrop','mobile-close']) document.querySelector(`#${id}`)!.addEventListener('click',()=>showMobile(false));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.querySelector<HTMLElement>('.royal-sidebar')!.dataset.open==='true')showMobile(false);});
document.querySelector('#language-toggle')!.addEventListener('click',()=>applyLanguage(language==='en'?'ar':'en',true));
window.addEventListener('storage',event=>{if(event.key==='cg:staff-language:v1'&&(event.newValue==='en'||event.newValue==='ar'))applyLanguage(event.newValue);});
let realtime:ReturnType<typeof createClient>|null=null;
async function connect(){try{const response=await fetch('/api/staff/realtime-token',{signal:AbortSignal.timeout(15000)});const config=await response.json();if(!response.ok||!config.ok){showConnection('unavailable');return;}realtime=createClient(config.url,config.anon_key,{auth:{persistSession:false,autoRefreshToken:false}});await realtime.realtime.setAuth(config.token);let timer:ReturnType<typeof setTimeout>;const queue=()=>{clearTimeout(timer);timer=setTimeout(()=>void refresh(),300);};let channel=realtime.channel('royal-executive-html');for(const table of ['clients','client_accounts','appointments','tasks','followups','documents','audit_alerts'])channel=channel.on('postgres_changes',{event:'*',schema:'public',table},queue);channel.subscribe(state=>{showConnection(state==='SUBSCRIBED'?'live':state==='CHANNEL_ERROR'||state==='CLOSED'?'reconnecting':'connecting');});}catch{showConnection('reconnecting');}}
const fallback=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},60000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refresh();});window.addEventListener('beforeunload',()=>{stopped=true;clearInterval(fallback);searchAbort?.abort();void realtime?.removeAllChannels();});
applyLanguage(language);
void refresh();void connect();
