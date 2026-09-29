import fs from "node:fs/promises";

const path = new URL("../public/career-gate.html", import.meta.url);
let source = await fs.readFile(path, "utf8");

function replaceExact(oldText, newText, label) {
  const first = source.indexOf(oldText);
  if (first < 0) throw new Error(`Patch anchor not found: ${label}`);
  if (source.indexOf(oldText, first + oldText.length) >= 0) throw new Error(`Patch anchor is not unique: ${label}`);
  source = source.slice(0, first) + newText + source.slice(first + oldText.length);
}

function replaceRegex(regex, replacement, label) {
  const matches = [...source.matchAll(new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`))];
  if (matches.length !== 1) throw new Error(`Expected one ${label} block, found ${matches.length}`);
  source = source.replace(regex, replacement);
}

replaceExact(
  "const CONFIG={storageKey:'alhijrah.career.form.v43',officeWhatsApp:'13139194292',maxFiles:8,maxBytes:4*1024*1024};",
  "const CONFIG={storageKey:'alhijrah.career.form.v43',draftDb:'alhijrah.career.form',draftVersion:1,draftTtlMs:30*24*60*60*1000,officeWhatsApp:'13139194292',maxFiles:8,maxBytes:4*1024*1024};",
  "config",
);

replaceExact(
  "const state={step:1,uid:'UID-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,7).toUpperCase(),files:[],photo:null};let sig={canvas:null,ctx:null,drawing:false,last:null,has:false};let lastPayload=null;",
  `const state={step:1,uid:'UID-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,7).toUpperCase(),files:[],photo:null,uploadIds:{},uploadStates:{},signatureUploadId:crypto.randomUUID(),draftRevision:0,draftSession:crypto.randomUUID(),draftBlocked:false};let sig={canvas:null,ctx:null,drawing:false,last:null,has:false};let lastPayload=null;
const fileKey=f=>[f.name,f.size,f.lastModified,f.type].join(':');
function uploadIdFor(file){const k=fileKey(file);return state.uploadIds[k]||(state.uploadIds[k]=crypto.randomUUID())}
function setFlow(value){$('#statusView').textContent=value}
function renderFiles(){const el=$('#docsList');el.innerHTML=state.files.map(f=>{const s=state.uploadStates[fileKey(f)]||'SELECTED';return '• '+esc(f.name)+' — '+Math.round(f.size/1024)+' KB — '+esc(s)}).join('<br>')}
function openDraftDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(CONFIG.draftDb,CONFIG.draftVersion);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('draft'))db.createObjectStore('draft');if(!db.objectStoreNames.contains('files'))db.createObjectStore('files')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error('IndexedDB unavailable'));r.onblocked=()=>reject(new Error('IndexedDB upgrade blocked'))})}
async function idbTx(store,mode,work){const db=await openDraftDb();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(store,mode),os=tx.objectStore(store);let out;try{out=work(os)}catch(e){reject(e);return}tx.oncomplete=()=>resolve(out);tx.onerror=()=>reject(tx.error||new Error('IndexedDB write failed'));tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted'))})}finally{db.close()}}
async function idbGet(store,key){const db=await openDraftDb();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),r=tx.objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error('IndexedDB read failed'))})}finally{db.close()}}
async function persistSelectedFiles(){await idbTx('files','readwrite',os=>{os.clear();state.files.forEach(f=>os.put({kind:'doc',file:f},'doc:'+fileKey(f)));if(state.photo)os.put({kind:'photo',file:state.photo},'photo')})}
async function clearDraft(){try{await idbTx('draft','readwrite',os=>os.delete('main'));await idbTx('files','readwrite',os=>os.clear())}catch(e){console.error(e)}localStorage.removeItem(CONFIG.storageKey)}
`,
  "state",
);

replaceRegex(
  /function init\(\)\{.*?\}\nfunction bind/s,
  `async function init(){fillSelect($('#education'),EDUCATION.map(x=>[x,x||'— اختر —']));fillSelect($('#lastTitle'),JOBS.map(x=>[x,x||'— اختر —']));const loc=[['','— اختر —'],...BRANCHES.map(b=>[b.name,b.name+' — '+b.address])];['location1','location2','location3'].forEach(id=>fillSelect($('#'+id),loc));fillSelect($('#branch'),BRANCHES.map(b=>[b.code,b.name+' — '+b.address]));$('#skills').innerHTML=SKILLS.map(x=>\`<label class="choice"><input type="checkbox" name="skills" value="\${esc(x)}"><span class="box"></span><span>\${esc(x)}</span></label>\`).join('');$('#docPrefs').innerHTML=DOC_PREFS.map(x=>\`<label class="choice"><input type="checkbox" name="docPrefs" value="\${esc(x)}"><span class="box"></span><span>\${esc(x)}</span></label>\`).join('');$('#workTypeDeck').innerHTML=WORK_TYPES.map(x=>\`<label class="shift-card"><input type="radio" name="workType" value="\${esc(x[0])}"><span class="shift-code">\${esc(x[0])}</span><span class="shift-name">\${esc(x[1])}</span></label>\`).join('');renderPay();bind();await restore();initSignature();setStep(state.step||1);updatePay();renderFiles();renderPhoto();$('#uidView').textContent=state.uid;$('#caseView').textContent='يُعتمد عند الإرسال';const q=new URLSearchParams(location.search);if(q.get('case')){$('#trackType').value='case';$('#trackValue').value=q.get('case');if(q.get('track')==='1')setTimeout(track,0)}}
function bind`,
  "init",
);

replaceRegex(
  /function bind\(\)\{.*?\}\nfunction debounce/s,
  `function bind(){document.addEventListener('change',e=>{const t=e.target;if(t.matches('input[name=service],input[name=workType],input[name=shift],input[name=skills],input[name=docPrefs],#consent')){const label=t.closest('label');if(label)label.classList.toggle('selected',t.checked)}if(t.name==='workType'){renderShifts(t.value);$('#shiftSelector').style.display='block'}if(t.name==='shift'||t.id==='branch')updatePay();void save()});$('#form').addEventListener('input',debounce(()=>void save(),1500));$$('[data-next]').forEach(b=>b.onclick=()=>{if(validateStep(state.step))setStep(+b.dataset.next)});$$('[data-prev]').forEach(b=>b.onclick=()=>setStep(+b.dataset.prev));$$('[data-step]').forEach(b=>b.onclick=()=>setStep(+b.dataset.step));$('#docs').onchange=async e=>{const f=Array.from(e.target.files||[]).slice(0,CONFIG.maxFiles);if(f.some(x=>x.size>CONFIG.maxBytes)){toast('الحد الأقصى 4MB لكل ملف.','errt');e.target.value='';return}state.files=f;for(const file of f){uploadIdFor(file);state.uploadStates[fileKey(file)]='SELECTED'}renderFiles();try{await persistSelectedFiles();await save()}catch(x){state.draftBlocked=true;$('#saveView').textContent='Local blocked';toast('تعذر حفظ المستندات محلياً: '+x.message,'errt')}};$('#photo').onchange=async e=>{const f=e.target.files?.[0]||null;if(f&&f.size>CONFIG.maxBytes){toast('الصورة أكبر من 4MB.','errt');e.target.value='';return}state.photo=f;if(f){uploadIdFor(f);state.uploadStates[fileKey(f)]='SELECTED'}renderPhoto();try{await persistSelectedFiles();await save()}catch(x){state.draftBlocked=true;$('#saveView').textContent='Local blocked';toast('تعذر حفظ الصورة محلياً: '+x.message,'errt')}};$('#sigClear').onclick=clearSignature;$('#nearest').onclick=suggestNearest;$('#trackBtn').onclick=track;$('#form').onsubmit=submit;$('#newApplication').onclick=async()=>{await clearDraft();location.href='/apply'};$('#downloadReceipt').onclick=downloadReceipt;window.addEventListener('online',()=>{if($('#statusView').textContent==='ATTACHMENT_FAILED')toast('عاد الاتصال. يمكنك إعادة محاولة الإرسال.','ok')})}
function debounce`,
  "bind",
);

replaceRegex(
  /async function submit\(e\)\{.*?\}\nasync function uploadFile\(token,file,name\)\{.*?\}\nasync function uploadAssets\(token\)\{.*?\}\nasync function track/s,
  `async function submit(e){e.preventDefault();if(!validateStep(1)){setStep(1);return}if(!validateStep(2)){setStep(2);return}if(!validateStep(3)){setStep(3);return}const payload=collect();if(payload.honeypot)return;const btn=$('#submitBtn');btn.disabled=true;btn.textContent='جارٍ الإرسال...';setFlow('SUBMISSION_PENDING');try{await save();const r=await fetch('/api/application',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.message||'Submission failed');setFlow('APPLICATION_CREATED');if(j.upload_token){const uploadResult=await uploadAssets(j.upload_token,Boolean(j.duplicate));if(!uploadResult.ok){setFlow('ATTACHMENT_FAILED');throw new Error('تم حفظ الطلب، لكن لم يكتمل رفع كل المرفقات. اضغط إرسال الطلب مرة أخرى لإعادة محاولة المرفقات الفاشلة دون إنشاء طلب جديد.')}}payload.caseNumber=j.caseNumber;payload.trackingUrl=j.trackingUrl;lastPayload=payload;$('#caseView').textContent=j.caseNumber;setFlow('COMPLETED');await clearDraft();showReceipt(payload)}catch(x){if($('#statusView').textContent!=='ATTACHMENT_FAILED')setFlow('LOCAL_DRAFT');toast('فشل الإرسال: '+x.message,'errt')}finally{btn.disabled=false;btn.textContent=$('#statusView').textContent==='ATTACHMENT_FAILED'?'إعادة محاولة المرفقات':'إرسال الطلب'}}
async function uploadFile(token,file,name,retry=false){const key=fileKey(file);state.uploadStates[key]=retry?'RETRYING':'PREPARING';renderFiles();await Promise.resolve();state.uploadStates[key]='UPLOADING';renderFiles();const fd=new FormData();fd.set('upload_token',token);fd.set('upload_id',uploadIdFor(file));fd.set('doc_type','other');fd.set('file',file,name||file.name);const r=await fetch('/api/intake/documents',{method:'POST',body:fd});const j=await r.json().catch(()=>null);if(!r.ok||!j?.ok){state.uploadStates[key]='FAILED';renderFiles();throw new Error(j?.error?.message||'Upload failed')}state.uploadStates[key]='UPLOADED';renderFiles();return j}
async function uploadAssets(token,retry=false){setFlow('ATTACHMENT_PENDING');const failed=[];for(const f of state.files){try{await uploadFile(token,f,f.name,retry)}catch(e){failed.push(e)}}if(state.photo){try{await uploadFile(token,state.photo,'client-photo-'+state.photo.name,retry)}catch(e){failed.push(e)}}if(sig.has){try{const blob=await new Promise(res=>sig.canvas.toBlob(res,'image/png'));if(!blob)throw new Error('Signature image could not be prepared');const file=new File([blob],'signature.png',{type:'image/png',lastModified:0});const fd=new FormData();fd.set('upload_token',token);fd.set('upload_id',state.signatureUploadId);fd.set('doc_type','other');fd.set('file',file,'signature.png');const r=await fetch('/api/intake/documents',{method:'POST',body:fd});const j=await r.json().catch(()=>null);if(!r.ok||!j?.ok)throw new Error(j?.error?.message||'Signature upload failed')}catch(e){failed.push(e)}}if(failed.length){toast('تعذر رفع '+failed.length+' مرفق/مرفقات.','errt');return{ok:false,failed:failed.length}}setFlow('ATTACHMENT_UPLOADED');return{ok:true,failed:0}}
async function track`,
  "submit/upload",
);

replaceRegex(
  /function save\(\)\{.*?\}\nfunction restore\(\)\{.*?\}\nfunction showReceipt/s,
  `async function save(){try{const d=collect();delete d.files;delete d.photo;delete d.signature;const current=await idbGet('draft','main').catch(()=>null);if(current&&current.sessionId!==state.draftSession&&Number(current.revision||0)>state.draftRevision){state.draftBlocked=true;$('#saveView').textContent='Draft changed elsewhere';return}const nextRevision=Math.max(state.draftRevision,Number(current?.revision||0))+1;const record={schemaVersion:1,updatedAt:Date.now(),revision:nextRevision,sessionId:state.draftSession,uid:state.uid,step:state.step,data:d,uploadIds:state.uploadIds,uploadStates:state.uploadStates,signatureUploadId:state.signatureUploadId};await idbTx('draft','readwrite',os=>os.put(record,'main'));state.draftRevision=nextRevision;state.draftBlocked=false;$('#saveView').textContent='Saved'}catch(e){state.draftBlocked=true;$('#saveView').textContent='Local blocked';console.error(e)}}
async function restore(){try{const record=await idbGet('draft','main');if(!record){const legacy=JSON.parse(localStorage.getItem(CONFIG.storageKey)||'null');if(legacy){await applyDraftData(legacy);localStorage.removeItem(CONFIG.storageKey)}return}if(record.schemaVersion!==1||!record.data||Date.now()-Number(record.updatedAt||0)>CONFIG.draftTtlMs){await clearDraft();return}state.uid=record.uid||state.uid;state.step=Math.max(1,Math.min(3,Number(record.step)||1));state.uploadIds=record.uploadIds||{};state.uploadStates=record.uploadStates||{};state.signatureUploadId=record.signatureUploadId||state.signatureUploadId;state.draftRevision=Number(record.revision||0);await applyDraftData(record.data);const db=await openDraftDb();try{const entries=await new Promise((resolve,reject)=>{const tx=db.transaction('files','readonly'),r=tx.objectStore('files').getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error)});state.files=entries.filter(x=>x?.kind==='doc'&&x.file instanceof File).map(x=>x.file);state.photo=entries.find(x=>x?.kind==='photo'&&x.file instanceof File)?.file||null}finally{db.close()}renderFiles();renderPhoto();$('#saveView').textContent='Restored'}catch(e){console.error(e);$('#saveView').textContent='Local blocked'}}
async function applyDraftData(d){['firstName','lastName','dob','nationality','gender','phone','email','address1','address2','city','state','zip','employmentStatus','hasExperience','englishLevel','education','lastTitle','startDate'].forEach(k=>{if($('#'+k)&&d[k]!=null)$('#'+k).value=d[k]});if(d.service){const e=$('input[name=service][value="'+CSS.escape(d.service)+'"]');if(e){e.checked=true;e.closest('label').classList.add('selected')}}if(d.workType){const e=$('input[name=workType][value="'+CSS.escape(d.workType)+'"]');if(e){e.checked=true;renderShifts(d.workType);$('#shiftSelector').style.display='block';setTimeout(()=>{const s=$('input[name=shift][value="'+CSS.escape(d.shiftCode||'')+'"]');if(s){s.checked=true;s.closest('label').classList.add('selected')}},0)}}(d.preferredLocations||[]).forEach((x,i)=>{$('#location'+(i+1)).value=x});(d.skills||[]).forEach(x=>{const e=$('input[name=skills][value="'+CSS.escape(x)+'"]');if(e){e.checked=true;e.closest('label').classList.add('selected')}});(d.docPrefs||[]).forEach(x=>{const e=$('input[name=docPrefs][value="'+CSS.escape(x)+'"]');if(e){e.checked=true;e.closest('label').classList.add('selected')}});if(d.branch)$('#branch').value=d.branch}
function showReceipt`,
  "draft",
);

await fs.writeFile(path, source, "utf8");
console.log("Career Gate public form patched successfully");
