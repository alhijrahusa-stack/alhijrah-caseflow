import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  assertSameOrigin,
  authenticateSession,
  clearSessionCookies,
  getAuthProvisioningStatus,
  hasPermission,
  internalPrincipal,
  inviteAuthUser,
  listAuthUsers,
  principalFromUser,
  revokeSession,
  safeAuditContext,
  sessionTokens,
  setSessionCookies,
  signInWithPassword,
  updateAuthUser,
} from './auth.js';
import {
  cleanDate,
  cleanPriority,
  cleanReviewState,
  cleanTaskStatus,
  cleanText,
  cleanWorkflowStage,
  normalizeClientInput,
  normalizeTaskInput,
  serviceCatalog,
} from './platform.js';
import { intakeDefinition, validateIntakeAnswers } from './intake-definitions.js';

const port = Number(process.env.PORT || 3000);
const version = '2.3.0';
const service = 'alhijrah-caseflow-api';
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const internalApiKey = process.env.INTERNAL_API_KEY;
const r2Bucket = process.env.R2_BUCKET;
const r2Endpoint = process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
const r2 = r2Endpoint && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY ? new S3Client({
  region: 'auto', endpoint: r2Endpoint,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
}) : null;

function securityHeaders(){return {'cache-control':'no-store','content-security-policy':"default-src 'self'; connect-src 'self' https:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",'permissions-policy':'camera=(), microphone=(), geolocation=()','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','strict-transport-security':'max-age=31536000; includeSubDomains'}}
function json(res,status,body,extra={}){res.writeHead(status,{'content-type':'application/json; charset=utf-8',...securityHeaders(),...extra});res.end(JSON.stringify(body))}
function cors(req){const origin=req.headers.origin;const allowed=(process.env.CORS_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean);if(!origin||!allowed.includes(origin))return {};return {'access-control-allow-origin':origin,'access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','access-control-allow-headers':'content-type,x-api-key,x-request-id','access-control-max-age':'86400',vary:'Origin'}}
async function readJson(req,max=1_000_000){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>max)throw Object.assign(new Error('PAYLOAD_TOO_LARGE'),{status:413});chunks.push(c)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{throw Object.assign(new Error('INVALID_JSON'),{status:400})}}
function internalAuth(req){if(!internalApiKey)throw Object.assign(new Error('API_NOT_CONFIGURED'),{status:503});const supplied=req.headers['x-api-key'];if(typeof supplied!=='string')throw Object.assign(new Error('UNAUTHORIZED'),{status:401});const a=Buffer.from(supplied),b=Buffer.from(internalApiKey);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw Object.assign(new Error('UNAUTHORIZED'),{status:401});return internalPrincipal()}
async function db(path,{method='GET',body,query=''}={}){if(!supabaseUrl||!supabaseServiceKey)throw Object.assign(new Error('SUPABASE_NOT_CONFIGURED'),{status:503});const r=await fetch(`${supabaseUrl}/rest/v1/${path}${query}`,{method,headers:{apikey:supabaseServiceKey,authorization:`Bearer ${supabaseServiceKey}`,'content-type':'application/json',prefer:method==='POST'||method==='PATCH'?'return=representation':''},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok){const e=new Error('DATABASE_REQUEST_FAILED');e.status=r.status>=500?502:r.status;e.details=data;throw e}return data}
function safeKey(x){const c=String(x||'').replace(/[^a-zA-Z0-9._/-]/g,'_').replace(/\.\./g,'_');if(!c||c.startsWith('/'))throw Object.assign(new Error('INVALID_OBJECT_KEY'),{status:400});return c}
function uuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''))}
const allowedDocumentTypes=new Set(['application/pdf','image/jpeg','image/png','image/webp','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
function stableUuid(value){const hex=crypto.createHash('sha256').update(value).digest('hex').slice(0,32);return hex.slice(0,8)+'-'+hex.slice(8,12)+'-5'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20,32)}
function documentInput(body){const caseId=String(body.case_id||'');if(!uuid(caseId))throw Object.assign(new Error('VALID_CASE_ID_REQUIRED'),{status:400});const fileName=String(body.filename||body.file_name||'').trim().slice(0,180);if(!fileName||/[\x00-\x1f]/.test(fileName))throw Object.assign(new Error('VALID_FILENAME_REQUIRED'),{status:400});const contentType=String(body.content_type||'').toLowerCase();if(!allowedDocumentTypes.has(contentType))throw Object.assign(new Error('UNSUPPORTED_DOCUMENT_TYPE'),{status:415});const sizeBytes=Number(body.size_bytes);if(!Number.isSafeInteger(sizeBytes)||sizeBytes<1||sizeBytes>25*1024*1024)throw Object.assign(new Error('DOCUMENT_SIZE_NOT_ALLOWED'),{status:413});return{caseId,fileName,contentType,sizeBytes}}
async function audit(principal,action,entityType,entityId,payload={},req){try{await db('audit_events',{method:'POST',body:{id:crypto.randomUUID(),actor_user_id:principal?.id||null,actor_label:principal?.displayName||'System',actor_roles:principal?.roles||[],action,entity_type:entityType,entity_id:entityId||null,client_id:uuid(payload.client_id)?payload.client_id:null,case_id:uuid(payload.case_id)?payload.case_id:null,metadata:{...payload,...(req?safeAuditContext(req):{})}}})}catch(e){console.error('audit-write-failed',e.message)}}
async function event(caseId,type,payload={},principal,req){try{await db('case_events',{method:'POST',body:{id:crypto.randomUUID(),case_id:caseId,event_type:type,actor:principal?.displayName||'Caseflow Workspace',payload}})}catch(e){console.error('event-write-failed',e.message)}await audit(principal,type,'case',caseId,payload,req)}

function requiredPermission(req,path){
  if(path==='/api/v1/users')return req.method==='GET'?'users.view':'users.manage';
  if(/^\/api\/v1\/users\/[0-9a-f-]{36}$/i.test(path))return 'users.manage';
  if(path==='/api/v1/audit')return 'audit.view';
  if(path.startsWith('/api/v1/clients'))return req.method==='GET'?'clients.view':'clients.manage';
  if(path.startsWith('/api/v1/tasks'))return req.method==='GET'?'tasks.view':'tasks.manage';
  if(path.startsWith('/api/v1/deadlines'))return req.method==='GET'?'tasks.view':'tasks.manage';
  if(path.startsWith('/api/v1/intakes'))return req.method==='GET'?'cases.view':'cases.manage';
  if(path.startsWith('/api/v1/services'))return 'dashboard.view';
  if(path.startsWith('/api/v1/document-requests'))return req.method==='GET'?'documents.view':'documents.manage';
  if(path.startsWith('/api/v1/documents'))return path.endsWith('/review')?'documents.review':req.method==='GET'||path.endsWith('/download-url')?'documents.view':'documents.manage';
  if(path.startsWith('/api/v1/cases'))return req.method==='GET'?'cases.view':'cases.manage';
  return 'dashboard.view';
}

async function authorize(req,res,permission){
  let principal;
  if(req.headers['x-api-key'])principal=internalAuth(req);
  else{assertSameOrigin(req);principal=await authenticateSession(req,res)}
  if(!hasPermission(principal,permission))throw Object.assign(new Error('FORBIDDEN'),{status:403});
  return principal;
}

async function handle(req,res){
  const requestId=req.headers['x-request-id']||crypto.randomUUID();res.setHeader('x-request-id',requestId);const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);const ch=cors(req);
  if(req.method==='OPTIONS'){res.writeHead(204,{...securityHeaders(),...ch});return res.end()}
  if(req.method==='GET'&&u.pathname==='/'){const html=fs.readFileSync(new URL('./public/index.html',import.meta.url));res.writeHead(200,{'content-type':'text/html; charset=utf-8',...securityHeaders(),'cache-control':'no-cache'});return res.end(html)}
  if(req.method==='GET'&&u.pathname==='/health')return json(res,200,{status:'ok',service,version,requestId},ch);
  if(req.method==='GET'&&u.pathname==='/ready'){
    const [authStatus,databaseState,r2State]=await Promise.all([
      getAuthProvisioningStatus(),
      db('cases',{query:'?select=id&limit=1'}).then(()=>db('clients',{query:'?select=id&limit=1'})).then(()=>({connected:true,coreSchema:true})).catch(async()=>({connected:await db('cases',{query:'?select=id&limit=1'}).then(()=>true).catch(()=>false),coreSchema:false})),
      r2&&r2Bucket?r2.send(new HeadBucketCommand({Bucket:r2Bucket})).then(()=>true).catch(()=>false):Promise.resolve(false),
    ]);
    const checks={supabase:databaseState.connected,coreSchema:databaseState.coreSchema,r2:r2State,internalAuth:Boolean(internalApiKey),userAuth:authStatus.configured,ownerAccount:authStatus.ownerProvisioned};
    const ready=Object.values(checks).every(Boolean);
    return json(res,ready?200:503,{status:ready?'ready':'not-ready',service,version,checks,requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/auth/status'){const status=await getAuthProvisioningStatus();return json(res,200,{configured:status.configured,ownerProvisioned:status.ownerProvisioned,userCount:status.userCount,errorCode:status.errorCode||null,requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/auth/login'){assertSameOrigin(req);const body=await readJson(req,16_384);const session=await signInWithPassword(body.email,body.password);const principal=principalFromUser(session.user);setSessionCookies(res,session);await audit(principal,'login','session',principal.id,{},req);return json(res,200,{user:{id:principal.id,email:principal.email,display_name:principal.displayName,roles:principal.roles},requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/auth/logout'){assertSameOrigin(req);let principal=null;try{principal=await authenticateSession(req,res)}catch{}const {accessToken}=sessionTokens(req);await revokeSession(accessToken);clearSessionCookies(res);await audit(principal,'logout','session',principal?.id||null,{},req);return json(res,200,{signedOut:true,requestId},ch)}
  if(req.method==='GET'&&u.pathname==='/api/v1/auth/me'){const principal=await authenticateSession(req,res);return json(res,200,{user:{id:principal.id,email:principal.email,display_name:principal.displayName,roles:principal.roles},requestId},ch)}

  let principal=null;
  if(u.pathname.startsWith('/api/'))principal=await authorize(req,res,requiredPermission(req,u.pathname));

  if(req.method==='GET'&&u.pathname==='/api/v1/users'){const data=await listAuthUsers();return json(res,200,{data,requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/users'){const body=await readJson(req,32_768);const data=await inviteAuthUser({email:body.email,displayName:body.display_name,roles:body.roles});await audit(principal,'user_invited','user',data.id,{roles:data.roles},req);return json(res,201,{data,requestId},ch)}
  const um=u.pathname.match(/^\/api\/v1\/users\/([0-9a-f-]{36})$/i);
  if(um&&req.method==='PATCH'){const body=await readJson(req,32_768);const data=await updateAuthUser(um[1],{displayName:body.display_name,roles:body.roles,status:body.status});await audit(principal,'user_updated','user',data.id,{roles:data.roles,status:data.status},req);return json(res,200,{data,requestId},ch)}

  if(req.method==='GET'&&u.pathname==='/api/v1/services'){
    const category=u.searchParams.get('category');
    let data;
    try{
      const filter=category?`&category=eq.${encodeURIComponent(category)}`:'';
      data=await db('service_catalog',{query:`?select=*&active=eq.true${filter}&order=category,name`});
    }catch(error){
      if(error.status!==404)throw error;
      data=serviceCatalog.filter(service=>!category||service.category===category);
    }
    return json(res,200,{data,requestId},ch);
  }

  const definitionMatch=u.pathname.match(/^\/api\/v1\/intakes\/definitions\/([A-Za-z0-9-]+)$/);
  if(definitionMatch&&req.method==='GET'){
    const definition=intakeDefinition(definitionMatch[1].toUpperCase());
    if(!definition)return json(res,404,{error:'INTAKE_DEFINITION_NOT_FOUND',requestId},ch);
    return json(res,200,{data:definition,requestId},ch);
  }

  const intakeMatch=u.pathname.match(/^\/api\/v1\/intakes\/([0-9a-f-]{36})\/([A-Za-z0-9-]+)$/i);
  if(intakeMatch&&req.method==='GET'){
    const serviceCode=intakeMatch[2].toUpperCase();
    const definition=intakeDefinition(serviceCode);
    if(!definition)return json(res,404,{error:'INTAKE_DEFINITION_NOT_FOUND',requestId},ch);
    const definitionId=stableUuid('intake:'+serviceCode+':'+definition.version);
    const rows=await db('intake_submissions',{query:`?case_id=eq.${encodeURIComponent(intakeMatch[1])}&definition_id=eq.${definitionId}&select=*`});
    return json(res,200,{data:rows[0]||null,definition,requestId},ch);
  }
  if(intakeMatch&&req.method==='POST'){
    const serviceCode=intakeMatch[2].toUpperCase();
    const definition=intakeDefinition(serviceCode);
    if(!definition)return json(res,404,{error:'INTAKE_DEFINITION_NOT_FOUND',requestId},ch);
    const body=await readJson(req,600_000);
    const status=body.status==='submitted'?'submitted':'draft';
    const answers=validateIntakeAnswers(definition,body.answers,{final:status==='submitted'});
    const currentStep=Math.max(0,Math.min(Number(body.current_step||0),definition.sections.length-1));
    const definitionId=stableUuid('intake:'+serviceCode+':'+definition.version);
    const definitions=await db('intake_definitions',{query:`?id=eq.${definitionId}&select=id`});
    if(!definitions.length)await db('intake_definitions',{method:'POST',body:{id:definitionId,service_code:serviceCode,version:definition.version,definition,active:true,published_at:new Date().toISOString(),created_by:principal.id}});
    const existing=await db('intake_submissions',{query:`?case_id=eq.${encodeURIComponent(intakeMatch[1])}&definition_id=eq.${definitionId}&select=id,status`});
    let data;
    if(existing.length){
      data=await db('intake_submissions',{method:'PATCH',query:`?id=eq.${existing[0].id}`,body:{answers,current_step:currentStep,status,submitted_at:status==='submitted'?new Date().toISOString():null,last_saved_by:principal.id,updated_at:new Date().toISOString()}});
    }else{
      data=await db('intake_submissions',{method:'POST',body:{id:crypto.randomUUID(),case_id:intakeMatch[1],definition_id:definitionId,answers,current_step:currentStep,status,submitted_at:status==='submitted'?new Date().toISOString():null,last_saved_by:principal.id}});
    }
    await audit(principal,status==='submitted'?'intake_submitted':'intake_saved','intake',data[0]?.id||existing[0]?.id,{case_id:intakeMatch[1],service_code:serviceCode},req);
    return json(res,200,{data:data[0]||data,definition,requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/clients'){
    const limit=Math.min(Math.max(Number(u.searchParams.get('limit')||100),1),250);
    const includeArchived=u.searchParams.get('archived')==='true';
    const archived=includeArchived?'':'&archived_at=is.null';
    let data=await db('clients',{query:`?select=*&order=updated_at.desc&limit=${limit}${archived}`});
    const q=String(u.searchParams.get('q')||'').trim().toLowerCase();
    if(q)data=data.filter(client=>[client.legal_name,client.email,client.phone,client.a_number,client.uscis_account_number].some(value=>String(value||'').toLowerCase().includes(q)));
    return json(res,200,{data,requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/clients'){
    const body=await readJson(req);
    const record={id:crypto.randomUUID(),...normalizeClientInput(body),created_by:principal.id,updated_by:principal.id};
    const data=await db('clients',{method:'POST',body:record});
    await audit(principal,'client_created','client',record.id,{client_id:record.id},req);
    return json(res,201,{data,requestId},ch);
  }
  const clientMatch=u.pathname.match(/^\/api\/v1\/clients\/([0-9a-f-]{36})$/i);
  if(clientMatch&&req.method==='GET'){
    const rows=await db('clients',{query:`?id=eq.${encodeURIComponent(clientMatch[1])}&select=*`});
    if(!Array.isArray(rows)||!rows.length)return json(res,404,{error:'CLIENT_NOT_FOUND',requestId},ch);
    return json(res,200,{data:rows[0],requestId},ch);
  }
  if(clientMatch&&req.method==='PATCH'){
    const rows=await db('clients',{query:`?id=eq.${encodeURIComponent(clientMatch[1])}&select=*`});
    if(!Array.isArray(rows)||!rows.length)return json(res,404,{error:'CLIENT_NOT_FOUND',requestId},ch);
    const body=await readJson(req);
    const merged={...rows[0],...body};
    const patch={...normalizeClientInput(merged),updated_by:principal.id,updated_at:new Date().toISOString()};
    if(body.archived===true)patch.archived_at=new Date().toISOString();
    if(body.archived===false)patch.archived_at=null;
    const data=await db('clients',{method:'PATCH',query:`?id=eq.${encodeURIComponent(clientMatch[1])}`,body:patch});
    await audit(principal,body.archived===true?'client_archived':body.archived===false?'client_restored':'client_updated','client',clientMatch[1],{client_id:clientMatch[1]},req);
    return json(res,200,{data,requestId},ch);
  }

  const clientPeopleMatch=u.pathname.match(/^\/api\/v1\/clients\/([0-9a-f-]{36})\/people$/i);
  if(clientPeopleMatch&&req.method==='GET'){
    const links=await db('client_people',{query:`?client_id=eq.${encodeURIComponent(clientPeopleMatch[1])}&select=relationship,is_primary,created_at,people(*)&order=created_at`});
    return json(res,200,{data:links,requestId},ch);
  }
  if(clientPeopleMatch&&req.method==='POST'){
    const body=await readJson(req);
    const relationship=cleanText(body.relationship,{required:true,max:50});
    const person={id:crypto.randomUUID(),legal_name:cleanText(body.legal_name,{required:true,max:180}),alternate_names:Array.isArray(body.alternate_names)?body.alternate_names.slice(0,20):[],date_of_birth:cleanDate(body.date_of_birth),place_of_birth:cleanText(body.place_of_birth,{max:180}),nationality:cleanText(body.nationality,{max:100}),a_number:cleanText(body.a_number,{max:20}),email:body.email?String(body.email).trim().toLowerCase():null,phone:cleanText(body.phone,{max:40})};
    await db('people',{method:'POST',body:person});
    const link={client_id:clientPeopleMatch[1],person_id:person.id,relationship,is_primary:Boolean(body.is_primary)};
    await db('client_people',{method:'POST',body:link});
    await audit(principal,'family_member_added','client',clientPeopleMatch[1],{client_id:clientPeopleMatch[1],person_id:person.id,relationship},req);
    return json(res,201,{data:{...person,relationship,is_primary:link.is_primary},requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/tasks'){
    const limit=Math.min(Math.max(Number(u.searchParams.get('limit')||100),1),250);
    const status=u.searchParams.get('status');
    const caseId=u.searchParams.get('case_id');
    const clientId=u.searchParams.get('client_id');
    let query=`?select=*&archived_at=is.null&order=due_date.asc.nullslast,created_at.desc&limit=${limit}`;
    if(status)query+=`&status=eq.${encodeURIComponent(cleanTaskStatus(status))}`;
    if(caseId){if(!uuid(caseId))throw Object.assign(new Error('INVALID_CASE_ID'),{status:400});query+=`&case_id=eq.${encodeURIComponent(caseId)}`;}
    if(clientId){if(!uuid(clientId))throw Object.assign(new Error('INVALID_CLIENT_ID'),{status:400});query+=`&client_id=eq.${encodeURIComponent(clientId)}`;}
    const data=await db('tasks',{query});
    return json(res,200,{data,requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/tasks'){
    const body=await readJson(req);
    const record={id:crypto.randomUUID(),...normalizeTaskInput(body),created_by:principal.id,updated_by:principal.id};
    if(!record.case_id&&!record.client_id)throw Object.assign(new Error('TASK_CASE_OR_CLIENT_REQUIRED'),{status:400});
    if(record.case_id&&!uuid(record.case_id)||record.client_id&&!uuid(record.client_id)||record.assigned_user_id&&!uuid(record.assigned_user_id))throw Object.assign(new Error('INVALID_TASK_REFERENCE'),{status:400});
    const data=await db('tasks',{method:'POST',body:record});
    await audit(principal,'task_created','task',record.id,{case_id:record.case_id,client_id:record.client_id},req);
    return json(res,201,{data,requestId},ch);
  }
  const taskMatch=u.pathname.match(/^\/api\/v1\/tasks\/([0-9a-f-]{36})$/i);
  if(taskMatch&&req.method==='PATCH'){
    const rows=await db('tasks',{query:`?id=eq.${encodeURIComponent(taskMatch[1])}&select=*`});
    if(!Array.isArray(rows)||!rows.length)return json(res,404,{error:'TASK_NOT_FOUND',requestId},ch);
    const body=await readJson(req);
    const record=normalizeTaskInput({...rows[0],...body});
    const patch={...record,updated_by:principal.id,updated_at:new Date().toISOString(),completed_at:record.status==='completed'?(rows[0].completed_at||new Date().toISOString()):null};
    if(body.archived===true)patch.archived_at=new Date().toISOString();
    const data=await db('tasks',{method:'PATCH',query:`?id=eq.${encodeURIComponent(taskMatch[1])}`,body:patch});
    await audit(principal,record.status==='completed'?'task_completed':'task_updated','task',taskMatch[1],{case_id:record.case_id,client_id:record.client_id},req);
    return json(res,200,{data,requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/deadlines'){
    const caseId=u.searchParams.get('case_id');
    let query='?select=*&order=deadline_date.asc&limit=250';
    if(caseId){if(!uuid(caseId))throw Object.assign(new Error('INVALID_CASE_ID'),{status:400});query+=`&case_id=eq.${encodeURIComponent(caseId)}`;}
    const data=await db('deadlines',{query});
    return json(res,200,{data,requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/deadlines'){
    const body=await readJson(req);
    if(!uuid(body.case_id))throw Object.assign(new Error('VALID_CASE_ID_REQUIRED'),{status:400});
    const record={id:crypto.randomUUID(),case_id:body.case_id,title:cleanText(body.title,{required:true,max:200}),deadline_date:cleanDate(body.deadline_date,{required:true}),deadline_type:cleanText(body.deadline_type,{required:true,max:80}),status:'open',source:cleanText(body.source,{max:200}),notes:cleanText(body.notes,{max:5000}),created_by:principal.id,updated_by:principal.id};
    const data=await db('deadlines',{method:'POST',body:record});
    await audit(principal,'deadline_created','deadline',record.id,{case_id:record.case_id,deadline_date:record.deadline_date},req);
    return json(res,201,{data,requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/cases'){const limit=Math.min(Math.max(Number(u.searchParams.get('limit')||100),1),250);const data=await db('cases',{query:`?select=*&order=created_at.desc&limit=${limit}`});return json(res,200,{data,requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/cases'){
    const b=await readJson(req);
    let clientName=cleanText(b.client_name,{max:180});
    if(b.client_id){
      if(!uuid(b.client_id))throw Object.assign(new Error('VALID_CLIENT_ID_REQUIRED'),{status:400});
      const clients=await db('clients',{query:`?id=eq.${encodeURIComponent(b.client_id)}&archived_at=is.null&select=id,legal_name`});
      if(!Array.isArray(clients)||!clients.length)throw Object.assign(new Error('CLIENT_NOT_FOUND'),{status:404});
      clientName=clients[0].legal_name;
    }
    const serviceCode=cleanText(b.service_code,{max:40});
    const caseType=cleanText(b.case_type,{max:180})||serviceCatalog.find(service=>service.code===serviceCode)?.name;
    if(!clientName||!caseType)throw Object.assign(new Error('CLIENT_AND_SERVICE_REQUIRED'),{status:400});
    const baseRecord={id:crypto.randomUUID(),client_name:clientName,case_type:caseType,status:String(b.status||'intake'),priority:cleanPriority(b.priority),assigned_to:cleanText(b.assigned_to,{max:180}),notes:cleanText(b.notes,{max:5000})};
    const record=b.client_id||serviceCode?{...baseRecord,client_id:b.client_id||null,service_code:serviceCode,case_reference:`AH-${new Date().getUTCFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,status:'active',workflow_stage:cleanWorkflowStage(b.workflow_stage||'intake'),review_state:cleanReviewState(b.review_state||'prepared'),agency:cleanText(b.agency,{max:120}),filing_type:cleanText(b.filing_type,{max:120}),jurisdiction:cleanText(b.jurisdiction,{max:180}),receipt_number:cleanText(b.receipt_number,{max:80}),created_by:principal.id,updated_by:principal.id}:baseRecord;
    const data=await db('cases',{method:'POST',body:record});
    await event(record.id,'case_created',{case_type:record.case_type,service_code:record.service_code,priority:record.priority,client_id:record.client_id,case_id:record.id},principal,req);
    return json(res,201,{data,requestId},ch);
  }
  const cm=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})$/i);
  if(cm&&req.method==='GET'){const data=await db('cases',{query:`?id=eq.${encodeURIComponent(cm[1])}&select=*`});if(!Array.isArray(data)||!data.length)return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);return json(res,200,{data:data[0],requestId},ch)}
  if(cm&&req.method==='PATCH'){
    const b=await readJson(req);
    const enhanced=['client_id','service_code','workflow_stage','review_state','agency','filing_type','jurisdiction','receipt_number'].some(field=>field in b)||b.archived!==undefined;
    const allowed=['client_id','client_name','service_code','case_type','status','priority','assigned_to','notes','workflow_stage','review_state','agency','filing_type','jurisdiction','receipt_number'];
    const patch=Object.fromEntries(Object.entries(b).filter(([key])=>allowed.includes(key)));
    if(!Object.keys(patch).length&&b.archived===undefined)throw Object.assign(new Error('NO_VALID_FIELDS'),{status:400});
    if(patch.client_id&&!uuid(patch.client_id))throw Object.assign(new Error('VALID_CLIENT_ID_REQUIRED'),{status:400});
    if(patch.priority)patch.priority=cleanPriority(patch.priority);
    if(patch.workflow_stage)patch.workflow_stage=cleanWorkflowStage(patch.workflow_stage);
    if(patch.review_state)patch.review_state=cleanReviewState(patch.review_state);
    for(const field of ['client_name','service_code','case_type','status','assigned_to','notes','agency','filing_type','jurisdiction','receipt_number'])if(field in patch)patch[field]=cleanText(patch[field],{max:field==='notes'?5000:180});
    if(b.archived===true)patch.archived_at=new Date().toISOString();
    if(b.archived===false)patch.archived_at=null;
    if(enhanced)patch.updated_by=principal.id;
    patch.updated_at=new Date().toISOString();
    const data=await db('cases',{method:'PATCH',query:`?id=eq.${encodeURIComponent(cm[1])}`,body:patch});
    await event(cm[1],b.archived===true?'case_archived':b.archived===false?'case_restored':patch.workflow_stage?'workflow_changed':'case_updated',{...patch,case_id:cm[1]},principal,req);
    return json(res,200,{data,requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/document-requests'){
    const caseId=u.searchParams.get('case_id');
    let query='?select=*&order=created_at.desc&limit=250';
    if(caseId){if(!uuid(caseId))throw Object.assign(new Error('INVALID_CASE_ID'),{status:400});query+=`&case_id=eq.${encodeURIComponent(caseId)}`;}
    const data=await db('document_requests',{query});
    return json(res,200,{data,requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/document-requests'){
    const body=await readJson(req);
    if(!uuid(body.case_id))throw Object.assign(new Error('VALID_CASE_ID_REQUIRED'),{status:400});
    if(body.client_id&&!uuid(body.client_id)||body.person_id&&!uuid(body.person_id))throw Object.assign(new Error('INVALID_DOCUMENT_OWNER'),{status:400});
    const record={id:crypto.randomUUID(),case_id:body.case_id,client_id:body.client_id||null,person_id:body.person_id||null,category:cleanText(body.category,{required:true,max:100}),title:cleanText(body.title,{required:true,max:200}),instructions:cleanText(body.instructions,{max:5000}),required:body.required!==false,due_date:cleanDate(body.due_date),status:'missing',requested_by:principal.id};
    const data=await db('document_requests',{method:'POST',body:record});
    await audit(principal,'document_requested','document_request',record.id,{case_id:record.case_id,client_id:record.client_id},req);
    return json(res,201,{data,requestId},ch);
  }
  const requestMatch=u.pathname.match(/^\/api\/v1\/document-requests\/([0-9a-f-]{36})$/i);
  if(requestMatch&&req.method==='PATCH'){
    const body=await readJson(req);
    const allowedStatus=new Set(['missing','received','approved','rejected','waived']);
    const patch={updated_at:new Date().toISOString()};
    if(body.status!==undefined){if(!allowedStatus.has(body.status))throw Object.assign(new Error('INVALID_DOCUMENT_REQUEST_STATUS'),{status:400});patch.status=body.status;}
    if(body.reviewer_notes!==undefined)patch.reviewer_notes=cleanText(body.reviewer_notes,{max:5000});
    if(body.status==='approved'||body.status==='rejected'){patch.reviewed_by=principal.id;}
    const data=await db('document_requests',{method:'PATCH',query:`?id=eq.${encodeURIComponent(requestMatch[1])}`,body:patch});
    if(!data.length)return json(res,404,{error:'DOCUMENT_REQUEST_NOT_FOUND',requestId},ch);
    await audit(principal,'document_request_updated','document_request',requestMatch[1],{case_id:data[0].case_id,client_id:data[0].client_id,status:data[0].status},req);
    return json(res,200,{data,requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/documents'){const cid=u.searchParams.get('case_id');const query=cid?`?case_id=eq.${encodeURIComponent(cid)}&select=*&archived_at=is.null&order=created_at.desc`:'?select=*&archived_at=is.null&order=created_at.desc&limit=250';let data;try{data=await db('documents',{query})}catch(error){if(error.status!==400)throw error;const legacyQuery=cid?`?case_id=eq.${encodeURIComponent(cid)}&select=*&order=created_at.desc`:'?select=*&order=created_at.desc&limit=250';data=await db('documents',{query:legacyQuery})}return json(res,200,{data,requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/documents/presign'){if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});const b=await readJson(req,32_768);const input=documentInput(b);const caseRows=await db('cases',{query:`?id=eq.${encodeURIComponent(input.caseId)}&select=id`});if(!Array.isArray(caseRows)||!caseRows.length)throw Object.assign(new Error('CASE_NOT_FOUND'),{status:404});const filename=safeKey(input.fileName).split('/').pop();const key=safeKey(`cases/${input.caseId}/${crypto.randomUUID()}-${filename}`);const uploadUrl=await getSignedUrl(r2,new PutObjectCommand({Bucket:r2Bucket,Key:key,ContentType:input.contentType,ContentLength:input.sizeBytes,Metadata:{case_id:input.caseId}}),{expiresIn:900});return json(res,200,{key,upload_url:uploadUrl,expires_in:900,required_headers:{'content-type':input.contentType},requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/documents/confirm'){if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});const b=await readJson(req,32_768);const input=documentInput(b);const key=safeKey(b.key);if(!key.startsWith(`cases/${input.caseId}/`))throw Object.assign(new Error('DOCUMENT_CASE_MISMATCH'),{status:403});const object=await r2.send(new HeadObjectCommand({Bucket:r2Bucket,Key:key}));if(Number(object.ContentLength)!==input.sizeBytes||String(object.ContentType||'').toLowerCase()!==input.contentType)throw Object.assign(new Error('UPLOADED_OBJECT_MISMATCH'),{status:409});const record={id:crypto.randomUUID(),case_id:input.caseId,object_key:key,file_name:input.fileName,content_type:input.contentType,size_bytes:input.sizeBytes,status:'uploaded'};if(b.client_id||b.person_id||b.request_id||b.category||b.replaces_document_id){if(b.client_id&&!uuid(b.client_id)||b.person_id&&!uuid(b.person_id)||b.request_id&&!uuid(b.request_id)||b.replaces_document_id&&!uuid(b.replaces_document_id))throw Object.assign(new Error('INVALID_DOCUMENT_METADATA'),{status:400});Object.assign(record,{client_id:b.client_id||null,person_id:b.person_id||null,request_id:b.request_id||null,category:cleanText(b.category,{max:100}),review_status:'received',replaces_document_id:b.replaces_document_id||null});if(b.replaces_document_id){const previous=await db('documents',{query:`?id=eq.${encodeURIComponent(b.replaces_document_id)}&select=id,version`});if(!previous.length)throw Object.assign(new Error('REPLACED_DOCUMENT_NOT_FOUND'),{status:404});record.version=Number(previous[0].version||1)+1;await db('documents',{method:'PATCH',query:`?id=eq.${encodeURIComponent(b.replaces_document_id)}`,body:{archived_at:new Date().toISOString()}})}}const data=await db('documents',{method:'POST',body:record});if(record.request_id)await db('document_requests',{method:'PATCH',query:`?id=eq.${encodeURIComponent(record.request_id)}`,body:{status:'received',updated_at:new Date().toISOString()}});await event(record.case_id,'document_uploaded',{document_id:record.id,file_name:record.file_name,client_id:record.client_id,case_id:record.case_id},principal,req);return json(res,201,{data,requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/documents/download-url'){if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});const b=await readJson(req,16_384);let rows=[];if(uuid(b.document_id))rows=await db('documents',{query:`?id=eq.${encodeURIComponent(b.document_id)}&select=*`});else if(principal?.authType==='internal'&&b.key)rows=await db('documents',{query:`?object_key=eq.${encodeURIComponent(safeKey(b.key))}&select=*`});else throw Object.assign(new Error('VALID_DOCUMENT_ID_REQUIRED'),{status:400});if(!Array.isArray(rows)||!rows.length)throw Object.assign(new Error('DOCUMENT_NOT_FOUND'),{status:404});const doc=rows[0];const downloadUrl=await getSignedUrl(r2,new GetObjectCommand({Bucket:r2Bucket,Key:doc.object_key,ResponseContentDisposition:`attachment; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`}),{expiresIn:300});await event(doc.case_id,'document_downloaded',{document_id:doc.id},principal,req);return json(res,200,{download_url:downloadUrl,expires_in:300,requestId},ch)}
  const reviewMatch=u.pathname.match(/^\/api\/v1\/documents\/([0-9a-f-]{36})\/review$/i);
  if(reviewMatch&&req.method==='POST'){
    const body=await readJson(req,32_768);
    if(!['approved','rejected'].includes(body.status))throw Object.assign(new Error('INVALID_DOCUMENT_REVIEW_STATUS'),{status:400});
    const patch={review_status:body.status,reviewer_notes:cleanText(body.reviewer_notes,{max:5000}),reviewed_by:principal.id,reviewed_at:new Date().toISOString()};
    const data=await db('documents',{method:'PATCH',query:`?id=eq.${encodeURIComponent(reviewMatch[1])}`,body:patch});
    if(!data.length)return json(res,404,{error:'DOCUMENT_NOT_FOUND',requestId},ch);
    await event(data[0].case_id,'document_reviewed',{document_id:reviewMatch[1],review_status:body.status,case_id:data[0].case_id,client_id:data[0].client_id},principal,req);
    return json(res,200,{data,requestId},ch);
  }
  const dm=u.pathname.match(/^\/api\/v1\/documents\/([0-9a-f-]{36})$/i);
  if(dm&&req.method==='PATCH'){
    const body=await readJson(req,32_768);
    const patch={};
    if(body.file_name!==undefined)patch.file_name=cleanText(body.file_name,{required:true,max:180});
    if(body.category!==undefined)patch.category=cleanText(body.category,{max:100});
    if(body.expires_on!==undefined)patch.expires_on=cleanDate(body.expires_on);
    if(body.archived===true)patch.archived_at=new Date().toISOString();
    if(body.archived===false)patch.archived_at=null;
    if(!Object.keys(patch).length)throw Object.assign(new Error('NO_VALID_FIELDS'),{status:400});
    const data=await db('documents',{method:'PATCH',query:`?id=eq.${encodeURIComponent(dm[1])}`,body:patch});
    if(!data.length)return json(res,404,{error:'DOCUMENT_NOT_FOUND',requestId},ch);
    await event(data[0].case_id,'document_updated',{document_id:dm[1],case_id:data[0].case_id,client_id:data[0].client_id},principal,req);
    return json(res,200,{data,requestId},ch);
  }
  if(dm&&req.method==='DELETE'){if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});const rows=await db('documents',{query:`?id=eq.${encodeURIComponent(dm[1])}&select=*`});if(!Array.isArray(rows)||!rows.length)return json(res,404,{error:'DOCUMENT_NOT_FOUND',requestId},ch);const doc=rows[0];await r2.send(new DeleteObjectCommand({Bucket:r2Bucket,Key:doc.object_key}));await db('documents',{method:'DELETE',query:`?id=eq.${encodeURIComponent(dm[1])}`});await event(doc.case_id,'document_deleted',{document_id:doc.id,file_name:doc.file_name},principal,req);return json(res,200,{deleted:true,requestId},ch)}

  if(req.method==='GET'&&u.pathname==='/api/v1/audit'){let data;try{data=await db('audit_events',{query:'?select=*&order=created_at.desc&limit=250'})}catch(error){if(error.status!==404)throw error;data=(await db('case_events',{query:'?select=*&order=created_at.desc&limit=150'})).map(item=>({...item,action:item.event_type,entity_id:item.case_id,actor_label:item.actor}))}return json(res,200,{data,requestId},ch)}
  return json(res,404,{error:'NOT_FOUND',requestId},ch);
}

const server=http.createServer((req,res)=>handle(req,res).catch(err=>{const status=Number(err.status||500);if(status>=500)console.error(err.message,err.details||'');json(res,status,{error:err.message||'INTERNAL_ERROR',...(status<500&&err.details?{details:err.details}:{}),requestId:res.getHeader('x-request-id')||crypto.randomUUID()},cors(req))}));
server.requestTimeout=30_000;server.headersTimeout=35_000;server.keepAliveTimeout=5_000;server.listen(port,'0.0.0.0',()=>console.log(`Alhijrah Caseflow ${version} listening on ${port}`));
