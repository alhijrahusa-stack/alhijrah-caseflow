import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
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

const port = Number(process.env.PORT || 3000);
const version = '2.2.0';
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
function documentInput(body){const caseId=String(body.case_id||'');if(!uuid(caseId))throw Object.assign(new Error('VALID_CASE_ID_REQUIRED'),{status:400});const fileName=String(body.filename||body.file_name||'').trim().slice(0,180);if(!fileName||/[\x00-\x1f]/.test(fileName))throw Object.assign(new Error('VALID_FILENAME_REQUIRED'),{status:400});const contentType=String(body.content_type||'').toLowerCase();if(!allowedDocumentTypes.has(contentType))throw Object.assign(new Error('UNSUPPORTED_DOCUMENT_TYPE'),{status:415});const sizeBytes=Number(body.size_bytes);if(!Number.isSafeInteger(sizeBytes)||sizeBytes<1||sizeBytes>25*1024*1024)throw Object.assign(new Error('DOCUMENT_SIZE_NOT_ALLOWED'),{status:413});return{caseId,fileName,contentType,sizeBytes}}
async function audit(principal,action,entityType,entityId,payload={},req){try{await db('audit_events',{method:'POST',body:{id:crypto.randomUUID(),actor_user_id:principal?.id||null,actor_label:principal?.displayName||'System',action,entity_type:entityType,entity_id:entityId||null,metadata:{...payload,...(req?safeAuditContext(req):{})}}})}catch(e){console.error('audit-write-failed',e.message)}}
async function event(caseId,type,payload={},principal,req){try{await db('case_events',{method:'POST',body:{id:crypto.randomUUID(),case_id:caseId,event_type:type,actor:principal?.displayName||'Caseflow Workspace',payload}})}catch(e){console.error('event-write-failed',e.message)}await audit(principal,type,'case',caseId,payload,req)}

function requiredPermission(req,path){
  if(path==='/api/v1/users')return req.method==='GET'?'users.view':'users.manage';
  if(/^\/api\/v1\/users\/[0-9a-f-]{36}$/i.test(path))return 'users.manage';
  if(path==='/api/v1/audit')return 'audit.view';
  if(path.startsWith('/api/v1/documents'))return req.method==='GET'||path.endsWith('/download-url')?'documents.view':'documents.manage';
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
  if(req.method==='GET'&&u.pathname==='/ready'){const authStatus=await getAuthProvisioningStatus();const checks={supabase:Boolean(supabaseUrl&&supabaseServiceKey),r2:Boolean(r2&&r2Bucket),internalAuth:Boolean(internalApiKey),userAuth:authStatus.configured,ownerAccount:authStatus.ownerProvisioned},ready=checks.supabase&&checks.r2&&checks.internalAuth;return json(res,ready?200:503,{status:ready?'ready':'not-ready',service,version,checks,requestId},ch)}

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

  if(req.method==='GET'&&u.pathname==='/api/v1/cases'){const limit=Math.min(Math.max(Number(u.searchParams.get('limit')||100),1),250);const data=await db('cases',{query:`?select=*&order=created_at.desc&limit=${limit}`});return json(res,200,{data,requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/cases'){const b=await readJson(req);if(!b.client_name||!b.case_type)throw Object.assign(new Error('client_name_and_case_type_required'),{status:400});const record={id:crypto.randomUUID(),client_name:String(b.client_name).trim(),case_type:String(b.case_type).trim(),status:String(b.status||'intake').trim(),priority:String(b.priority||'normal').trim(),assigned_to:b.assigned_to||null,notes:b.notes||null};const data=await db('cases',{method:'POST',body:record});await event(record.id,'case_created',{case_type:record.case_type,priority:record.priority},principal,req);return json(res,201,{data,requestId},ch)}
  const cm=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})$/i);
  if(cm&&req.method==='GET'){const data=await db('cases',{query:`?id=eq.${encodeURIComponent(cm[1])}&select=*`});if(!Array.isArray(data)||!data.length)return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);return json(res,200,{data:data[0],requestId},ch)}
  if(cm&&req.method==='PATCH'){const b=await readJson(req);const allowed=['client_name','case_type','status','priority','assigned_to','notes'];const patch=Object.fromEntries(Object.entries(b).filter(([k])=>allowed.includes(k)));if(!Object.keys(patch).length)throw Object.assign(new Error('NO_VALID_FIELDS'),{status:400});patch.updated_at=new Date().toISOString();const data=await db('cases',{method:'PATCH',query:`?id=eq.${encodeURIComponent(cm[1])}`,body:patch});await event(cm[1],'case_updated',patch,principal,req);return json(res,200,{data,requestId},ch)}

  if(req.method==='GET'&&u.pathname==='/api/v1/documents'){const cid=u.searchParams.get('case_id');const query=cid?`?case_id=eq.${encodeURIComponent(cid)}&select=*&order=created_at.desc`:'?select=*&order=created_at.desc&limit=250';const data=await db('documents',{query});return json(res,200,{data,requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/documents/presign'){if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});const b=await readJson(req,32_768);const input=documentInput(b);const caseRows=await db('cases',{query:`?id=eq.${encodeURIComponent(input.caseId)}&select=id`});if(!Array.isArray(caseRows)||!caseRows.length)throw Object.assign(new Error('CASE_NOT_FOUND'),{status:404});const filename=safeKey(input.fileName).split('/').pop();const key=safeKey(`cases/${input.caseId}/${crypto.randomUUID()}-${filename}`);const uploadUrl=await getSignedUrl(r2,new PutObjectCommand({Bucket:r2Bucket,Key:key,ContentType:input.contentType,ContentLength:input.sizeBytes,Metadata:{case_id:input.caseId}}),{expiresIn:900});return json(res,200,{key,upload_url:uploadUrl,expires_in:900,required_headers:{'content-type':input.contentType},requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/documents/confirm'){if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});const b=await readJson(req,32_768);const input=documentInput(b);const key=safeKey(b.key);if(!key.startsWith(`cases/${input.caseId}/`))throw Object.assign(new Error('DOCUMENT_CASE_MISMATCH'),{status:403});const object=await r2.send(new HeadObjectCommand({Bucket:r2Bucket,Key:key}));if(Number(object.ContentLength)!==input.sizeBytes||String(object.ContentType||'').toLowerCase()!==input.contentType)throw Object.assign(new Error('UPLOADED_OBJECT_MISMATCH'),{status:409});const record={id:crypto.randomUUID(),case_id:input.caseId,object_key:key,file_name:input.fileName,content_type:input.contentType,size_bytes:input.sizeBytes,status:'uploaded'};const data=await db('documents',{method:'POST',body:record});await event(record.case_id,'document_uploaded',{document_id:record.id,file_name:record.file_name},principal,req);return json(res,201,{data,requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/documents/download-url'){if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});const b=await readJson(req,16_384);let rows=[];if(uuid(b.document_id))rows=await db('documents',{query:`?id=eq.${encodeURIComponent(b.document_id)}&select=*`});else if(principal?.authType==='internal'&&b.key)rows=await db('documents',{query:`?object_key=eq.${encodeURIComponent(safeKey(b.key))}&select=*`});else throw Object.assign(new Error('VALID_DOCUMENT_ID_REQUIRED'),{status:400});if(!Array.isArray(rows)||!rows.length)throw Object.assign(new Error('DOCUMENT_NOT_FOUND'),{status:404});const doc=rows[0];const downloadUrl=await getSignedUrl(r2,new GetObjectCommand({Bucket:r2Bucket,Key:doc.object_key,ResponseContentDisposition:`attachment; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`}),{expiresIn:300});await event(doc.case_id,'document_downloaded',{document_id:doc.id},principal,req);return json(res,200,{download_url:downloadUrl,expires_in:300,requestId},ch)}
  const dm=u.pathname.match(/^\/api\/v1\/documents\/([0-9a-f-]{36})$/i);
  if(dm&&req.method==='DELETE'){if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});const rows=await db('documents',{query:`?id=eq.${encodeURIComponent(dm[1])}&select=*`});if(!Array.isArray(rows)||!rows.length)return json(res,404,{error:'DOCUMENT_NOT_FOUND',requestId},ch);const doc=rows[0];await r2.send(new DeleteObjectCommand({Bucket:r2Bucket,Key:doc.object_key}));await db('documents',{method:'DELETE',query:`?id=eq.${encodeURIComponent(dm[1])}`});await event(doc.case_id,'document_deleted',{document_id:doc.id,file_name:doc.file_name},principal,req);return json(res,200,{deleted:true,requestId},ch)}

  if(req.method==='GET'&&u.pathname==='/api/v1/audit'){const data=await db('case_events',{query:'?select=*&order=created_at.desc&limit=150'});return json(res,200,{data,requestId},ch)}
  return json(res,404,{error:'NOT_FOUND',requestId},ch);
}

const server=http.createServer((req,res)=>handle(req,res).catch(err=>{const status=Number(err.status||500);if(status>=500)console.error(err.message,err.details||'');json(res,status,{error:err.message||'INTERNAL_ERROR',...(status<500&&err.details?{details:err.details}:{}),requestId:res.getHeader('x-request-id')||crypto.randomUUID()},cors(req))}));
server.requestTimeout=30_000;server.headersTimeout=35_000;server.keepAliveTimeout=5_000;server.listen(port,'0.0.0.0',()=>console.log(`Alhijrah Caseflow ${version} listening on ${port}`));
