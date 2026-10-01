from pathlib import Path

p=Path('career-gate/public/career-gate.html')
s=p.read_text(encoding='utf-8')

s=s.replace("required:'أكمل الحقول المطلوبة.',uploadPartial:","required:'أكمل الحقول المطلوبة.',filesTooLarge:'الحد الأقصى 4MB لكل ملف.',photoTooLarge:'الصورة أكبر من 4MB.',uploadPartial:",1)
s=s.replace("required:'Complete the required fields.',uploadPartial:","required:'Complete the required fields.',filesTooLarge:'Each file must be 4MB or smaller.',photoTooLarge:'The photo must be 4MB or smaller.',uploadPartial:",1)

marker="function formatSubmissionTime(iso){"
if marker not in s: raise SystemExit('runtime insertion marker missing')
insert=r'''
const DOC_STATUS_AR={missing:'مفقود',pending:'قيد الانتظار',processing:'قيد المعالجة',needs_reupload:'يلزم إعادة الرفع',needs_review:'بحاجة للمراجعة',verified:'تم التحقق',rejected:'مرفوض'};
const NEXT_AR={'Office will review your application.':'سيقوم المكتب بمراجعة طلبك.','Office will review your information and documents.':'سيقوم المكتب بمراجعة معلوماتك ومستنداتك.','Office will submit your application.':'سيقوم المكتب بتقديم طلبك.','Your application is being submitted.':'يجري تقديم طلبك.','Complete the employer assessment.':'أكمل تقييم جهة العمل.','Wait for pre-hire appointment details.':'انتظر تفاصيل موعد ما قبل التوظيف.','Office will schedule your appointment.':'سيقوم المكتب بتحديد موعدك.','Attend your scheduled appointment.':'احضر موعدك المحدد.','Wait for screening results.':'انتظر نتائج الفحص.','Complete your I-9 documents.':'أكمل مستندات I-9.','Complete remaining post-hire tasks.':'أكمل إجراءات ما بعد التوظيف المتبقية.','Report for your first day.':'باشر يوم عملك الأول.','No further action needed.':'لا يلزم إجراء إضافي.'};
function docStatusLabel(v){if(!v)return'—';const k=String(v).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');return state.locale==='ar'?(DOC_STATUS_AR[k]||v):String(v).replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}
function nextStepLabel(v){if(!v)return'—';return state.locale==='ar'?(NEXT_AR[v]||v):v}
function renderTrack(a,updates){const initials=((a.fullName||'A').trim()[0]||'A').toUpperCase();const timeline=updates.map(u=>`<div class="tl"><b>${esc(statusLabel(u.status))}</b><small>${esc(u.timestamp)}</small><span dir="auto">${esc(u.update)}</span></div>`).join('')||`<div class="muted">${esc(tr('noUpdates'))}</div>`;const interview=a.interview?`<div class="timeline" style="margin-top:12px"><div class="divider" style="margin-top:0">${esc(tr('interview'))}</div><div class="kv"><div class="k">${esc(tr('date'))}</div><div class="v">${esc(a.interview.date||'—')}</div><div class="k">${esc(tr('time'))}</div><div class="v">${esc(a.interview.time||'—')}</div><div class="k">${esc(tr('location'))}</div><div class="v" dir="auto">${esc(a.interview.location||'—')}</div></div></div>`:'';$('#trackResult').innerHTML=`<div class="cardGlass"><div class="trackCardHead"><div class="avatar">${esc(initials)}</div><div><div class="eyebrow">${esc(tr('fileStatus'))}</div><h2 style="margin:4px 0 0" dir="auto">${esc(a.fullName||'—')}</h2><div class="muted" dir="ltr">${esc(a.caseNumber||'')}</div></div><div class="statusPill">${esc(statusLabel(a.currentStatus||'new_intake'))}</div></div><div class="trackBody"><div><div class="kv"><div class="k">${esc(tr('name'))}</div><div class="v" dir="auto">${esc(a.fullName||'—')}</div><div class="k">${esc(tr('caseNumber'))}</div><div class="v" dir="ltr">${esc(a.caseNumber||'—')}</div><div class="k">${esc(tr('submittedAt'))}</div><div class="v">${esc(a.submittedAt||'—')}</div><div class="k">${esc(tr('location'))}</div><div class="v" dir="auto">${esc(a.jobLocation||'—')}</div><div class="k">${esc(tr('shiftDays'))}</div><div class="v" dir="auto">${esc(a.shiftDays||'—')}</div><div class="k">${esc(tr('shiftHours'))}</div><div class="v" dir="auto">${esc(a.shiftHours||'—')}</div><div class="k">${esc(tr('currentStatus'))}</div><div class="v">${esc(statusLabel(a.currentStatus||'—'))}</div><div class="k">${esc(tr('nextStep'))}</div><div class="v" dir="auto">${esc(nextStepLabel(a.nextStep||'—'))}</div><div class="k">${esc(tr('documentsStatus'))}</div><div class="v">${esc(docStatusLabel(a.documentsStatus||'missing'))}</div><div class="k">${esc(tr('lastUpdated'))}</div><div class="v">${esc(a.lastStatusUpdate||'—')}</div></div>${interview}</div><div class="timeline"><div class="divider" style="margin-top:0">${esc(tr('timeline'))}</div>${timeline}</div></div></div>`}
function bindLocalizedUploads(){
 $('#docs').onchange=e=>{const f=Array.from(e.target.files||[]).slice(0,CONFIG.maxFiles);if(f.some(x=>x.size>CONFIG.maxBytes)){toast(tr('filesTooLarge'),'errt');e.target.value='';state.files=[];$('#docsList').innerHTML='';return}state.files=f;$('#docsList').innerHTML=f.map(x=>'• '+esc(x.name)+' — '+Math.round(x.size/1024)+' KB').join('<br>');if(state.step===4)renderReview()};
 $('#photo').onchange=e=>{const f=e.target.files?.[0]||null;if(f&&f.size>CONFIG.maxBytes){toast(tr('photoTooLarge'),'errt');e.target.value='';state.photo=null;renderPhoto();return}state.photo=f;renderPhoto();if(state.step===4)renderReview()};
 $('#consent').addEventListener('change',()=>{if(state.step===4)renderReview()});
}
'''
s=s.replace(marker,insert+'\n'+marker,1)

old="setupFocusLaser();localizeStatic()};"
new="setupFocusLaser();bindLocalizedUploads();localizeStatic()};"
if old not in s: raise SystemExit('init hook marker missing')
s=s.replace(old,new,1)

# Localize language control accessibility labels as part of locale render.
old2="document.documentElement.lang=state.locale;document.documentElement.dir=state.locale==='ar'?'rtl':'ltr';document.title=tr('title');"
new2="document.documentElement.lang=state.locale;document.documentElement.dir=state.locale==='ar'?'rtl':'ltr';document.title=tr('title');$('#languageToggle')?.setAttribute('aria-label',state.locale==='ar'?'اختيار اللغة':'Select language');$('.receipt-language')?.setAttribute('aria-label',state.locale==='ar'?'اختيار اللغة':'Select language');"
if old2 not in s: raise SystemExit('locale head marker missing')
s=s.replace(old2,new2,1)

p.write_text(s,encoding='utf-8')
