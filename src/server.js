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
  permissionsForRoles,
  principalFromUser,
  revokeSession,
  roleDefinitions,
  safeAuditContext,
  sessionTokens,
  setSessionCookies,
  signInWithPassword,
  updateAuthUser,
} from './auth.js';
import {
  canTransitionWorkflow,
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
const version = '2.7.0';
const service = 'alhijrah-caseflow-api';
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const internalApiKey = process.env.INTERNAL_API_KEY;
const applicationOwnerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
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

async function syncApplicationUser(user){
  const existing=await db('app_users',{query:`?auth_user_id=eq.${encodeURIComponent(user.id)}&select=auth_user_id`});
  const record={display_name:user.display_name||user.email,email:String(user.email||'').toLowerCase(),status:user.status||'active',updated_at:new Date().toISOString()};
  if(existing.length)await db('app_users',{method:'PATCH',query:`?auth_user_id=eq.${encodeURIComponent(user.id)}`,body:record});
  else await db('app_users',{method:'POST',body:{auth_user_id:user.id,...record}});
  if(Array.isArray(user.roles)){
    await db('user_roles',{method:'DELETE',query:`?auth_user_id=eq.${encodeURIComponent(user.id)}`});
    for(const role of user.roles)await db('user_roles',{method:'POST',body:{auth_user_id:user.id,role_code:role,assigned_by:user.assigned_by||null}});
  }
}

async function resolveApplicationPrincipal(principal){
  try{
    let users=await db('app_users',{query:`?auth_user_id=eq.${encodeURIComponent(principal.id)}&select=*`});
    const isConfiguredOwner=applicationOwnerEmail&&String(principal.email||'').toLowerCase()===applicationOwnerEmail;
    if(!users.length&&isConfiguredOwner){
      await syncApplicationUser({id:principal.id,email:principal.email,display_name:principal.displayName,status:'active',roles:['owner']});
      users=await db('app_users',{query:`?auth_user_id=eq.${encodeURIComponent(principal.id)}&select=*`});
    }
    if(!users.length)return principal;
    if(users[0].status==='inactive')throw Object.assign(new Error('USER_INACTIVE'),{status:403});
    const assignments=await db('user_roles',{query:`?auth_user_id=eq.${encodeURIComponent(principal.id)}&select=role_code`});
    const roles=assignments.map(item=>item.role_code).filter(role=>role in roleDefinitions);
    if(!roles.length)throw Object.assign(new Error('NO_ASSIGNED_ROLE'),{status:403});
    return {...principal,displayName:users[0].display_name||principal.displayName,roles,permissions:permissionsForRoles(roles)};
  }catch(error){
    if(error.message==='USER_INACTIVE'||error.message==='NO_ASSIGNED_ROLE')throw error;
    return principal;
  }
}

function requiredPermission(req,path){
  if(path.startsWith('/api/v1/portal/documents'))return 'portal.documents';
  if(path.startsWith('/api/v1/portal/intakes'))return 'portal.intake';
  if(path.startsWith('/api/v1/portal/messages'))return 'portal.messages';
  if(path.startsWith('/api/v1/portal'))return 'portal.view';
  if(path==='/api/v1/users')return req.method==='GET'?'users.view':'users.manage';
  if(/^\/api\/v1\/users\/[0-9a-f-]{36}$/i.test(path))return 'users.manage';
  if(path==='/api/v1/audit')return 'audit.view';
  if(path.startsWith('/api/v1/billing'))return req.method==='GET'?'billing.view':'billing.manage';
  if(path.startsWith('/api/v1/reports'))return 'reports.view';
  if(path.startsWith('/api/v1/review-queue'))return 'documents.review';
  if(path.startsWith('/api/v1/alerts'))return req.method==='GET'?'dashboard.view':'tasks.manage';
  if(path.startsWith('/api/v1/appointments'))return req.method==='GET'?'cases.view':'cases.manage';
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
  else{assertSameOrigin(req);principal=await resolveApplicationPrincipal(await authenticateSession(req,res))}
  if(!hasPermission(principal,permission))throw Object.assign(new Error('FORBIDDEN'),{status:403});
  return principal;
}

async function portalCase(principal,caseId){
  if(!uuid(caseId))throw Object.assign(new Error('INVALID_CASE_ID'),{status:400});
  if(principal.permissions.has('*')){
    const cases=await db('cases',{query:`?id=eq.${encodeURIComponent(caseId)}&archived_at=is.null&select=*`});
    if(!cases.length)throw Object.assign(new Error('CASE_NOT_FOUND'),{status:404});
    return cases[0];
  }
  const access=await db('client_access',{query:`?auth_user_id=eq.${encodeURIComponent(principal.id)}&status=eq.active&select=client_id,access_role`});
  if(!access.length)throw Object.assign(new Error('PORTAL_ACCESS_NOT_FOUND'),{status:403});
  const clientIds=access.map(item=>item.client_id);
  const cases=await db('cases',{query:`?id=eq.${encodeURIComponent(caseId)}&client_id=in.(${clientIds.map(encodeURIComponent).join(',')})&archived_at=is.null&select=*`});
  if(!cases.length)throw Object.assign(new Error('CASE_NOT_FOUND'),{status:404});
  return cases[0];
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
  if(req.method==='POST'&&u.pathname==='/api/v1/auth/login'){assertSameOrigin(req);const body=await readJson(req,16_384);const session=await signInWithPassword(body.email,body.password);const principal=await resolveApplicationPrincipal(principalFromUser(session.user));setSessionCookies(res,session);await audit(principal,'login','session',principal.id,{},req);return json(res,200,{user:{id:principal.id,email:principal.email,display_name:principal.displayName,roles:principal.roles},requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/auth/logout'){assertSameOrigin(req);let principal=null;try{principal=await authenticateSession(req,res)}catch{}const {accessToken}=sessionTokens(req);await revokeSession(accessToken);clearSessionCookies(res);await audit(principal,'logout','session',principal?.id||null,{},req);return json(res,200,{signedOut:true,requestId},ch)}
  if(req.method==='GET'&&u.pathname==='/api/v1/auth/me'){const principal=await resolveApplicationPrincipal(await authenticateSession(req,res));return json(res,200,{user:{id:principal.id,email:principal.email,display_name:principal.displayName,roles:principal.roles},requestId},ch)}

  let principal=null;
  if(u.pathname.startsWith('/api/'))principal=await authorize(req,res,requiredPermission(req,u.pathname));

  if(req.method==='GET'&&u.pathname==='/api/v1/portal'){
    const access=principal.permissions.has('*')?[]:await db('client_access',{query:`?auth_user_id=eq.${encodeURIComponent(principal.id)}&status=eq.active&select=client_id,access_role`});
    const clientIds=access.map(item=>item.client_id);
    if(!principal.permissions.has('*')&&!clientIds.length)return json(res,200,{data:{clients:[],cases:[],document_requests:[],appointments:[]},requestId},ch);
    const clientFilter=principal.permissions.has('*')?'':`&id=in.(${clientIds.map(encodeURIComponent).join(',')})`;
    const caseFilter=principal.permissions.has('*')?'':`&client_id=in.(${clientIds.map(encodeURIComponent).join(',')})`;
    const clients=await db('clients',{query:`?select=id,legal_name,preferred_language,email,phone&archived_at=is.null${clientFilter}`});
    const caseRows=await db('cases',{query:`?select=id,client_id,case_reference,case_type,service_code,workflow_stage,agency,receipt_number,updated_at&archived_at=is.null${caseFilter}&order=updated_at.desc`});
    const caseIds=caseRows.map(item=>item.id);
    const documentRequests=caseIds.length?await db('document_requests',{query:`?case_id=in.(${caseIds.map(encodeURIComponent).join(',')})&select=id,case_id,person_id,category,title,instructions,required,due_date,status,reviewer_notes,updated_at&order=created_at.desc`}):[];
    const appointments=clientIds.length?await db('appointments',{query:`?client_id=in.(${clientIds.map(encodeURIComponent).join(',')})&client_visible=eq.true&select=id,case_id,client_id,title,appointment_type,starts_at,ends_at,location,status&order=starts_at.asc`}):[];
    return json(res,200,{data:{clients,cases:caseRows,document_requests:documentRequests,appointments},requestId},ch);
  }

  const portalCaseMatch=u.pathname.match(/^\/api\/v1\/portal\/cases\/([0-9a-f-]{36})$/i);
  if(portalCaseMatch&&req.method==='GET'){
    const currentCase=await portalCase(principal,portalCaseMatch[1]);
    const [requests,appointments,messages,updates]=await Promise.all([
      db('document_requests',{query:`?case_id=eq.${encodeURIComponent(currentCase.id)}&select=id,person_id,category,title,instructions,required,due_date,status,reviewer_notes,updated_at&order=created_at.desc`}),
      db('appointments',{query:`?case_id=eq.${encodeURIComponent(currentCase.id)}&client_visible=eq.true&select=id,title,appointment_type,starts_at,ends_at,location,status&order=starts_at.asc`}),
      db('case_messages',{query:`?case_id=eq.${encodeURIComponent(currentCase.id)}&select=id,sender_type,body,created_at,edited_at&order=created_at.asc`}),
      db('case_notes',{query:`?case_id=eq.${encodeURIComponent(currentCase.id)}&visibility=eq.client&select=id,body,created_at,updated_at&order=created_at.desc`}),
    ]);
    const safeCase={id:currentCase.id,client_id:currentCase.client_id,case_reference:currentCase.case_reference,case_type:currentCase.case_type,service_code:currentCase.service_code,workflow_stage:currentCase.workflow_stage,agency:currentCase.agency,receipt_number:currentCase.receipt_number,updated_at:currentCase.updated_at};
    return json(res,200,{data:{case:safeCase,document_requests:requests,appointments,messages,updates},requestId},ch);
  }

  const portalMessagesMatch=u.pathname.match(/^\/api\/v1\/portal\/messages\/([0-9a-f-]{36})$/i);
  if(portalMessagesMatch&&req.method==='POST'){
    const currentCase=await portalCase(principal,portalMessagesMatch[1]);
    const body=await readJson(req,32_768);
    const record={id:crypto.randomUUID(),case_id:currentCase.id,sender_user_id:principal.id,sender_type:principal.roles.some(role=>role.startsWith('client_'))?'client':'staff',body:cleanText(body.body,{required:true,max:5000})};
    const data=await db('case_messages',{method:'POST',body:record});
    await audit(principal,'portal_message_sent','case_message',record.id,{case_id:currentCase.id,client_id:currentCase.client_id},req);
    return json(res,201,{data:data[0]||data,requestId},ch);
  }

  const portalIntakeMatch=u.pathname.match(/^\/api\/v1\/portal\/intakes\/([0-9a-f-]{36})\/([A-Za-z0-9-]+)$/i);
  if(portalIntakeMatch&&req.method==='GET'){
    const currentCase=await portalCase(principal,portalIntakeMatch[1]);
    const serviceCode=portalIntakeMatch[2].toUpperCase();
    if(currentCase.service_code!==serviceCode)throw Object.assign(new Error('CASE_SERVICE_MISMATCH'),{status:409});
    const definition=intakeDefinition(serviceCode);
    if(!definition)return json(res,404,{error:'INTAKE_DEFINITION_NOT_FOUND',requestId},ch);
    const definitionId=stableUuid('intake:'+serviceCode+':'+definition.version);
    const rows=await db('intake_submissions',{query:`?case_id=eq.${encodeURIComponent(currentCase.id)}&definition_id=eq.${definitionId}&select=id,answers,current_step,status,submitted_at,updated_at`});
    return json(res,200,{data:rows[0]||null,definition,requestId},ch);
  }
  if(portalIntakeMatch&&req.method==='POST'){
    const currentCase=await portalCase(principal,portalIntakeMatch[1]);
    const serviceCode=portalIntakeMatch[2].toUpperCase();
    if(currentCase.service_code!==serviceCode)throw Object.assign(new Error('CASE_SERVICE_MISMATCH'),{status:409});
    const definition=intakeDefinition(serviceCode);
    if(!definition)return json(res,404,{error:'INTAKE_DEFINITION_NOT_FOUND',requestId},ch);
    const body=await readJson(req,600_000);
    const status=body.status==='submitted'?'submitted':'draft';
    const answers=validateIntakeAnswers(definition,body.answers,{final:status==='submitted'});
    const currentStep=Math.max(0,Math.min(Number(body.current_step||0),definition.sections.length-1));
    const definitionId=stableUuid('intake:'+serviceCode+':'+definition.version);
    const definitions=await db('intake_definitions',{query:`?id=eq.${definitionId}&select=id`});
    if(!definitions.length)await db('intake_definitions',{method:'POST',body:{id:definitionId,service_code:serviceCode,version:definition.version,definition,active:true,published_at:new Date().toISOString(),created_by:principal.id}});
    const existing=await db('intake_submissions',{query:`?case_id=eq.${encodeURIComponent(currentCase.id)}&definition_id=eq.${definitionId}&select=id`});
    const mutation={answers,current_step:currentStep,status,submitted_at:status==='submitted'?new Date().toISOString():null,last_saved_by:principal.id,updated_at:new Date().toISOString()};
    const data=existing.length?await db('intake_submissions',{method:'PATCH',query:`?id=eq.${existing[0].id}`,body:mutation}):await db('intake_submissions',{method:'POST',body:{id:crypto.randomUUID(),case_id:currentCase.id,definition_id:definitionId,...mutation}});
    await audit(principal,status==='submitted'?'portal_intake_submitted':'portal_intake_saved','intake',data[0]?.id||existing[0]?.id,{case_id:currentCase.id,client_id:currentCase.client_id},req);
    return json(res,200,{data:data[0]||data,definition,requestId},ch);
  }

  if(req.method==='POST'&&u.pathname==='/api/v1/portal/documents/presign'){
    if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});
    const body=await readJson(req,32_768);
    const input=documentInput(body);
    await portalCase(principal,input.caseId);
    const key=`cases/${input.caseId}/${crypto.randomUUID()}-${safeKey(input.fileName)}`;
    const uploadUrl=await getSignedUrl(r2,new PutObjectCommand({Bucket:r2Bucket,Key:key,ContentType:input.contentType,ContentLength:input.sizeBytes}),{expiresIn:900});
    await audit(principal,'portal_document_upload_started','document',null,{case_id:input.caseId,file_name:input.fileName,size_bytes:input.sizeBytes},req);
    return json(res,200,{upload_url:uploadUrl,key,expires_in:900,requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/portal/documents/confirm'){
    if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});
    const body=await readJson(req,32_768);
    const input=documentInput(body);
    const currentCase=await portalCase(principal,input.caseId);
    const key=safeKey(body.key);
    if(!key.startsWith(`cases/${input.caseId}/`))throw Object.assign(new Error('DOCUMENT_CASE_MISMATCH'),{status:403});
    if(body.request_id){
      if(!uuid(body.request_id))throw Object.assign(new Error('INVALID_DOCUMENT_REQUEST'),{status:400});
      const requestRows=await db('document_requests',{query:`?id=eq.${encodeURIComponent(body.request_id)}&case_id=eq.${encodeURIComponent(input.caseId)}&select=id,person_id,category`});
      if(!requestRows.length)throw Object.assign(new Error('DOCUMENT_REQUEST_NOT_FOUND'),{status:404});
      body.person_id=requestRows[0].person_id;
      body.category=requestRows[0].category;
    }
    const object=await r2.send(new HeadObjectCommand({Bucket:r2Bucket,Key:key}));
    if(Number(object.ContentLength)!==input.sizeBytes||String(object.ContentType||'').toLowerCase()!==input.contentType)throw Object.assign(new Error('UPLOADED_OBJECT_MISMATCH'),{status:409});
    const record={id:crypto.randomUUID(),case_id:input.caseId,client_id:currentCase.client_id,person_id:body.person_id||null,request_id:body.request_id||null,object_key:key,file_name:input.fileName,content_type:input.contentType,size_bytes:input.sizeBytes,status:'uploaded',category:cleanText(body.category,{max:100}),review_status:'received'};
    const data=await db('documents',{method:'POST',body:record});
    if(record.request_id)await db('document_requests',{method:'PATCH',query:`?id=eq.${encodeURIComponent(record.request_id)}`,body:{status:'received',updated_at:new Date().toISOString()}});
    await audit(principal,'portal_document_uploaded','document',record.id,{case_id:record.case_id,client_id:record.client_id,request_id:record.request_id},req);
    return json(res,201,{data:data[0]||data,requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/portal/documents/download-url'){
    if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});
    const body=await readJson(req,8_192);
    if(!uuid(body.document_id))throw Object.assign(new Error('VALID_DOCUMENT_ID_REQUIRED'),{status:400});
    const rows=await db('documents',{query:`?id=eq.${encodeURIComponent(body.document_id)}&archived_at=is.null&select=id,case_id,object_key,file_name,content_type`});
    if(!rows.length)return json(res,404,{error:'DOCUMENT_NOT_FOUND',requestId},ch);
    await portalCase(principal,rows[0].case_id);
    const downloadUrl=await getSignedUrl(r2,new GetObjectCommand({Bucket:r2Bucket,Key:rows[0].object_key,ResponseContentDisposition:`attachment; filename*=UTF-8''${encodeURIComponent(rows[0].file_name)}`,ResponseContentType:rows[0].content_type}),{expiresIn:300});
    await audit(principal,'portal_document_downloaded','document',rows[0].id,{case_id:rows[0].case_id},req);
    return json(res,200,{download_url:downloadUrl,expires_in:300,requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/review-queue'){
    const [caseReviews,documentReviews]=await Promise.all([
      db('cases',{query:'?archived_at=is.null&review_state=in.(ready_for_review,under_review,changes_requested,ready_for_client)&select=id,client_id,case_reference,case_type,service_code,review_state,workflow_stage,priority,updated_at&order=updated_at.asc'}),
      db('documents',{query:'?archived_at=is.null&review_status=in.(received,under_review,rejected)&select=id,case_id,client_id,file_name,category,review_status,reviewer_notes,created_at&order=created_at.asc'}),
    ]);
    return json(res,200,{data:{cases:caseReviews,documents:documentReviews},requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/alerts'){
    const status=u.searchParams.get('status')||'open';
    if(!['open','acknowledged','resolved','dismissed'].includes(status))throw Object.assign(new Error('INVALID_ALERT_STATUS'),{status:400});
    const data=await db('alerts',{query:`?status=eq.${status}&select=*&order=due_at.asc.nullslast,created_at.desc&limit=250`});
    return json(res,200,{data,requestId},ch);
  }
  const alertMatch=u.pathname.match(/^\/api\/v1\/alerts\/([0-9a-f-]{36})$/i);
  if(alertMatch&&req.method==='PATCH'){
    const body=await readJson(req,8_192);
    if(!['acknowledged','resolved','dismissed'].includes(body.status))throw Object.assign(new Error('INVALID_ALERT_STATUS'),{status:400});
    const data=await db('alerts',{method:'PATCH',query:`?id=eq.${encodeURIComponent(alertMatch[1])}`,body:{status:body.status,updated_at:new Date().toISOString()}});
    if(!data.length)return json(res,404,{error:'ALERT_NOT_FOUND',requestId},ch);
    await audit(principal,'alert_updated','alert',alertMatch[1],{case_id:data[0].case_id,client_id:data[0].client_id,status:body.status},req);
    return json(res,200,{data:data[0],requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/appointments'){
    const caseId=u.searchParams.get('case_id');
    if(caseId&&!uuid(caseId))throw Object.assign(new Error('INVALID_CASE_ID'),{status:400});
    const data=await db('appointments',{query:`?select=*&order=starts_at.asc&limit=250${caseId?`&case_id=eq.${encodeURIComponent(caseId)}`:''}`});
    return json(res,200,{data,requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/appointments'){
    const body=await readJson(req,32_768);
    if(!uuid(body.client_id)||body.case_id&&!uuid(body.case_id))throw Object.assign(new Error('INVALID_APPOINTMENT_REFERENCE'),{status:400});
    const startsAt=new Date(body.starts_at);if(Number.isNaN(startsAt.getTime()))throw Object.assign(new Error('INVALID_APPOINTMENT_TIME'),{status:400});
    const endsAt=body.ends_at?new Date(body.ends_at):null;if(endsAt&&(!Number.isFinite(endsAt.getTime())||endsAt<=startsAt))throw Object.assign(new Error('INVALID_APPOINTMENT_TIME'),{status:400});
    const record={id:crypto.randomUUID(),case_id:body.case_id||null,client_id:body.client_id,title:cleanText(body.title,{required:true,max:200}),appointment_type:cleanText(body.appointment_type,{required:true,max:80}),starts_at:startsAt.toISOString(),ends_at:endsAt?.toISOString()||null,location:cleanText(body.location,{max:300}),status:'scheduled',client_visible:body.client_visible!==false,created_by:principal.id};
    const data=await db('appointments',{method:'POST',body:record});
    await audit(principal,'appointment_created','appointment',record.id,{case_id:record.case_id,client_id:record.client_id,starts_at:record.starts_at},req);
    return json(res,201,{data:data[0]||data,requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/billing/invoices'){
    const data=await db('invoices',{query:'?select=*&order=created_at.desc&limit=250'});
    return json(res,200,{data,requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/billing/invoices'){
    const body=await readJson(req,32_768);
    if(!uuid(body.client_id)||body.case_id&&!uuid(body.case_id))throw Object.assign(new Error('INVALID_INVOICE_REFERENCE'),{status:400});
    const cents=(value)=>{const number=Number(value||0);if(!Number.isSafeInteger(number)||number<0)throw Object.assign(new Error('INVALID_FEE_AMOUNT'),{status:400});return number;};
    const record={id:crypto.randomUUID(),invoice_number:`INV-${new Date().getUTCFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,client_id:body.client_id,case_id:body.case_id||null,currency:String(body.currency||'USD').toUpperCase(),status:'draft',office_fee_cents:cents(body.office_fee_cents),government_fee_cents:cents(body.government_fee_cents),other_fee_cents:cents(body.other_fee_cents),due_date:cleanDate(body.due_date),created_by:principal.id};
    if(!/^[A-Z]{3}$/.test(record.currency))throw Object.assign(new Error('INVALID_CURRENCY'),{status:400});
    const data=await db('invoices',{method:'POST',body:record});
    await audit(principal,'invoice_created','invoice',record.id,{case_id:record.case_id,client_id:record.client_id,amount_cents:record.office_fee_cents+record.government_fee_cents+record.other_fee_cents},req);
    return json(res,201,{data:data[0]||data,requestId},ch);
  }
  const invoiceMatch=u.pathname.match(/^\/api\/v1\/billing\/invoices\/([0-9a-f-]{36})$/i);
  if(invoiceMatch&&req.method==='PATCH'){
    const body=await readJson(req,16_384);const allowed=new Set(['draft','issued','partially_paid','paid','void','overdue']);
    if(!allowed.has(body.status))throw Object.assign(new Error('INVALID_INVOICE_STATUS'),{status:400});
    const patch={status:body.status,updated_at:new Date().toISOString()};if(body.status==='issued')patch.issued_at=new Date().toISOString();
    const data=await db('invoices',{method:'PATCH',query:`?id=eq.${encodeURIComponent(invoiceMatch[1])}`,body:patch});
    if(!data.length)return json(res,404,{error:'INVOICE_NOT_FOUND',requestId},ch);
    await audit(principal,'invoice_status_changed','invoice',invoiceMatch[1],{case_id:data[0].case_id,client_id:data[0].client_id,status:body.status},req);
    return json(res,200,{data:data[0],requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/billing/payments'){
    const body=await readJson(req,16_384);if(!uuid(body.invoice_id))throw Object.assign(new Error('VALID_INVOICE_ID_REQUIRED'),{status:400});
    const amount=Number(body.amount_cents);if(!Number.isSafeInteger(amount)||amount<1)throw Object.assign(new Error('INVALID_PAYMENT_AMOUNT'),{status:400});
    const invoices=await db('invoices',{query:`?id=eq.${encodeURIComponent(body.invoice_id)}&select=*`});if(!invoices.length)return json(res,404,{error:'INVOICE_NOT_FOUND',requestId},ch);
    const receivedAt=body.received_at?new Date(body.received_at):new Date();if(Number.isNaN(receivedAt.getTime()))throw Object.assign(new Error('INVALID_PAYMENT_DATE'),{status:400});
    const record={id:crypto.randomUUID(),invoice_id:body.invoice_id,amount_cents:amount,currency:invoices[0].currency,method:cleanText(body.method,{required:true,max:50}),external_reference:cleanText(body.external_reference,{max:120}),status:'recorded',received_at:receivedAt.toISOString(),created_by:principal.id};
    const data=await db('payments',{method:'POST',body:record});
    await audit(principal,'payment_recorded','payment',record.id,{case_id:invoices[0].case_id,client_id:invoices[0].client_id,invoice_id:record.invoice_id,amount_cents:amount},req);
    return json(res,201,{data:data[0]||data,requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/reports/summary'){
    const [caseRows,taskRows,deadlineRows,documentRows]=await Promise.all([db('cases',{query:'?archived_at=is.null&select=workflow_stage,priority'}),db('tasks',{query:'?archived_at=is.null&select=status,due_date,priority'}),db('deadlines',{query:'?status=eq.open&select=deadline_date'}),db('documents',{query:'?archived_at=is.null&select=review_status'})]);
    const countBy=(rows,key)=>rows.reduce((result,row)=>({...result,[row[key]||'unknown']:(result[row[key]||'unknown']||0)+1}),{});
    const today=new Date().toISOString().slice(0,10);
    return json(res,200,{data:{cases:{total:caseRows.length,by_stage:countBy(caseRows,'workflow_stage'),by_priority:countBy(caseRows,'priority')},tasks:{total:taskRows.length,overdue:taskRows.filter(item=>item.status!=='completed'&&item.due_date&&item.due_date<today).length,by_status:countBy(taskRows,'status')},deadlines:{open:deadlineRows.length,overdue:deadlineRows.filter(item=>item.deadline_date<today).length},documents:{total:documentRows.length,by_review_status:countBy(documentRows,'review_status')}},requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/users'){const data=await listAuthUsers();return json(res,200,{data,requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/users'){const body=await readJson(req,32_768);const data=await inviteAuthUser({email:body.email,displayName:body.display_name,roles:body.roles});await syncApplicationUser({...data,display_name:body.display_name,assigned_by:principal.id});await audit(principal,'user_invited','user',data.id,{roles:data.roles},req);return json(res,201,{data,requestId},ch)}
  const um=u.pathname.match(/^\/api\/v1\/users\/([0-9a-f-]{36})$/i);
  if(um&&req.method==='PATCH'){const body=await readJson(req,32_768);if(um[1]===principal.id&&body.status==='inactive')throw Object.assign(new Error('CANNOT_DEACTIVATE_CURRENT_USER'),{status:409});if(Array.isArray(body.roles)&&!body.roles.includes('owner')&&applicationOwnerEmail){const target=(await listAuthUsers()).find(user=>user.id===um[1]);if(String(target?.email||'').toLowerCase()===applicationOwnerEmail)throw Object.assign(new Error('APPLICATION_OWNER_ROLE_REQUIRED'),{status:409});}const data=await updateAuthUser(um[1],{displayName:body.display_name,roles:body.roles,status:body.status});await syncApplicationUser({...data,assigned_by:principal.id});await audit(principal,'user_updated','user',data.id,{roles:data.roles,status:data.status},req);return json(res,200,{data,requestId},ch)}

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

  const clientAccessMatch=u.pathname.match(/^\/api\/v1\/clients\/([0-9a-f-]{36})\/access$/i);
  if(clientAccessMatch&&req.method==='GET'){
    const data=await db('client_access',{query:`?client_id=eq.${encodeURIComponent(clientAccessMatch[1])}&select=*&order=granted_at`});
    return json(res,200,{data,requestId},ch);
  }
  if(clientAccessMatch&&req.method==='POST'){
    const body=await readJson(req,16_384);
    if(!uuid(body.auth_user_id))throw Object.assign(new Error('VALID_USER_ID_REQUIRED'),{status:400});
    const accessRole=String(body.access_role||'collaborator');
    if(!['owner','collaborator'].includes(accessRole))throw Object.assign(new Error('INVALID_CLIENT_ACCESS_ROLE'),{status:400});
    const existing=await db('client_access',{query:`?client_id=eq.${encodeURIComponent(clientAccessMatch[1])}&auth_user_id=eq.${encodeURIComponent(body.auth_user_id)}&select=client_id`});
    const record={access_role:accessRole,status:'active',granted_by:principal.id,granted_at:new Date().toISOString(),revoked_at:null};
    const data=existing.length?await db('client_access',{method:'PATCH',query:`?client_id=eq.${encodeURIComponent(clientAccessMatch[1])}&auth_user_id=eq.${encodeURIComponent(body.auth_user_id)}`,body:record}):await db('client_access',{method:'POST',body:{client_id:clientAccessMatch[1],auth_user_id:body.auth_user_id,...record}});
    await audit(principal,'client_portal_access_granted','client',clientAccessMatch[1],{client_id:clientAccessMatch[1],auth_user_id:body.auth_user_id,access_role:accessRole},req);
    return json(res,200,{data:data[0]||data,requestId},ch);
  }

  const clientAccessUserMatch=u.pathname.match(/^\/api\/v1\/clients\/([0-9a-f-]{36})\/access\/([0-9a-f-]{36})$/i);
  if(clientAccessUserMatch&&req.method==='DELETE'){
    const data=await db('client_access',{method:'PATCH',query:`?client_id=eq.${encodeURIComponent(clientAccessUserMatch[1])}&auth_user_id=eq.${encodeURIComponent(clientAccessUserMatch[2])}`,body:{status:'revoked',revoked_at:new Date().toISOString()}});
    if(!data.length)return json(res,404,{error:'CLIENT_ACCESS_NOT_FOUND',requestId},ch);
    await audit(principal,'client_portal_access_revoked','client',clientAccessUserMatch[1],{client_id:clientAccessUserMatch[1],auth_user_id:clientAccessUserMatch[2]},req);
    return json(res,200,{data:data[0],requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/tasks'){
    const limit=Math.min(Math.max(Number(u.searchParams.get('limit')||100),1),250);
    const status=u.searchParams.get('status');
    const caseId=u.searchParams.get('case_id');
    const clientId=u.searchParams.get('client_id');
    const assignedTo=u.searchParams.get('assigned_to');
    let query=`?select=*&archived_at=is.null&order=due_date.asc.nullslast,created_at.desc&limit=${limit}`;
    if(status)query+=`&status=eq.${encodeURIComponent(cleanTaskStatus(status))}`;
    if(caseId){if(!uuid(caseId))throw Object.assign(new Error('INVALID_CASE_ID'),{status:400});query+=`&case_id=eq.${encodeURIComponent(caseId)}`;}
    if(clientId){if(!uuid(clientId))throw Object.assign(new Error('INVALID_CLIENT_ID'),{status:400});query+=`&client_id=eq.${encodeURIComponent(clientId)}`;}
    if(assignedTo==='me'){if(!principal.id)throw Object.assign(new Error('USER_SESSION_REQUIRED'),{status:400});query+=`&assigned_user_id=eq.${encodeURIComponent(principal.id)}`;}
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

  const deadlineMatch=u.pathname.match(/^\/api\/v1\/deadlines\/([0-9a-f-]{36})$/i);
  if(deadlineMatch&&req.method==='PATCH'){
    const rows=await db('deadlines',{query:`?id=eq.${encodeURIComponent(deadlineMatch[1])}&select=*`});
    if(!rows.length)return json(res,404,{error:'DEADLINE_NOT_FOUND',requestId},ch);
    const body=await readJson(req);
    const status=body.status===undefined?rows[0].status:String(body.status);
    if(!['open','completed','cancelled'].includes(status))throw Object.assign(new Error('INVALID_DEADLINE_STATUS'),{status:400});
    const patch={title:body.title===undefined?rows[0].title:cleanText(body.title,{required:true,max:200}),deadline_date:body.deadline_date===undefined?rows[0].deadline_date:cleanDate(body.deadline_date,{required:true}),deadline_type:body.deadline_type===undefined?rows[0].deadline_type:cleanText(body.deadline_type,{required:true,max:80}),source:body.source===undefined?rows[0].source:cleanText(body.source,{max:200}),notes:body.notes===undefined?rows[0].notes:cleanText(body.notes,{max:5000}),status,completed_at:status==='completed'?(rows[0].completed_at||new Date().toISOString()):null,updated_by:principal.id,updated_at:new Date().toISOString()};
    const data=await db('deadlines',{method:'PATCH',query:`?id=eq.${encodeURIComponent(deadlineMatch[1])}`,body:patch});
    await audit(principal,status==='completed'?'deadline_completed':'deadline_updated','deadline',deadlineMatch[1],{case_id:rows[0].case_id,deadline_date:patch.deadline_date,status},req);
    return json(res,200,{data,requestId},ch);
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
    if(b.workflow_stage){
      const rows=await db('cases',{query:`?id=eq.${encodeURIComponent(cm[1])}&select=id,workflow_stage`});
      if(!rows.length)return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
      if(!canTransitionWorkflow(rows[0].workflow_stage,b.workflow_stage))throw Object.assign(new Error('WORKFLOW_TRANSITION_NOT_ALLOWED'),{status:409,details:{from:rows[0].workflow_stage,to:b.workflow_stage}});
    }
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

  const caseWorkspaceMatch=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})\/workspace$/i);
  if(caseWorkspaceMatch&&req.method==='GET'){
    const caseId=caseWorkspaceMatch[1];
    const caseRows=await db('cases',{query:`?id=eq.${encodeURIComponent(caseId)}&select=*`});
    if(!caseRows.length)return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
    const [people,assignments,tasks,deadlines,documents,requests,notes,appointments,events]=await Promise.all([
      db('case_people',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=case_role,created_at,people(*)&order=created_at`}),
      db('case_assignments',{query:`?case_id=eq.${encodeURIComponent(caseId)}&active=eq.true&select=*&order=assigned_at`}),
      db('tasks',{query:`?case_id=eq.${encodeURIComponent(caseId)}&archived_at=is.null&select=*&order=due_date.asc.nullslast`}),
      db('deadlines',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=*&order=deadline_date.asc`}),
      db('documents',{query:`?case_id=eq.${encodeURIComponent(caseId)}&archived_at=is.null&select=*&order=created_at.desc`}),
      db('document_requests',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=*&order=created_at.desc`}),
      db('case_notes',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=*&order=created_at.desc`}),
      db('appointments',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=*&order=starts_at.asc`}),
      db('case_events',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=*&order=created_at.desc&limit=250`}),
    ]);
    return json(res,200,{data:{case:caseRows[0],people,assignments,tasks,deadlines,documents,document_requests:requests,notes,appointments,timeline:events},requestId},ch);
  }

  const caseNotesMatch=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})\/notes$/i);
  if(caseNotesMatch&&req.method==='GET'){
    const data=await db('case_notes',{query:`?case_id=eq.${encodeURIComponent(caseNotesMatch[1])}&select=*&order=created_at.desc`});
    return json(res,200,{data,requestId},ch);
  }
  if(caseNotesMatch&&req.method==='POST'){
    const body=await readJson(req,32_768);const visibility=body.visibility||'internal';if(!['internal','client'].includes(visibility))throw Object.assign(new Error('INVALID_NOTE_VISIBILITY'),{status:400});
    const record={id:crypto.randomUUID(),case_id:caseNotesMatch[1],body:cleanText(body.body,{required:true,max:10000}),visibility,created_by:principal.id};
    const data=await db('case_notes',{method:'POST',body:record});
    await audit(principal,'case_note_created','case_note',record.id,{case_id:record.case_id,visibility},req);
    return json(res,201,{data:data[0]||data,requestId},ch);
  }

  const caseAssignmentsMatch=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})\/assignments$/i);
  if(caseAssignmentsMatch&&req.method==='GET'){
    const data=await db('case_assignments',{query:`?case_id=eq.${encodeURIComponent(caseAssignmentsMatch[1])}&active=eq.true&select=*&order=assigned_at`});
    return json(res,200,{data,requestId},ch);
  }
  if(caseAssignmentsMatch&&req.method==='POST'){
    const body=await readJson(req,16_384);if(!uuid(body.auth_user_id))throw Object.assign(new Error('VALID_USER_ID_REQUIRED'),{status:400});
    const assignmentRole=String(body.assignment_role||'collaborator');if(!['lead','collaborator','reviewer','preparer'].includes(assignmentRole))throw Object.assign(new Error('INVALID_ASSIGNMENT_ROLE'),{status:400});
    const existing=await db('case_assignments',{query:`?case_id=eq.${encodeURIComponent(caseAssignmentsMatch[1])}&auth_user_id=eq.${encodeURIComponent(body.auth_user_id)}&assignment_role=eq.${assignmentRole}&select=case_id`});
    const values={active:true,assigned_by:principal.id,assigned_at:new Date().toISOString(),ended_at:null};
    const data=existing.length?await db('case_assignments',{method:'PATCH',query:`?case_id=eq.${encodeURIComponent(caseAssignmentsMatch[1])}&auth_user_id=eq.${encodeURIComponent(body.auth_user_id)}&assignment_role=eq.${assignmentRole}`,body:values}):await db('case_assignments',{method:'POST',body:{case_id:caseAssignmentsMatch[1],auth_user_id:body.auth_user_id,assignment_role:assignmentRole,...values}});
    await audit(principal,'case_assigned','case',caseAssignmentsMatch[1],{case_id:caseAssignmentsMatch[1],auth_user_id:body.auth_user_id,assignment_role:assignmentRole},req);
    return json(res,200,{data:data[0]||data,requestId},ch);
  }

  const caseAssignmentMatch=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})\/assignments\/([0-9a-f-]{36})\/([a-z_]+)$/i);
  if(caseAssignmentMatch&&req.method==='DELETE'){
    const data=await db('case_assignments',{method:'PATCH',query:`?case_id=eq.${encodeURIComponent(caseAssignmentMatch[1])}&auth_user_id=eq.${encodeURIComponent(caseAssignmentMatch[2])}&assignment_role=eq.${encodeURIComponent(caseAssignmentMatch[3])}`,body:{active:false,ended_at:new Date().toISOString()}});
    if(!data.length)return json(res,404,{error:'CASE_ASSIGNMENT_NOT_FOUND',requestId},ch);
    await audit(principal,'case_unassigned','case',caseAssignmentMatch[1],{case_id:caseAssignmentMatch[1],auth_user_id:caseAssignmentMatch[2],assignment_role:caseAssignmentMatch[3]},req);
    return json(res,200,{data:data[0],requestId},ch);
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
