import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const port = Number(process.env.PORT || 3000);
const version = '2.1.0';
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

function securityHeaders(){return {'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','strict-transport-security':'max-age=31536000; includeSubDomains'}}
function json(res,status,body,extra={}){res.writeHead(status,{'content-type':'application/json; charset=utf-8',...securityHeaders(),...extra});res.end(JSON.stringify(body))}
function cors(req){const origin=req.headers.origin;const allowed=(process.env.CORS_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean);if(!origin||!allowed.includes(origin))return {};return {'access-control-allow-origin':origin,'access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','access-control-allow-headers':'content-type,x-api-key,x-request-id','access-control-max-age':'86400',vary:'Origin'}}
async function readJson(req,max=1_000_000){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>max)throw Object.assign(new Error('PAYLOAD_TOO_LARGE'),{status:413});chunks.push(c)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{throw Object.assign(new Error('INVALID_JSON'),{status:400})}}
function auth(req){if(!internalApiKey)throw Object.assign(new Error('API_NOT_CONFIGURED'),{status:503});const supplied=req.headers['x-api-key'];if(typeof supplied!=='string')throw Object.assign(new Error('UNAUTHORIZED'),{status:401});const a=Buffer.from(supplied),b=Buffer.from(internalApiKey);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw Object.assign(new Error('UNAUTHORIZED'),{status:401})}
async function db(path,{method='GET',body,query=''}={}){if(!supabaseUrl||!supabaseServiceKey)throw Object.assign(new Error('SUPABASE_NOT_CONFIGURED'),{status:503});const r=await fetch(`${supabaseUrl}/rest/v1/${path}${query}`,{method,headers:{apikey:supabaseServiceKey,authorization:`Bearer ${supabaseServiceKey}`,'content-type':'application/json',prefer:method==='POST'||method==='PATCH'?'return=representation':''},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok){const e=new Error('DATABASE_REQUEST_FAILED');e.status=r.status>=500?502:r.status;e.details=data;throw e}return data}
function safeKey(x){const c=String(x||'').replace(/[^a-zA-Z0-9._/-]/g,'_').replace(/\.\./g,'_');if(!c||c.startsWith('/'))throw Object.assign(new Error('INVALID_OBJECT_KEY'),{status:400});return c}
async function event(caseId,type,payload={}){try{await db('case_events',{method:'POST',body:{id:crypto.randomUUID(),case_id:caseId,event_type:type,actor:'Caseflow Workspace',payload}})}catch(e){console.error('event-write-failed',e.message)}}

async function handle(req,res){
  const requestId=req.headers['x-request-id']||crypto.randomUUID();res.setHeader('x-request-id',requestId);const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);const ch=cors(req);
  if(req.method==='OPTIONS'){res.writeHead(204,{...securityHeaders(),...ch});return res.end()}
  if(req.method==='GET'&&u.pathname==='/'){const html=fs.readFileSync(new URL('./public/index.html',import.meta.url));res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff'});return res.end(html)}
  if(req.method==='GET'&&u.pathname==='/health')return json(res,200,{status:'ok',service,version,requestId},ch);
  if(req.method==='GET'&&u.pathname==='/ready'){const checks={supabase:Boolean(supabaseUrl&&supabaseServiceKey),r2:Boolean(r2&&r2Bucket),internalAuth:Boolean(internalApiKey)},ready=Object.values(checks).every(Boolean);return json(res,ready?200:503,{status:ready?'ready':'not-ready',service,version,checks,requestId},ch)}
  if(u.pathname.startsWith('/api/'))auth(req);

  if(req.method==='GET'&&u.pathname==='/api/v1/cases'){const limit=Math.min(Math.max(Number(u.searchParams.get('limit')||100),1),250);const data=await db('cases',{query:`?select=*&order=created_at.desc&limit=${limit}`});return json(res,200,{data,requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/cases'){const b=await readJson(req);if(!b.client_name||!b.case_type)throw Object.assign(new Error('client_name_and_case_type_required'),{status:400});const record={id:crypto.randomUUID(),client_name:String(b.client_name).trim(),case_type:String(b.case_type).trim(),status:String(b.status||'intake').trim(),priority:String(b.priority||'normal').trim(),assigned_to:b.assigned_to||null,notes:b.notes||null};const data=await db('cases',{method:'POST',body:record});await event(record.id,'case_created',{case_type:record.case_type,priority:record.priority});return json(res,201,{data,requestId},ch)}
  const cm=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})$/i);
  if(cm&&req.method==='GET'){const data=await db('cases',{query:`?id=eq.${encodeURIComponent(cm[1])}&select=*`});if(!Array.isArray(data)||!data.length)return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);return json(res,200,{data:data[0],requestId},ch)}
  if(cm&&req.method==='PATCH'){const b=await readJson(req);const allowed=['client_name','case_type','status','priority','assigned_to','notes'];const patch=Object.fromEntries(Object.entries(b).filter(([k])=>allowed.includes(k)));if(!Object.keys(patch).length)throw Object.assign(new Error('NO_VALID_FIELDS'),{status:400});patch.updated_at=new Date().toISOString();const data=await db('cases',{method:'PATCH',query:`?id=eq.${encodeURIComponent(cm[1])}`,body:patch});await event(cm[1],'case_updated',patch);return json(res,200,{data,requestId},ch)}

  if(req.method==='GET'&&u.pathname==='/api/v1/documents'){const cid=u.searchParams.get('case_id');const query=cid?`?case_id=eq.${encodeURIComponent(cid)}&select=*&order=created_at.desc`:'?select=*&order=created_at.desc&limit=250';const data=await db('documents',{query});return json(res,200,{data,requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/documents/presign'){if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});const b=await readJson(req);if(!b.case_id)throw Object.assign(new Error('case_id_required'),{status:400});const filename=safeKey(b.filename||'document.bin').split('/').pop();const key=safeKey(`cases/${b.case_id}/${crypto.randomUUID()}-${filename}`);const uploadUrl=await getSignedUrl(r2,new PutObjectCommand({Bucket:r2Bucket,Key:key,ContentType:String(b.content_type||'application/octet-stream'),Metadata:{case_id:String(b.case_id)}}),{expiresIn:900});return json(res,200,{key,upload_url:uploadUrl,expires_in:900,requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/documents/confirm'){const b=await readJson(req);if(!b.case_id||!b.key||!b.file_name)throw Object.assign(new Error('document_metadata_required'),{status:400});const record={id:crypto.randomUUID(),case_id:String(b.case_id),object_key:safeKey(b.key),file_name:String(b.file_name),content_type:b.content_type||null,size_bytes:Number(b.size_bytes||0),status:'uploaded'};const data=await db('documents',{method:'POST',body:record});await event(record.case_id,'document_uploaded',{document_id:record.id,file_name:record.file_name});return json(res,201,{data,requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/documents/download-url'){if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});const b=await readJson(req);const key=safeKey(b.key);const downloadUrl=await getSignedUrl(r2,new GetObjectCommand({Bucket:r2Bucket,Key:key}),{expiresIn:300});return json(res,200,{download_url:downloadUrl,expires_in:300,requestId},ch)}
  const dm=u.pathname.match(/^\/api\/v1\/documents\/([0-9a-f-]{36})$/i);
  if(dm&&req.method==='DELETE'){if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});const rows=await db('documents',{query:`?id=eq.${encodeURIComponent(dm[1])}&select=*`});if(!Array.isArray(rows)||!rows.length)return json(res,404,{error:'DOCUMENT_NOT_FOUND',requestId},ch);const doc=rows[0];await r2.send(new DeleteObjectCommand({Bucket:r2Bucket,Key:doc.object_key}));await db('documents',{method:'DELETE',query:`?id=eq.${encodeURIComponent(dm[1])}`});await event(doc.case_id,'document_deleted',{document_id:doc.id,file_name:doc.file_name});return json(res,200,{deleted:true,requestId},ch)}

  if(req.method==='GET'&&u.pathname==='/api/v1/audit'){const data=await db('case_events',{query:'?select=*&order=created_at.desc&limit=150'});return json(res,200,{data,requestId},ch)}
  return json(res,404,{error:'NOT_FOUND',requestId},ch);
}

const server=http.createServer((req,res)=>handle(req,res).catch(err=>{const status=Number(err.status||500);if(status>=500)console.error(err.message,err.details||'');json(res,status,{error:err.message||'INTERNAL_ERROR',...(status<500&&err.details?{details:err.details}:{}),requestId:res.getHeader('x-request-id')||crypto.randomUUID()},cors(req))}));
server.requestTimeout=30_000;server.headersTimeout=35_000;server.keepAliveTimeout=5_000;server.listen(port,'0.0.0.0',()=>console.log(`Alhijrah Caseflow ${version} listening on ${port}`));
