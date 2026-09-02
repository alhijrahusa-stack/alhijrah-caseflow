import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  acceptInvitedUser,
  assertSameOrigin,
  authenticateSession,
  clearSessionCookies,
  ensureConfiguredOwnerInvitation,
  getAuthProvisioningStatus,
  getAuthUser,
  internalPrincipal,
  inviteAuthUser,
  listAuthUsers,
  permissionsForRoles,
  principalFromUser,
  resendConfiguredOwnerActivation,
  revokeSession,
  roleDefinitions,
  safeAuditContext,
  sessionTokens,
  setSessionCookies,
  signInWithPassword,
  trustedOrigins,
  updateAuthUser,
} from './auth.js';
import {
  accessModules,accessScopes,canAccessCase,canAccessClient,canAccessDocument,caseListFilter,filterAccessibleCases,
  hasEffectivePermission,isValidScope,permissionCatalogue,resolveAccess,scopeFor,
} from './access.js';
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
import { extractIdentityDocument } from './identity-ocr.js';
import { normalizeLanguage, renderCaseOpeningEmail, sendTransactionalEmail } from './email.js';
import { analyzeImportRows, buildImportReport, importFields, importSummary, parseImportFile, verifyImportRuntime } from './import-center.js';
import {buildCanonicalSuggestions,compareFormAnswers,conditionMatches,extractOfficialPdfAnswers,formReadiness,generateControlledOfficeDocument,newJob,participantMatch,populateOfficialPdf,routeAsylumAuthority,routePassport,validateAiFinding,validateFieldAnswer,validateVersionActivation} from './forms-engine.js';
import {probeOfficialSource} from './form-source-monitor.js';
import {configuredAiProvider,runConstrainedAiReview} from './ai-review.js';
import {activateUserDatabase,scopedDb,systemDb,withSystemDatabase} from './database.js';

const port = Number(process.env.PORT || 3000);
const version = '2.15.0';
const service = 'alhijrah-caseflow-api';
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const internalApiKey = process.env.INTERNAL_API_KEY;
const applicationOwnerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
const applicationBaseUrl = String(process.env.APP_BASE_URL || 'https://alhijrah-caseflow-production-716b.up.railway.app').replace(/\/$/, '');
const productionSha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.SOURCE_VERSION || null;
const railwayRuntime = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_GIT_COMMIT_SHA);
const r2Bucket = process.env.R2_BUCKET;
const r2Endpoint = process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
const r2 = r2Endpoint && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY ? new S3Client({
  region: 'auto', endpoint: r2Endpoint,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
}) : null;

function publicAsset(path, contentType) {
  const body = fs.readFileSync(new URL(path, import.meta.url));
  return Object.freeze({
    body,
    brotli: zlib.brotliCompressSync(body),
    gzip: zlib.gzipSync(body, { level: 9 }),
    contentType,
    etag: `"${crypto.createHash('sha256').update(body).digest('hex')}"`,
  });
}

const publicAssets = Object.freeze({
  '/': publicAsset('./public/index.html', 'text/html; charset=utf-8'),
  '/app.js': publicAsset('./public/app.js', 'text/javascript; charset=utf-8'),
  '/app.css': publicAsset('./public/app.css', 'text/css; charset=utf-8'),
  '/manifest.webmanifest': publicAsset('./public/manifest.webmanifest', 'application/manifest+json; charset=utf-8'),
  '/sw.js': publicAsset('./public/sw.js', 'text/javascript; charset=utf-8'),
  '/icon.svg': publicAsset('./public/icon.svg', 'image/svg+xml'),
});

function sendPublicAsset(req, res, asset) {
  const common = {
    ...securityHeaders(),
    'cache-control': 'public, max-age=0, must-revalidate',
    'content-type': asset.contentType,
    etag: asset.etag,
    vary: 'Accept-Encoding',
  };
  if (req.headers['if-none-match'] === asset.etag) {
    res.writeHead(304, common);
    return res.end();
  }
  const accepted = String(req.headers['accept-encoding'] || '');
  const [body, encoding] = accepted.includes('br')
    ? [asset.brotli, 'br']
    : accepted.includes('gzip')
      ? [asset.gzip, 'gzip']
      : [asset.body, null];
  res.writeHead(200, { ...common, ...(encoding ? { 'content-encoding': encoding } : {}), 'content-length': body.length });
  return res.end(body);
}

function securityHeaders(){return {'cache-control':'no-store','content-security-policy':"default-src 'self'; connect-src 'self' https:; img-src 'self' data: blob:; frame-src 'self' https:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",'permissions-policy':'camera=(), microphone=(), geolocation=()','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','strict-transport-security':'max-age=31536000; includeSubDomains'}}
function json(res,status,body,extra={}){res.writeHead(status,{'content-type':'application/json; charset=utf-8',...securityHeaders(),...extra});res.end(JSON.stringify(body))}
function cors(req){const origin=req.headers.origin;if(!origin||!trustedOrigins(req).has(origin))return {};return {'access-control-allow-origin':origin,'access-control-allow-credentials':'true','access-control-allow-methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS','access-control-allow-headers':'content-type,x-api-key,x-request-id','access-control-max-age':'86400',vary:'Origin'}}
async function readJson(req,max=1_000_000){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>max)throw Object.assign(new Error('PAYLOAD_TOO_LARGE'),{status:413});chunks.push(c)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{throw Object.assign(new Error('INVALID_JSON'),{status:400})}}
async function readBuffer(req,max){const declared=Number(req.headers['content-length']||0);if(declared>max)throw Object.assign(new Error('PAYLOAD_TOO_LARGE'),{status:413});const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw Object.assign(new Error('PAYLOAD_TOO_LARGE'),{status:413});chunks.push(chunk)}return Buffer.concat(chunks,size)}
function internalAuth(req){if(!internalApiKey)throw Object.assign(new Error('API_NOT_CONFIGURED'),{status:503});const supplied=req.headers['x-api-key'];if(typeof supplied!=='string')throw Object.assign(new Error('UNAUTHORIZED'),{status:401});const a=Buffer.from(supplied),b=Buffer.from(internalApiKey);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw Object.assign(new Error('UNAUTHORIZED'),{status:401});return internalPrincipal()}
const db=scopedDb;
async function optionalDb(path,options={}){try{return await db(path,options)}catch(error){if(isMissingRelation(error)||error.status===400)return[];throw error}}
async function officeSettings(){
  const rows=await db('office_settings',{query:'?singleton=eq.true&select=*&limit=1'});
  return rows[0]||{office_name:'ALHIJRAH SERVICES',default_language:'English'};
}
async function caseOpeningCommunication({client,caseRecord,principal,req}){
  if(!client?.email)return {status:'not_applicable',reason:'CLIENT_EMAIL_MISSING'};
  const [settings,templates]=await Promise.all([
    officeSettings(),
    db('communication_templates',{query:'?template_key=eq.case_opened&active=eq.true&select=*&order=version.desc&limit=1'}),
  ]);
  if(!templates.length)throw new Error('CASE_OPENING_TEMPLATE_MISSING');
  const logoUrl=settings.logo_object_key?`${applicationBaseUrl}/brand/logo`:null;
  const rendered=renderCaseOpeningEmail({settings,template:templates[0],client,caseRecord,portalLink:applicationBaseUrl,logoUrl});
  const communicationId=crypto.randomUUID();
  const record={id:communicationId,client_id:client.id,case_id:caseRecord.id,channel:'email',recipient:client.email,language:rendered.language,template_key:'case_opened',template_version:templates[0].version,subject:rendered.subject,body_html:rendered.html,body_text:rendered.text,status:'queued',created_by:principal.id};
  await db('outbound_communications',{method:'POST',body:record});
  try{
    const delivered=await sendTransactionalEmail({to:client.email,subject:rendered.subject,html:rendered.html,text:rendered.text});
    const sentAt=new Date().toISOString();
    await db('outbound_communications',{method:'PATCH',query:`?id=eq.${communicationId}`,body:{status:'sent',provider:delivered.provider,provider_message_id:delivered.messageId,sent_at:sentAt}});
    await audit(principal,'case_opening_email_sent','outbound_communication',communicationId,{case_id:caseRecord.id,client_id:client.id,language:rendered.language,provider:delivered.provider},req);
    return {status:'sent',id:communicationId,provider:delivered.provider,message_id:delivered.messageId,language:rendered.language};
  }catch(error){
    if(error.code==='EMAIL_PROVIDER_NOT_CONFIGURED'){
      await db('outbound_communications',{method:'PATCH',query:`?id=eq.${communicationId}`,body:{status:'queued',failure_code:'PROVIDER_NOT_CONFIGURED'}}).catch(()=>{});
      await audit(principal,'case_opening_email_deferred','outbound_communication',communicationId,{case_id:caseRecord.id,client_id:client.id,failure_code:'PROVIDER_NOT_CONFIGURED'},req);
      return {status:'provider_not_configured',id:communicationId,error:'PROVIDER_NOT_CONFIGURED',language:rendered.language};
    }
    await db('outbound_communications',{method:'PATCH',query:`?id=eq.${communicationId}`,body:{status:'failed',failure_code:String(error.code||error.message||'EMAIL_DELIVERY_FAILED').slice(0,120)}}).catch(()=>{});
    await audit(principal,'case_opening_email_failed','outbound_communication',communicationId,{case_id:caseRecord.id,client_id:client.id,failure_code:String(error.code||error.message||'EMAIL_DELIVERY_FAILED').slice(0,120)},req);
    return {status:'failed',id:communicationId,error:String(error.code||error.message||'EMAIL_DELIVERY_FAILED')};
  }
}
function safeKey(x){const c=String(x||'').replace(/[^a-zA-Z0-9._/-]/g,'_').replace(/\.\./g,'_');if(!c||c.startsWith('/'))throw Object.assign(new Error('INVALID_OBJECT_KEY'),{status:400});return c}
function uuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''))}
const allowedDocumentTypes=new Set(['application/pdf','image/jpeg','image/png','image/webp','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const allowedIdentityTypes=new Set(['image/jpeg','image/png','image/webp']);
function reviewTokenHash(token){return crypto.createHash('sha256').update(String(token||'')).digest('hex');}
async function persistDocumentExtraction(principal,result,{document=null,sourceSha256}){
  const token=crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID(),now=new Date().toISOString(),expiresAt=new Date(Date.now()+15*60_000).toISOString();
  const run={id,document_id:document?.id||null,case_id:document?.case_id||null,client_id:document?.client_id||null,document_version:document?.version||null,source_sha256:sourceSha256,review_token_hash:reviewTokenHash(token),extraction_kind:document?'document_identity':'identity_upload',engine:result.engine,engine_version:'identity-ocr-v1',status:'pending_review',confidence:result.confidence??null,mrz_detected:result.mrz.detected,mrz_valid:result.mrz.valid,raw_text:result.raw_text||null,raw_result:result,requested_by:principal.id,expires_at:expiresAt,created_at:now,updated_at:now};
  await systemDb('document_extractions',{method:'POST',body:run});
  for(const[field,value]of Object.entries(result.fields||{}))await systemDb('document_extracted_fields',{method:'POST',body:{id:crypto.randomUUID(),extraction_id:id,field_path:field,extracted_value:value,confidence:result.confidence??null,source_locator:{method:result.mrz.detected?'mrz':'ocr'}}});
  return{token,run};
}
async function claimDocumentExtraction(token,principal,{documentId=null,errorCode}){
  const hash=reviewTokenHash(token),rows=await systemDb('document_extractions',{query:`?review_token_hash=eq.${hash}&requested_by=eq.${principal.id}&select=*&limit=1`}),run=rows[0],now=Date.now();
  if(!run||documentId&&run.document_id!==documentId||new Date(run.expires_at).getTime()<=now||!['pending_review','reviewing'].includes(run.status)||run.status==='reviewing'&&new Date(run.updated_at).getTime()>now-5*60_000)throw Object.assign(new Error(errorCode),{status:410});
  const claimed=await systemDb('document_extractions',{method:'PATCH',query:`?id=eq.${run.id}&requested_by=eq.${principal.id}&status=eq.${run.status}&updated_at=eq.${encodeURIComponent(run.updated_at)}`,body:{status:'reviewing',updated_at:new Date(now).toISOString()}});if(!claimed.length)throw Object.assign(new Error(errorCode),{status:410});return{...run,status:'reviewing',result:run.raw_result};
}
async function releaseDocumentExtraction(run){await systemDb('document_extractions',{method:'PATCH',query:`?id=eq.${run.id}&status=eq.reviewing`,body:{status:'pending_review',updated_at:new Date().toISOString()}}).catch(()=>{});}
const canonicalIdentityFieldNames=['legal_name','date_of_birth','place_of_birth','nationality','current_country','passport_number','passport_country','passport_expiration'];
function normalizeReviewedIdentityFields(reviewed,{requireLegalName=false}={}){
  const source=reviewed&&typeof reviewed==='object'&&!Array.isArray(reviewed)?reviewed:{};
  const result={};
  for(const field of canonicalIdentityFieldNames){
    if(source[field]===undefined)continue;
    result[field]=field==='date_of_birth'||field==='passport_expiration'
      ?cleanDate(source[field])
      :cleanText(source[field],{required:field==='legal_name',max:field==='passport_number'?40:field==='nationality'||field==='current_country'||field==='passport_country'?100:180});
    if(result[field]===null||result[field]==='')throw Object.assign(new Error('INVALID_REVIEWED_IDENTITY_FIELD'),{status:400});
  }
  if(requireLegalName&&!result.legal_name)throw Object.assign(new Error('LEGAL_NAME_REQUIRED'),{status:400});
  return result;
}
async function commitVerifiedIdentityExtraction(run,subjectType,subjectId,reviewed){
  const rows=await db('rpc/commit_verified_identity_extraction',{method:'POST',body:{p_extraction_id:run.id,p_subject_type:subjectType,p_subject_id:subjectId||null,p_reviewed_fields:reviewed}});
  const committed=Array.isArray(rows)?rows[0]:rows;
  if(!committed?.subject_id)throw Object.assign(new Error('VERIFIED_IDENTITY_COMMIT_FAILED'),{status:409});
  return committed;
}
function stableUuid(value){const hex=crypto.createHash('sha256').update(value).digest('hex').slice(0,32);return hex.slice(0,8)+'-'+hex.slice(8,12)+'-5'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20,32)}
function documentInput(body){const caseId=String(body.case_id||'');if(!uuid(caseId))throw Object.assign(new Error('VALID_CASE_ID_REQUIRED'),{status:400});const fileName=String(body.filename||body.file_name||'').trim().slice(0,180);if(!fileName||/[\x00-\x1f]/.test(fileName))throw Object.assign(new Error('VALID_FILENAME_REQUIRED'),{status:400});const contentType=String(body.content_type||'').toLowerCase();if(!allowedDocumentTypes.has(contentType))throw Object.assign(new Error('UNSUPPORTED_DOCUMENT_TYPE'),{status:415});const sizeBytes=Number(body.size_bytes);if(!Number.isSafeInteger(sizeBytes)||sizeBytes<1||sizeBytes>25*1024*1024)throw Object.assign(new Error('DOCUMENT_SIZE_NOT_ALLOWED'),{status:413});return{caseId,fileName,contentType,sizeBytes}}
function documentChecksum(value){if(value===undefined||value===null||value==='')return null;const checksum=String(value).toLowerCase();if(!/^[a-f0-9]{64}$/.test(checksum))throw Object.assign(new Error('INVALID_DOCUMENT_CHECKSUM'),{status:400});return checksum}

async function verifiedStoredDocument(key,input,declaredChecksum){
  const object=await r2.send(new HeadObjectCommand({Bucket:r2Bucket,Key:key}));
  if(Number(object.ContentLength)!==input.sizeBytes||String(object.ContentType||'').toLowerCase()!==input.contentType)throw Object.assign(new Error('UPLOADED_OBJECT_MISMATCH'),{status:409});
  const stored=await r2.send(new GetObjectCommand({Bucket:r2Bucket,Key:key}));
  const bytes=Buffer.from(await stored.Body.transformToByteArray());
  if(bytes.length!==input.sizeBytes)throw Object.assign(new Error('UPLOADED_OBJECT_MISMATCH'),{status:409});
  const checksum=crypto.createHash('sha256').update(bytes).digest('hex');
  const declared=documentChecksum(declaredChecksum);
  if(declared&&declared!==checksum)throw Object.assign(new Error('DOCUMENT_CHECKSUM_MISMATCH'),{status:409});
  return{checksum,etag:String(object.ETag||'').replace(/^"|"$/g,'')||null};
}

async function canonicalDocumentLinkage(caseRecord,body){
  const caseId=String(caseRecord.id),clientId=caseRecord.client_id||null;
  if(body.client_id!==undefined&&body.client_id!==null&&body.client_id!==''&&String(body.client_id)!==String(clientId))throw Object.assign(new Error('DOCUMENT_CLIENT_MISMATCH'),{status:409});
  let personId=null,requestId=null,category=cleanText(body.category,{max:100}),replacement=null;
  if(body.person_id){
    if(!uuid(body.person_id))throw Object.assign(new Error('INVALID_DOCUMENT_METADATA'),{status:400});
    const links=await db('case_people',{query:`?case_id=eq.${encodeURIComponent(caseId)}&person_id=eq.${encodeURIComponent(body.person_id)}&select=person_id&limit=1`});
    if(!links.length)throw Object.assign(new Error('DOCUMENT_PERSON_NOT_IN_CASE'),{status:409});
    personId=body.person_id;
  }
  if(body.request_id){
    if(!uuid(body.request_id))throw Object.assign(new Error('INVALID_DOCUMENT_METADATA'),{status:400});
    const requests=await db('document_requests',{query:`?id=eq.${encodeURIComponent(body.request_id)}&case_id=eq.${encodeURIComponent(caseId)}&select=*&limit=1`});
    if(!requests.length)throw Object.assign(new Error('DOCUMENT_REQUEST_NOT_IN_CASE'),{status:409});
    const request=requests[0];requestId=request.id;category=cleanText(request.category||category,{max:100});
    if(request.person_id){if(personId&&String(personId)!==String(request.person_id))throw Object.assign(new Error('DOCUMENT_REQUEST_PERSON_MISMATCH'),{status:409});personId=request.person_id}
  }
  if(body.replaces_document_id){
    if(!uuid(body.replaces_document_id))throw Object.assign(new Error('INVALID_DOCUMENT_METADATA'),{status:400});
    const rows=await db('documents',{query:`?id=eq.${encodeURIComponent(body.replaces_document_id)}&case_id=eq.${encodeURIComponent(caseId)}&archived_at=is.null&select=id,case_id,client_id,person_id,request_id,category,version&limit=1`});
    if(!rows.length)throw Object.assign(new Error('REPLACED_DOCUMENT_NOT_FOUND'),{status:404});replacement=rows[0];
    if(personId&&replacement.person_id&&String(personId)!==String(replacement.person_id))throw Object.assign(new Error('REPLACED_DOCUMENT_PERSON_MISMATCH'),{status:409});
    if(requestId&&replacement.request_id&&String(requestId)!==String(replacement.request_id))throw Object.assign(new Error('REPLACED_DOCUMENT_REQUEST_MISMATCH'),{status:409});
    personId=personId||replacement.person_id||null;requestId=requestId||replacement.request_id||null;category=category||replacement.category||null;
  }
  return{client_id:clientId,person_id:personId,request_id:requestId,category,review_status:'received',replaces_document_id:replacement?.id||null,version:replacement?Number(replacement.version||1)+1:1,replacement};
}

async function validateAnswerProvenance(caseRecord,body){
  const sourceType=String(body.source_type||'manual'),sourceId=body.source_record_id||null,documentId=body.source_document_id||null;
  if(!['manual','client','participant','history','document_ocr','verified_field','prior_form','system'].includes(sourceType))throw Object.assign(new Error('INVALID_ANSWER_SOURCE_TYPE'),{status:400});
  if(documentId){if(!uuid(documentId))throw Object.assign(new Error('INVALID_ANSWER_SOURCE'),{status:400});const rows=await db('documents',{query:`?id=eq.${documentId}&case_id=eq.${caseRecord.id}&archived_at=is.null&select=id`});if(!rows.length)throw Object.assign(new Error('ANSWER_SOURCE_NOT_IN_CASE'),{status:409})}
  if(sourceType==='manual'||sourceType==='system')return null;
  if(!uuid(sourceId))throw Object.assign(new Error('ANSWER_SOURCE_RECORD_REQUIRED'),{status:400});
  let rows=[];
  if(sourceType==='client')rows=String(sourceId)===String(caseRecord.client_id)?[{id:sourceId}]:[];
  else if(sourceType==='participant')rows=await db('case_people',{query:`?case_id=eq.${caseRecord.id}&person_id=eq.${sourceId}&select=person_id&limit=1`});
  else if(sourceType==='verified_field')rows=await db('verified_canonical_fields',{query:`?id=eq.${sourceId}&client_id=eq.${caseRecord.client_id}&status=eq.current&select=*&limit=1`});
  else if(sourceType==='history')rows=await db('person_history_records',{query:`?id=eq.${sourceId}&case_id=eq.${caseRecord.id}&archived_at=is.null&select=id&limit=1`});
  else if(sourceType==='document_ocr')rows=documentId?[{id:documentId}]:[];
  else if(sourceType==='prior_form')rows=await db('form_instances',{query:`?id=eq.${sourceId}&case_id=eq.${caseRecord.id}&select=id&limit=1`});
  if(!rows.length)throw Object.assign(new Error('ANSWER_SOURCE_NOT_IN_CASE'),{status:409});
  if(sourceType==='verified_field'&&rows[0].subject_type==='person'){const links=await db('case_people',{query:`?case_id=eq.${caseRecord.id}&person_id=eq.${rows[0].person_id}&select=person_id&limit=1`});if(!links.length)throw Object.assign(new Error('ANSWER_SOURCE_NOT_IN_CASE'),{status:409})}
  return sourceType==='verified_field'?rows[0]:null;
}

async function storeGeneratedArtifact({caseId,instanceId,artifactType,authority,formCode,editionDate,mappingVersion,sourceHash,bytes,pdfHash,generatedBy,backgroundJobId=null}){
  if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});
  if(backgroundJobId){const existing=await db('generated_artifacts',{query:`?background_job_id=eq.${backgroundJobId}&select=*&limit=1`});if(existing.length)return existing[0];}
  const id=crypto.randomUUID(),objectKey=safeKey(`cases/${caseId}/generated/${id}-${formCode}.pdf`);
  await r2.send(new PutObjectCommand({Bucket:r2Bucket,Key:objectKey,Body:bytes,ContentType:'application/pdf',ContentLength:bytes.length,Metadata:{case_id:caseId,artifact_type:artifactType}}));
  try{
    const record={id,case_id:caseId,form_instance_id:instanceId||null,background_job_id:backgroundJobId,artifact_type:artifactType,authority,form_code:formCode,edition_date:editionDate||null,mapping_version:mappingVersion||null,source_artifact_hash:sourceHash||null,object_key:objectKey,pdf_sha256:pdfHash,review_state:'review_required',immutable:true,generated_by:generatedBy};
    const rows=await db('generated_artifacts',{method:'POST',body:record});return rows[0]||record;
  }catch(error){await r2.send(new DeleteObjectCommand({Bucket:r2Bucket,Key:objectKey})).catch(()=>{});throw error}
}

function deterministicRuleFindings(rules,answers,instance){
  const findings=[];
  for(const rule of rules){
    const definition=rule.rule_definition,source={engine:'verified_form_rule',rule_id:rule.id,rule_code:rule.rule_code,rule_version:rule.rule_version,official_source:rule.official_source,verified_at:rule.verified_at};
    if(!rule.verified_at||!definition||typeof definition!=='object'||Array.isArray(definition)||!definition.assert||!['blocker','warning','review'].includes(definition.severity)||typeof definition.claim!=='string'||!definition.claim.trim()){
      findings.push({category:'RULE_CONFIGURATION',severity:'blocker',field_path:null,claim:'Active deterministic rule is invalid or unverified.',source_references:[rule.id].filter(Boolean),rule_source:source});continue;
    }
    if(definition.applies_when&&!conditionMatches(definition.applies_when,answers))continue;
    if(conditionMatches(definition.assert,answers))continue;
    findings.push({category:definition.category||'RULE_VIOLATION',severity:definition.severity,field_path:definition.field_path||null,claim:definition.claim.trim(),source_references:[rule.id].filter(Boolean),rule_source:source});
  }
  return findings;
}
function deterministicFindingMetadata(finding){
  const semantic={form_instance_id:finding.form_instance_id||null,category:finding.category,field_path:finding.field_path||null,engine:finding.rule_source?.engine||'form_readiness',rule_id:finding.rule_source?.rule_id||null,source_references:finding.category==='CROSS_FORM_CONFLICT'?[...(finding.source_references||[])].sort():[]};
  const deterministic_key=crypto.createHash('sha256').update(canonicalJson(semantic)).digest('hex');
  const fingerprint=crypto.createHash('sha256').update(canonicalJson({semantic,severity:finding.severity,claim:finding.claim,source_references:finding.source_references||[],rule_source:finding.rule_source||null})).digest('hex');
  return{deterministic_key,fingerprint};
}
async function buildDeterministicCaseReview(caseId,{persist=false,actorId=null}={}){
  const instances=await db('form_instances',{query:`?case_id=eq.${caseId}&select=*`});
  if(!instances.length)return{findings:[],cross_form_findings:[],rule_findings:[],readiness_by_instance:{},filing_ready:true};
  const definitionIds=[...new Set(instances.map(item=>item.form_definition_id).filter(Boolean))],versionIds=[...new Set(instances.map(item=>item.form_version_id).filter(Boolean))];
  const[definitions,versions,answers,rules]=await Promise.all([
    definitionIds.length?db('form_definitions',{query:`?id=in.(${definitionIds.join(',')})&select=*`}):Promise.resolve([]),
    versionIds.length?db('form_versions',{query:`?id=in.(${versionIds.join(',')})&select=*`}):Promise.resolve([]),
    db('form_answers',{query:`?form_instance_id=in.(${instances.map(item=>item.id).join(',')})&select=*`}),
    db('form_rules',{query:'?status=eq.active&select=*'})
  ]);
  const definitionById=new Map(definitions.map(item=>[item.id,item])),versionById=new Map(versions.map(item=>[item.id,item])),answersByInstance=new Map();
  for(const answer of answers){const list=answersByInstance.get(answer.form_instance_id)||[];list.push(answer);answersByInstance.set(answer.form_instance_id,list)}
  const normalized=instances.map(instance=>({id:instance.id,form_code:instance.pinned_form_code||'FORM',answers:(answersByInstance.get(instance.id)||[]).map(answer=>({id:answer.id,canonical_field_path:answer.canonical_field_path,value:answer.answer_value}))}));
  const crossFormFindings=compareFormAnswers(normalized).map(finding=>({...finding,form_instance_id:null,participant_id:null,rule_source:{engine:'cross_form_consistency'}}));
  const findings=[...crossFormFindings],ruleFindings=[],readinessByInstance={};
  for(const instance of instances){
    const definition=definitionById.get(instance.form_definition_id)?.definition,version=versionById.get(instance.form_version_id)||{},rows=answersByInstance.get(instance.id)||[],answerMap=Object.fromEntries(rows.map(answer=>[answer.field_path,answer.answer_value]));
    const applicableRules=rules.filter(rule=>rule.authority===instance.pinned_authority),instanceRuleFindings=deterministicRuleFindings(applicableRules,answerMap,instance).map(finding=>({...finding,form_instance_id:instance.id,participant_id:instance.participant_id||null}));
    ruleFindings.push(...instanceRuleFindings);
    const base=formReadiness({definition,answers:answerMap,version,crossFormFindings:[]});
    for(const finding of [...base.blockers,...base.warnings,...base.review_items])findings.push({...finding,form_instance_id:instance.id,participant_id:instance.participant_id||null,source_references:finding.source_references||[],rule_source:finding.rule_source||{engine:'form_readiness'}});
    findings.push(...instanceRuleFindings);
    readinessByInstance[instance.id]=formReadiness({definition,answers:answerMap,version,crossFormFindings:[...crossFormFindings,...instanceRuleFindings]});
  }
  const decorated=findings.map(finding=>({...finding,...deterministicFindingMetadata(finding)}));
  if(persist){
    const existing=await db('form_findings',{query:`?case_id=eq.${caseId}&created_by_type=eq.deterministic&status=eq.open&select=*`}),desired=new Map(decorated.map(finding=>[finding.deterministic_key,finding]));
    for(const prior of existing){
      const key=prior.rule_source?.deterministic_key,current=desired.get(key);
      if(current&&prior.rule_source?.fingerprint===current.fingerprint){desired.delete(key);continue}
      await db('form_findings',{method:'PATCH',query:`?id=eq.${prior.id}&status=eq.open`,body:{status:'resolved',resolved_by:actorId,resolved_at:new Date().toISOString()}});
    }
    for(const finding of desired.values()){
      const record={id:crypto.randomUUID(),case_id:caseId,form_instance_id:finding.form_instance_id||null,participant_id:finding.participant_id||null,category:finding.category,severity:finding.severity,field_path:finding.field_path||null,claim:finding.claim,source_references:finding.source_references||[],rule_source:{...(finding.rule_source||{}),deterministic_key:finding.deterministic_key,fingerprint:finding.fingerprint},status:'open',created_by_type:'deterministic'};
      try{await db('form_findings',{method:'POST',body:record})}catch(error){if(error.status!==409)throw error}
    }
  }
  return{findings:decorated,cross_form_findings:crossFormFindings,rule_findings:ruleFindings,readiness_by_instance:readinessByInstance,filing_ready:Object.values(readinessByInstance).every(item=>item.filing_ready)};
}

async function executeAiReadTool(name,{case_id}){
  const map={
    get_case_summary:()=>db('cases',{query:`?id=eq.${case_id}&select=*`}),get_participants:()=>db('case_people',{query:`?case_id=eq.${case_id}&select=*`}),get_documents:()=>db('documents',{query:`?case_id=eq.${case_id}&archived_at=is.null&select=*`}),get_open_findings:()=>db('form_findings',{query:`?case_id=eq.${case_id}&status=eq.open&select=*`}),get_deadlines:()=>db('deadlines',{query:`?case_id=eq.${case_id}&select=*`}),get_address_history:()=>db('person_history_records',{query:`?case_id=eq.${case_id}&history_type=eq.address&archived_at=is.null&select=*`}),get_employment_history:()=>db('person_history_records',{query:`?case_id=eq.${case_id}&history_type=eq.employment&archived_at=is.null&select=*`}),get_travel_history:()=>db('person_history_records',{query:`?case_id=eq.${case_id}&history_type=eq.travel&archived_at=is.null&select=*`})
  };
  if(['get_form_answers','get_form_definition','get_verified_fields'].includes(name)){
    const instances=await db('form_instances',{query:`?case_id=eq.${case_id}&select=id,form_definition_id`});if(!instances.length)return[];
    if(name==='get_form_definition')return db('form_definitions',{query:`?id=in.(${[...new Set(instances.map(x=>x.form_definition_id))].join(',')})&select=*`});
    return db('form_answers',{query:`?form_instance_id=in.(${instances.map(x=>x.id).join(',')})${name==='get_verified_fields'?'&verification_status=eq.verified':''}&select=*`});
  }
  if(name==='get_family_history'){
    const links=await db('case_people',{query:`?case_id=eq.${case_id}&select=person_id`});if(!links.length)return[];
    const ids=links.map(x=>x.person_id).join(',');return db('family_relationships',{query:`?person_id=in.(${ids})&archived_at=is.null&select=*`});
  }
  if(name==='compare_forms'){const review=await buildDeterministicCaseReview(case_id);return review.cross_form_findings}if(name==='run_rule_validation'){const review=await buildDeterministicCaseReview(case_id);return review.rule_findings}if(name==='generate_review_report'){const review=await buildDeterministicCaseReview(case_id);return{filing_ready:review.filing_ready,findings:review.findings,readiness_by_instance:review.readiness_by_instance}};
  if(!map[name])throw new Error('AI_TOOL_NOT_IMPLEMENTED');return map[name]();
}

const productionVerification={enabled:railwayRuntime,status:railwayRuntime?'pending':'disabled',documentUpload:false,identityOcr:false,clientAutofill:false,bulkImport:false,xlsx:false,csv:false,arabic:false,serviceMapping:false,dryRun:false,canonicalWrites:null,errors:{},completedAt:null,sha:productionSha};

const productionIdentityFixture='iVBORw0KGgoAAAANSUhEUgAABwgAAAMgCAYAAAA3IzbOAAAACXBIWXMAAAsTAAALEwEAmpwYAAAgAElEQVR4nOzdB5ScVf34YemhJYQqRZoUASmhdwyhdwWkhqIGECl/AkoRECSRjoSOqPQiP4KAtASkSocAUgPSE1ogEAKhc//nO+fsnpmdd3ZnZmdnd/M+zznvUXfnfedO2Y1nPnvv/V4CAAAAAAAAcuN73T0AAAAAAAAAoHkEQgAAAAAAAMgRgRAAAAAAAAByRCAEAAAAAACAHBEIAQAAAAAAIEcEQgAAAAAAAMgRgRAAAAAAAAByRCAEAAAAAACAHBEIAQAAAAAAIEcEQgAAAAAAAMgRgRAAAAAAAAByRCAEAAAAAACAHBEIAQAAAAAAIEcEQgAAAAAAAMgRgRAAAAAAAAByRCAEAAAAAACAHBEIAQAAAAAAIEcEQgAAAAAAAMgRgRAAAAAAAAByRCAEAAAAAACAHBEIAQAAAAAAIEcEQgAAAAAAAMgRgRAAAAAAAAByRCAEAAAAAACAHBEIAQAAAAAAIEcEQgAAAAAAAMgRgRAAAAAAAAByRCAEAAAAAACAHBEIAQAAAAAAIEcEQgAAAAAAAMgRgRAAAAAAAAByRCAEAAAAAACAHBEIAQAAAAAAIEcEQgAAAAAAAMgRgRAAAAAAAAByRCAEAAAAAACAHBEIAQAAAAAAIEcEQgAAAAAAAMgRgRAAAAAAAAByRCAEAAAAAACAHBEIAQAAAAAAIEcEQgAAAAAAAMgRgRAAAAAAAAByRCAEAAAAAACAHBEIAQAAAAAAIEcEQgAAAAAAAMgRgRAAAAAAAAByRCAEAAAAAACAHBEIAQAAAAAAIEcEQgAAAAAAAMgRgRAAAAAAAAByRCAEAAAAAACAHBEIAQAAAAAAIEcEQgAAAAAAAMgRgRAAAAAAAAByRCAEAAAAAACAHBEIAQAAAAAAIEcEQgAAAAAAAMgRgRAAAAAAAAByRCAEAAAAAACAHBEIAQAAAAAAIEcEQgAAAAAAAMgRgRAAAAAAAAByRCAEAAAAAACAHBEIAQAAAAAAIEcEQgAAAAAAAMgRgRAAAAAAAAByRCAEAAAAAACAHBEIAQAAAAAAIEcEQgAAAAAAAMgRgRAAAAAAAAByRCAEAAAAAACAHBEIAQAAAAAAIEcEQgAAAAAAAMgRgRAAAAAAAAByRCAEAAAAAACAHBEIAQAAAAAAIEcEQmry0UcfpVtuuSWdd955adiwYenwww9PRx11VDrppJPSZZddlh599NE0adKkLn9WX3/99XT11VenESNGpD/84Q+FccR/nnbaaWnkyJHpueeeS19++WXKg48//jjddttt6cwzz0xHHnlk4bk4+uijC6/R3XffnT7//PPuHiIAAAAAANCDCIQppRNOOCGtssoqNR3rr79+2nrrrdOee+5ZiFQPPfRQ+uKLL7r0xdpss80yx7LaaqulyZMnd9n9xrXjMa600kpp2mmnTd/73vfaPeI2K664Yjr44IPTzTff3LDn5bXXXkuHHHJIWnjhhTscQxwzzzxzGjhwYDr++OPTY489Vtd97rPPPjW/N+I+t9tuu/SrX/0qXXjhhWnMmDHp66+/To02atSownti+umnb/d5mGWWWdLOO+9ciLf12m233Wp6DtZee+20+eabp1122aUQkmOsEZfrceCBB9b8GjTquPLKK+t+zgAAAAAAoKcSCFMqhJxqglNHxxxzzJEOOuig9Pzzzzf8hfrvf//b7n1fd911Db/P7777Lp111lmFx9WZ56Vfv35p8ODBdUfMTz75JP3iF79I0003XafGsdhiixVmOtbiJz/5SUPeG/PPP3865phj0ptvvpk667333ktbbrllzWOYZpppCu/1zz77rOb7XHnllTv9HMwwwwxphx12SKNHj67pviM0NuI1qOc444wzan6uAAAAAACgpxMIGxgIW44IWbHUYyOXuIxZWO3d5x577JEaKWZ7bbXVVg19XsaPH1/zOJ588sm0xBJLNGwMMbOxOwJh8azGmI0Z8bUeL730UtUzKCsdAwYMSBMmTGh6ICw+InBW+34QCAEAAAAAoLEEwi4IhC1HLP3ZqP34Vl999Xbva6655krffPNNQ+5rypQpab311qvqMfbt27cQvboiEL7wwgtp7rnnrmpmXP/+/TtcarMnBMKWI5YgrXXZ0ffffz8tssgiHV57ttlmq+q9WcvehI0OhHHMOeec6fHHH+/wvgVCAAAAAABoLIGwQiCcccYZ00YbbVTxWHXVVQuBo6MIMmjQoE7PJIywFhGso/u69957G/Km2GmnnSrexwYbbJD++te/FpZR/fbbb1vP+fTTTwuz2y699NLCcqDf//73OxUIJ06cWDGG9enTJ+2+++7phhtuSG+//XbZeRGdzjzzzLTtttsWbtvoQBhLrlZ6X2y44YaFGXqzzz57h6/X3nvvXdNMwkozOiPQ7r///oXZlhF3W5Zlvf/++wt7AFZamjWWw+1MIGzveVhrrbWqmvk5zzzzpLFjxzZ8D8L4+W17XxGR7UEIAAAAAAACYcVAGIGrIxF3nnnmmUJoaW8W3Z/+9KdOvdcuvPDCsmsOHDiw7GuHHnpop9/Td955Z+ZjWHDBBdPtt99e9XW++uqrwr6IEczqCYTxWLLGsf7666dXXnml6ut8+OGH6c9//nNrrGpEIFx33XU7PC9mcz700EOFpV/b2zvx2muvrWocEUOzzp9vvvnSo48+2u65N954Y5plllnKzo1xPfXUU3UHwngtOvLBBx+kv/3tb2m55Zar+Byss846dS+5WskPfvCDsvuJ8A0AAAAAAAiEnQqExSIUVpoxFTOXYmZbvWK/trbXjCg0wwwzlHxtySWX7PR7OmZGZsXBWqJcW6NGjUrLL7981YFw3LhxaaaZZiobRyw1+cUXX9Q1hgiWMaswwmozAmGxu+66q+JSqUsvvXRVS42usMIKmYHvscceq2oMESIrLXXalYGwRcyi/c1vflMxEkZMbiSBEAAAAAAAKrPEaIMCYYiIFnsBZgWQs88+O9Ujlu5su0zmoosuWvheBJq29xNLf9Yrxp819piB1lkxo67aPffOOeeczMj63nvvdXoctQbGRgTC8MADD2RGzzhuu+22ds+95557Or1EaKXQHJHxtdde6/JAGGKWYKXlazfZZJPUSAIhAAAAAABUJhA2MBCGESNGZAaQbbbZpq7rXX/99WXX2nfffQvfGz58eNn3TjrppFSvs846q+x6iy++eGq2mCnYdhyxx153aFQgbNlLL+u9MXTo0HbPixDY9pzYk/LVV19tyPKxMbOyGYGwZXZo2+AdR3zts88+S40iEAIAAAAAQGUCYYMDYUSOrADSt2/fuq635557ll0romF4/PHHy7639tprp3rts88+Zdfbe++9U7MtvPDCZeP4xz/+kXp7IBw7dmxmoBswYEC752UtXVvPGL799tvCcrH1zN5rVCCsNJMxjvvuuy81ikAIAAAAAACVCYQNDoRhgw02yAwgkyZNqnlZzrZ718W+gy3XieAz77zzlnx/2mmnTe+++25d44796NqO+fDDD0/NlhVYY5nN3h4Iw0ILLVR2vXgNa42KMXu0HhF8214rlj6NpWybFQiHDRuW+Zhin8RGEQgBAAAAAKAygbALAuEee+yRGUBij79axIyqjqLM7rvvXnabv/3tbw0LmwcffHBqppiBWc8+fb0lEMYMz6x9ACP2Zrngggsa+nzEXphZ1xs9enTTAuFFF12UOYbYe7JRBEIAAAAAAKhMIOyCQBj75WUFkKeffrqm6xx22GEdzhy7/PLLG7bf4dZbb112rQ033DA103fffVeYJdl2HKeeemqaGgJhLOeZ9d6otP/eIYccknn7999/v677f/DBBzOvF+GwWYHwr3/9a11jqIVACAAAAAAAlQmEXRAId9lll8wA8uabb9Z0naWWWqrsGrHvYLFYTnSaaaYpuc0ss8xSMTi1Z8iQIWX3F7Hu9ddfT82UtQznSiutVIiHvT0QrrbaaplLfFay1VZbld2+X79+dd9/hMWs9+ZBBx3UtEB44oknZo7hqquuSo0iEAIAAAAAQGUCYRcEwohZWQFkypQpVV/jhRdeyNyrLmspyqx4c+ONN9Y87osvvjhz3DGL8PPPP0/N8vOf/zxzHCeccELqzYEw9pScY445yq634IILVjxn6aWXLrv9j370o4bP0Nx8882bFgi33377zNf3qaeeSo0iEAIAAAAAQGUCYYMD4fjx49O0005bdr0FFligpuucfPLJZdfYbbfdMm975JFHlt32l7/8ZV1jz4pHLTP4Yk/EZrjssssyxxDHrrvumt54443UGwPh/fffn/mYKoW2iMEzzjhj2e0HDhzY8Hi25JJLNiUQfvTRR6lv375l15prrrkq7sNYD4EQAAAAAAAqEwgbHAgPPvjgzAg0ePDgmq6zzjrrlF0jwlmWe+65p+y28803X13BJcJipTgXx+qrr17YK+6VV15JXeWrr75Kiy66aMUxRDT76U9/mq699to0ceLE1FsC4ZZbbpn5eI4//vjM20+ePDnz9jvttFOnHtMqq6xSds155pmnKYFw6NChmY/pd7/7XWokgRAAAAAAACoTCBsYCG+99dY03XTTZQaQK664ourrvPfee2XXiX0GY7/BSkEta1bWgw8+WPNjiPuIJS/bi4Qtx+KLL5722GOPdP7556dnn302NdLtt99e8bksPuI2q666amEPvWuuuSa9/fbbPTIQnnfeeRUfw8MPP1zxtci6/V577dWpxxTjb3vNWWedtUsDYSxtevrpp5ftlxnH3HPPnd55553USAIhAAAAAABUJhA2KBBedNFFaZZZZqkY0iLiVevvf/972TUi0LRn2223LTvniCOOSPV47LHHCtGmmkhYfCy00EJpyJAh6Y477igEoc4655xzMpdrbe+IADVgwIB01FFHpRdffLHbA2HsOxgzBCvFzrh+JTFLM+ucffbZp1OPadCgQZnPW3uvWb2BMGL3VVddldZee+2Kgbee/TI7IhACAAAAAEBlAmGdgfCzzz5LzzzzTDr33HPTiiuu2G60uvLKK1Mttttuu7JrxD6D7YlZfG3PWXbZZVO9Xn311cJyorVGwpZj6aWXThdeeGEhkHXGLbfckuadd966xhDRa+ONN0733ntvUwNhLA0akfWUU04pxOFK44v42d4sz//+97+Z5x144IGpMyotdfrpp5/WFAhnm222wnKlWccyyyxT+Blq7/WJWYsjR45MXUEgBAAAAACAygTCCoEw4k3//v0zj5lnnrnqSFVrzJkyZUohnLS9Tuwz2FHQy7r/l19+OdUr9jC89NJL0w9/+MO6Q2HEoieffDJ1xqRJkwqzIfv161d3KNx9993r2q8wKxBOP/30Fd8bsT9iteMaMWJEu/f9yCOPZJ536KGHduLZTIX9G7OuO2HChJoCYb1HPH877LBDeu2111JXEQgBAAAAAKAygbBCIGzEEdeNyFaLf/3rX2XXmX322ataonSppZYqOzf2feuseAx33nlnGjx4cF2z+WKmWezP2Fkxa/Piiy9Om266aU2RtnhG5RtvvNHpQNjZI5bVPOGEEzq87wirWecffPDBnXgWU9pqq60yr/vJJ590aSDccMMN0wUXXJDGjx+fuppACAAAAAAAlQmEXRAIY2nFf/7zn6kesYdf2+vF/oLViNmKbc/dYIMNUiPFPnVjxowphMeYiTbffPNV9ZzEzLpYdrNRPv/88zR69Oh0zDHHFCJepf0fs5Y+jSVAuysQRsT9z3/+U9V9v/TSS5nX2G+//TrxzKXCsqtZ121vOdhGBMKYlbvFFlukp59+OnU1gRAAAAAAACoTCBsUCGeaaabCDKmrr746ffnll6nemXpZ+7add955VZ1/8803Zy7n+MEHH6Su9Pzzz6ezzz47rbfeeoXlPCs9R7FUaYS9rhAzLO+///5CMOxoSdR4vZsZCGMG5TbbbFPYT7GWGaXjxo3LvN7ee++dOmP99dcvu2afPn3aPScrEM4xxxxpo402KjvWXHPNdvdejNmfsXRtVxIIAQAAAACgMoGwQiCMGWn77LNP5rH//vunI488Mp188snp73//e3riiSeqWgK0Iw899FBmUIn9Bavx6aefFkJl2/Mvu+yy1CzPPvtsYZZYpTj0l7/8pcvHELMcb7jhhswlV1uiabX732UFwoi4ld4bMYvz6KOPTqeeemq6/PLLC89HezPz2hN7JmaNf9ddd02dscYaa5Rdc6655qo5EEZobM/bb7+dhg0bVgikWbMJr7/++tRVBEIAAAAAAKhMIKwQCCMCNVtEx7bjWGyxxQqhqNojZvG1vcb222/f1McRgS4iWVbcGjBgQNPGMWnSpIozAI866qiqrpF1/rrrrpuaIWaiZs3IjD0YOyNrhuWiiy7a8EDY4plnnslcinbOOecsRMSuIBACAAAAAEBlAmEPCoTLLbdcp5ezzDpmn3329MUXXzQ9EkbIypo59uGHHzZtHBMmTCiEqLbjWGuttXp8IAwLLrhg2f2vsMIKnbpm1n6N8Ti7KhCGWP41Zm62vcZuu+2WuoJACAAAAAAAlQmEPSQQ/u9//+uSONhy3HrrranZ7rrrrsyxjBo1qqnj+O1vf1s2hhlnnDF9/fXXPT4QZt3/3HPPXff1Pv7448zXZMiQIV0aCMPQoUMzg/GYMWNSowmEAAAAAABQmUDYQwLhGWec0aWBcL/99kvNFktk9unTp2wsl156aVPHcfvtt2c+J++//36PD4Sxr2Hb+49lRydPnlzX9Z5++unM5+KUU07p8kAYM0ezZnNuvPHGqdEEQgAAAAAAqEwg7CGBsNJeeY06YqnKWPaz2WIPxbZjOfPMM5s6hhdeeCHzORk7dmyPD4Snnnpq5thjyc56XHLJJZnXu+GGG7o8EIbTTz+9KbNKBUIAAAAAAKhMIOwBgTBmVmXtz3bYYYela6+9tubjT3/6U2aEeeyxx1KzLbXUUmXjuOCCC3rE8q2vv/56jw+EEQKzxl5vZD3wwAMzl/l89913mxIIYy/MrGi8xhprpEYSCAEAAAAAoDKBsAcEwssvvzxzGcmOok17EWa22WYru+YxxxyTmq1v375l4xg5cmRTx/Cf//wnM7JNmTKlxwfC2Cexf//+ZWPYbrvt6rreCiusUHatVVddtcPzGhUIw/nnn5/5etx2222pUQRCAAAAAACoTCDsAYFwxx13LLv/AQMGdOqaW2+9ddk1V1xxxdRMY8aMyQxBDz30UFPHkTWjMqJbNbo7EIaddtqpbAwzzTRTYeZpLZ555pnM1+PYY49taiD8/PPP0/zzz192vTXXXDM1ikAIAAAAAACVCYTdHAhjtt/ss89edv9HHHFEp6577rnn1rys5ptvvpleeuml1Cj77rtv2f3HY/3yyy/bPe/RRx9NkyZNatjzu+SSS9Y9A68nBMKsGaZxnHHGGZ1eXrTapWcbGQjDySefnDmW22+/PTWCQAgAAAAAAJUJhN0cCCOIZIWSu+66q1PXfeWVVzKve9ZZZ1U85957700zzjhjOuSQQ9LEiRM7df+jR48u7G3X9v632WabDs898sgj03zzzZcuuuii9M0333RqHLGPY9bzEMtc9pZAGEuhzjPPPGXjiOVbx40bV9U1nnjiicx9LldfffWqzm90IIwAPMccc5Rdc6211kqNIBACAAAAAEBlAmE3B8L999+/7L5j/8COZtlVY6mlliq79kYbbdRuIGy53VxzzVUIde3NOKzkmmuuSbPMMktmmItw2JG435bbL7fccumCCy5IkydPrnkZywidWWOYe+6500cffdRrAmE48cQTMx/LGmuskSZMmNDuuf/73//SEksskXn+TTfd1C2BMBx11FGZYxo1alTqLIEQAAAAAAAqEwi7MRB+9913aaGFFiq779g/sBEOOuigsmvPMMMMFeNYcSBsOaabbrrCeM4777z03HPPFcac5ZNPPknXXXddGjRoUGb0iWOzzTaratzFgbDl6NevX9pnn30K8fHtt9+ueG7MqDvzzDMrBrE4RowYUeUz2HMCYQTPH/7wh5mPJ75+xRVXlEXliKqx1GzW7MM4Nt1006rvvysC4XvvvZdmnnnmsuuus846qbMEQgAAAAAAqEwg7MZAGMs+ZoWbc845pyHXv/XWWzOvf/XVV1cdCNsesSzksssuW4hDW2yxRdpggw0KMxWzlhMtPhZZZJH01ltv1R0I2x4LLLBAWmGFFQozIjfffPO09tprF77W0Xnbbrtt+vrrr3tdIAyPPPJIYQnYSo8tImqEvAh/yy+/fMVZnHHEEq7jx4/v1kAYDjjggMzx3XHHHZ26rkAIAAAAAACVCYTdGAiPPfbYzDjy8ssvN+T6n332WerTp0/Z9XfZZZe6A2E9x4ILLphefPHFqsddTSCs59h4440LM/Fq0ZMCYRg5cmRhFmhnnof+/funMWPG1HS/XRUIX3vttczH09nnWCAEAAAAAIDKBMJuDIQrrbRS2f0uvvjiDb2PTTbZJHMW4FdffVV223fffTcNGTKk8P1GRbk99tgjTZw4saYxP/jgg2nLLbdM008/fUPGEDPpzjjjjPTtt9/W/Pz1tEAY7rnnnjT//PPX9VzEzMKxY8fWfJ9dFQjD4MGDM8d655131n1NgRAAAAAAACoTCLspEL7xxhtpmmmmKbvfX//61w29nwhjtcaXmGV37bXXpr322itzj8SOjtlnn72wX+Bjjz3WqbG/88476eyzzy7sgRjXrHUciy66aDrhhBNqWkqzNwTCMGnSpMJMyznnnLPq5yL2ZswKw90dCJ999tnMn4X11luv7msKhAAAAAAAUJlASIdeeumlwtKWw4cPL8z22mabbdLAgQPT6quvXli2c8cddyyEzXPPPTc9/PDDNS/jWY3YNzCC46WXXpqOOOKItPPOOxf2HoxYF/sPxn6IsXTq0KFD0+WXX55eeOGFumYM9jbxXN9+++3p97//fdp+++0Lr8sqq6ySBg0aVHg+hg0blh544IH0zTffdPdQAQAAAACAHkIgBAAAAAAAgBwRCAEAAAAAACBHBEIAAAAAAADIEYEQAAAAAAAAckQgBAAAAAAAgBwRCAEAAAAAACBHBEIAAAAAAADIEYEQAAAAAAAAckQgBAAAAAAAgBwRCAEAAAAAACBHBEIAAAAAAADIEYEQAAAAAAAAckQgBAAAAAAAgBwRCAEAAAAAACBHBEIAAAAAAADIEYEQAAAAAAAAckQgBAAAAAAAgBwRCAEAAAAAACBHBEIAAAAAAADIEYEQAAAAAAAAckQgBAAAAAAAgBwRCAEAAAAAACBHBEIAAAAAAADIEYEQAAAAAAAAckQgBAAAAAAAgBwRCAEAAAAAACBHBEIAAAAAAADIEYEQAAAAAAAAckQgBAAAAAAAgBwRCAEAAAAAACBHBEIAAAAAAADIEYEQAAAAAAAAckQgBAAAAAAAgBwRCAEAAAAAACBHBEIAAAAAAADIEYEQAAAAAAAAckQgBAAAAAAAgBwRCAEAAAAAACBHBEIAAAAAAADIEYEQAAAAAAAAckQgBAAAAAAAgBwRCAEAAAAAACBHBEIAAAAAAADIEYEQAAAAAAAAckQgBAAAAAAAgBwRCAEAAAAAACBHBEIAAAAAAADIEYEQAAAAAAAAckQgBAAAAAAAgBwRCAEAAAAAACBHBEIAAAAAAADIEYEQAAAAAAAAckQgBAAAAAAAgBwRCAEAAAAAACBHBEIAAAAAAADIEYEQAAAAAAAAckQgBAAAAAAAgBwRCAEAAAAAACBHBEIAAAAAAADIEYEQAAAAAAAAckQgBAAAAAAAgBwRCAEAAAAAACBHBEIAAAAAAADIEYEQAAAAAAAAckQgBAAAAAAAgBwRCAEAAAAAACBHBEIAAAAAAADIEYEQAAAAAAAAckQgBAAAAAAAgBwRCAEAAAAAACBHBELoYb766qv05ptvpqeffjo9++yzady4cd09JOo0YcKE9OKLL6YnnngivfLKK+mLL77oFc/l+++/n/773/+m119/vdeMGWoxefLkws9m/J5944030rfffusJBAAAACBXchsI4wP7jTbaqPW49NJLqzrv9NNPLznv3XffLbvNhRdeWHKbOO6+++4Or3399deXnPPqq69m3u6SSy4pu361x+DBg8uud/nll9d9vUrHySefXHY/v/zlLzt1zTPOOCPzQ96s22655ZaFx3rwwQen4cOHp3vuuSd9/vnnqaf68ssvC+/BQYMGpVlnnTV973vfKzlmm222tM4666Sjjjoq/ec//0nfffdd2TU++OCDhr+OcXz99dcdjj+e20033bTkvCOOOKKqxx4/G40e84EHHlh2P8cee2ynrnnooYdW/bvlF7/4RfrBD35Q9jpON910aamllkp77713uvLKK9OkSZNST/Hoo48WxtWvX7+SMU8zzTRp7bXXTueee27hfVqteD935vneb7/9Uk8Qj3nzzTev670Q/vznP5c9tr/+9a8dnvfhhx9mPi+fffZZ2W1POOGETj3XBx10UOYYDjjggHbP23HHHdOvfvWrwv3fdtttacqUKakWcW69Y45/Z2s1evTows/mXHPNlfk7Nn7/nnXWWemjjz6q+dq//e1vS8a32WabiesAAAAA9Gi5DYR33HFHyYeDf/jDH6r+QLP4vNdeey3zg8K2Hz5uvfXWHV77zDPPLDknZvBkidDR9vrVHosvvnjZ9Y4//vi6r1fp2GOPPcruZ7nlluvUNYcMGVJ2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gguWjCP29Gv7O6KrRYAuHkP872rFzMeW8xZaaKGpLhDGvp8tY15nnXUq3m7ixIklcW/fffetORCG+Pkpfp4ef/zxHhkI4/dPBP6WIyJZhOWdd9655HmImfF33XVXtwXCtu/R+eabLzVa8Wsa99XeH+MU/3FNvLcAAAAAoKfIbSCM6NKIQBhLhtYaCL/99tuSvcpGjx5d+LpA2LxAeO+995acF7M6e7p77rmn8OF78Qf2tYaARgTCJ554ouQaEUYialQ6ioPLIosskvIaCFt8/PHHab311isZy8knn9zUMcSSosX3H3tbViOWjiw+b9lll52qAmHsC1k85lhGtL339o9+9KPW2y6wwAIlS4NWGwjPP//81u8vscQSZd/vKYEwQlglDz/8cJp11llbbxtLJb/zzjvdFgjjtWg5P/5AodLyr/WI17j4+rGEaXvvkT322KPk8VRazhUAAAAAmi23gfDBBx9sSCDMmvnTUSAMJ554Yuv3YynJIBA2LxC2DSS///3vU29w3HHHVbU/WlcGwrbhp9bjqaeeynUgDK+//nrJjNDNNtusqfcfM8CKn4shQ4ZUdd7LL79cct6WW245VQXC4cOHd+q9/eijj9YcCGPfyldeeaVwxP55vTEQhpEjR5aMIWY9d1cg3Hzzzbssyj3yyCOdeo/86U9/athYAAAAAKAzchsIY5+kegLRnnvuWXJezKipJxDGB7gzzTRT4fsRCsaNGycQNjEQFu+hF0d8uN0bRFwrHvepp57a9EA4YMCATn1A/sc//jHlPRCG1VZbrXUsMROt2YGy+LnYdNNN65p5/f/+3/+bqgJhLXvuZR1HH310zYGwI70lEIZ4H7XcPpYdrXUf3UYFwqOOOqrTv+cqif+v0Jn3yJprrtmwsQAAAABAZ+Q2EL744oslH9oNHTq0qvN22GGHkvNiudB6AmHYddddW28TH6abQdicQBhLxC288MKt50SgrXc5vGabMGFCyeONGYXNDISxpO4000zTen7sRbjKKqt0eMQ+ey3nrLrqqjU+6qkzEG677bZV7eXXFeL31myzzVbzPm0RpIufw7/85S9TTSB8++23S/bLjNekmvd28dKaK6ywQq4D4dNPP12yH2G1f7DR6EA4atSokmvEPomNsvzyy7det2/fvlW9R+aff/7Wc+I91lv+vQEAAABg6pbbQPjJJ5+UhI79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ABZEQAgAAAAAAAALIiAEAAAAAACABREQAgAAAAAAwIIICAEAAAAAAGBBBIQAAAAAAACwIAJCAAAAAAAAWBABIQAAAAAAACyIgBAAAAAAAAAWREAIAAAAAAAACyIgBAAAAAAAgAUREAIAAAAAAMCCCAgBAAAAAABgQQSEAAAAAAAAsCACQgAAAAAAAFgQASEAAAAAAAAsiIAQAAAAAAAAFkRACAAAAAAAAAsiIAQAAAAAAIAFERACAAAAAADAgggIAQAAAAAAYEEEhAAAAAAAALAgAkIAAAAAAABYEAEhAAAAAAAALIiAEAAAAAAAABZEQAgAAAAAAAALIiAEAAAAAACAVJyz1AAAIABJREFUBREQAgAAAAAAwIIICAEAAAAAAGBBBIQAAAAAAACwIAJCAAAAAAAAWBABIQAAAAAAACyIgBAAAAAAAAAWREAIAAAAAAAACyIgBAAAAAAAgAUREAIAAAAAAMCCCAgBAAAAAABgQQSEAAAAAAAAsCACQgAAAAAAAFgQASEAAAAAAAAsiIAQAAAAAAAAFkRACAAAAAAAAAsiIAQAAAAAAIAFERACAAAAAADAgggIAQAAAAAAYEEEhAAAAAAAALAgAkIAAAAAAABYEAEhAAAAAAAALIiAEAAAAAAAABZEQAgAAAAAAAALIiAEAAAAAACABREQAgAAAAAAwIIICAEAAAAAAGBBBIQAAAAAAACwIAJCAAAAAAAAWBABIQAAAAAAACyIgBAAAAAAAAAWREAIAAAAAAAACyIgBAAAAAAAgAUREAIAAAAAAMCCCAgBAAAAAABgQQSEAAAAAAAAsCACQgAAAAAAAFgQASEAAAAAAAAsiIAQAAAAAAAAFkRACAAAAAAAAAsiIAQAAAAAAIAFERACAAAAAADAgggIAQAAAAAAYEEEhAAAAAAAALAgAkIAAAAAAABYEAEhAAAAAAAALIiAEAAAAAAAABZEQAgAAAAAAAALIiAEAAAAAACABREQAgAAAAAAwIIICAEAAAAAAGBBBIQAAAAAAACwIAJCAAAAAAAAWBABIQAAAAAAACyIgBAAAAAAAAAWREAIAAAAAAAACyIgBAAAAAAAgAUREAIAAAAAAMCCCAgBAAAAAABgQQSEAAAAAAAAsCACQgAAAAAAAFgQASEAAAAAAAAsiIAQAAAAAAAAFkRACAAAAAAAAAsiIAQAAAAAAIAFERACAAAAAADAgggIAQAAAAAAYEEEhAAAAAAAALAgAkIAAAAAAABYEAEhAAAAAAAALIiAEAAAAAAAABZEQAgAAAAAAAALIiAEAAAAAACABREQAgAAAAAAwIIICAEAAAAAAGBBBIQAAAAAAACwIAJCAAAAAAAAWBABIQAAAAAAACyIgBAAAAAAAAAWREAIAAAAAAAACyIgBAAAAAAAgAUREAIAAAAAAMCCCAgBAAAAAABgQQSEAAAAAAAAsCACQgAAAAAAAFgQASEAAAAAAAAsiIAQAAAAAAAAFkRACAAAAAAAAAsiIAQAAAAAAIAFERACAAAAAADAgggIAQAAAAAAYEEEhAAAAAAAALAgAkIAAAAAAABYEAEhAAAAAAAALIiAEAAAAAAAABZEQAgAAAAAAAALIiAEAAAAAACABREQAgAAAAAAwIIICAEAAAAAAGBBBIQAAAAAAACwIAJCAAAAAAAAWBABIQAAAAAAACyIgBAAAAAAAAAWREAIAAAAAAAACyIgBAAAAAAAgAUREAIAAAAAAMCCCAgBAAAAAABgQQSEAAAAAAAAsCACQgAAAAAAAFgQASEAAAAAAAAsiIAQAAAAAAAAFkRACAAAAAAAAAsiIAQAAAAAAIAFERACAAAAAADAgggIAQAAAAAAYEEEhAAAAAAAALAgAkIAAAAAAABYEAEhAAAAAAAALIiAEAAAAAAAABZEQAgAAAAAAAALIiAEAAAAAACABREQAgAAAAAAwIIICAEAAAAAAGBBBIQAAAAAAACwIAJCAAAAAAAAWBABIQAAAAAAACyIgBAAAAAAAAAWREAIAAAAAAAACyIgBAAAAAAAgAUREAIAAAAAAMCCCAgBAAAAAABgQQSEAAAAAAAAsCACQgAAAAAAAFgQASEAAAAAAAAsiIAQAAAAAAAAFkRACAAAAAAAAAsiIAQAAAAAAIAFERACAAAAAADAgggIAQAAAAAAYEEEhAAAAAAAALAgAkIAAAAAAABYEAEhAAAAAAAALIiAEAAAAAAAABZEQAgAAAAAAAALIiAEAAAAAACABREQAgAAAAAAwIIICAEAAAAAAGBBBIQAAAAAAACwIAJCAAAAAAAAWBABIQAAAAAAACyIgBAAAAAAAAAWREAIAAAAAAAACyIgBAAAAAAAgAUREAIAAAAAAMCCCAgBAAAAAABgQQSEAAAAAAAA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AkIAAAAAAABYEAEhAAAAAAAALIiAEAAAAAAAABZEQAgAAAAAAAALIiAEAAAAAACABREQAgAAAAAAwIIICAEAAAAAAGBBBIQAAAAAAACwIAJCAAAAAAAAWBABIQAAAAAAACyIgBAAAAAAAAAWREAIAAAAAAAACyIgBAAAAAAAgAUREAIAAAAAAMCCCAgBAAAAAABgQQSEAAAAAAAAsCACQgAAAAAAAFgQASEAAAAAAAAsiIAQAAAAAAAAFkRACAAAAAAAAAsiIAQAAAAAAIAFERACAAAAAADAgggIAQAAAAAAYEEEhAAAAAAAALAgAkIAAAAAAABYEAEhAAAAAAAALIiAEAAAAAAAABZEQAgAAAAAAAALIiAEAAAAAACABREQAgAAAAAAwIIICAEAAAAAAGBBBIQAAAAAAACwIAJCAAAAAAAAWBABIQAAAAAAACyIgBAAAAAAAAAWREAIAAAAAAAACyIgBAAAAAAAgAUREAIAAAAAAMCCCAgBAAAAAABgQRYfEH7lK19ZvepVrzpie9/73rf3D+ILX/jC6mlPe9rq9re//epKV7rS6hKXuMTq/2vvzKO2q8r632CDqQ1aqZWZmEOkmUqaGIiIEq8KFAlOoEDAQqbEEiOUoQBRibCSQUhdCM5goSFkCA6IA1oGRqWmlZRmg821qvu3PvdvHTrP9exzzt7n7PM8z/ven89a5w94n/s+5z7DPntf3+v6XjvttNPi4Q9/+OIJT3jC4oQTTli89a1vXfzbv/1btX1+5StfWbzxjW9cPO95z1vstttui5133nnxoAc9aLn/Aw44YPHLv/zLi1tvvXVRmz/8wz9cvOIVr1j89E//9GKXXXZZ/OAP/uDigQ984OLRj370Yv/991+cddZZi49//ONV9/nJT35y8fKXv3zxtKc9bfGYxzxmub+HPexhi6c85SmLQw89dPH6179+8dWvfnVRmy9+8YuLc889d3HQQQctzyu/9cd+7McW++233+KlL33p4g/+4A+q7euv/uqvlr+De2WvvfZa/OiP/ujyHuK6su9DDjlk8drXvnbxF3/xF4s54fqec845i2c84xnLa8oxsD3qUY9aPPWpT1380i/90uK6665b/Nd//deo7//bv/3bxbve9a7Fy172ssUzn/nMxeMe97jFgx/84OU+HvGIRyye+MQnLs/BW97ylsU///M/L+bg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OeWU5bVs9oFASY+7yy+/PFukHytAs/9TTz11uX+uK/cywgq/vXYFGvcR48OrX/3q5X3EfcxvZp8kGHzgAx8YnTSQgutD3xaSERgTjjjiiOVzwyKL6jx+J89wiSWubA0YE7lfGJO4ls29S/8Pxt7Sau0c6DtIXx6el2OOOWa5z0MOOWRZHc79y/NMZrCI/B/0feU9wzyNilzGX54heu3O3W9wR51jMzdgzGFu0rzXmH8yFjEnZQykAromjKmMcYy57Jf90duVORFzQRKP5hh3RUREdlRIam6vLVgXN2sL1qkIia4tRERE8lEgFBEREREREREREREREVkhFAhFREREREREREREREREVggFQhEREREREREREREREZEVQoFQREREREREREREREREZIVQIBQRERERERERERERERFZIRQIRURERERERERERERERFYIBUIRERERERERERERERGRFUKBUERERERERERERERERGSFUCAUERERERERERERERERWSEUCEVERERERERERERERERWCAVCERERERERERERERERkRVCgVBERERERERERERERERkhVAgFBEREREREREREREREVkhFAhFREREREREREREREREVggFQhEREREREREREREREZEVQoFQREREREREREREREREZIVQIBQRERERERERERERERFZIRQIRURERERERERERERERFYIBUIRERERERERERERERGRFUKBUERERERERERERERERGSFUCAUERERERERERERERERWSEUCEVERERERERERERERERWCAVCERERERERERERERERkRVCgVBERERERERERERERERkhVAgFBEREREREREREREREVkhFAhFREREREREREREREREVggFQhEREREREREREREREZEVQoFQREREREREREREREREZIVQIBQRERERERERERERERFZIRQIRURERERERERERERERFYIBUIRERERERERERERERGRFUKBUERERERERERERERERGSFUCAUERERERERERERERERWSEUCEVERERERERERERERERWCAVCERERERERERERERERkRVCgVBERERERERERERERERkhVAgFBEREREREREREREREVkhFAhFREREREREREREREREVggFQhEREREREREREREREZEVQoFQREREREREREREREREZIVQIBQRERERERERERERERFZIRQIRURERERERERERERERFYIBUIRERERERERERERERGRFUKBUERERERERERERERERGSFUCAUERERERERERERERERWSEUCEVERERERERERERERERWCAVCERERERERERERERERkRVCgVBERERERERERERERERkhVAgFBEREREREREREREREVkhFAhFREREREREREREREREVggFQhEREREREREREREREZEVQoFQREREREREREREREREZIVQIBQRERERERERERERERFZIRQIRURERERERERERERERFYIBUIRERERERERERERERGRFUKBUERERERERERERERERGSFUCAUERERERERERERERERWSEUCEVERERERERERERERERWCAVCERERERERERERERERkRVCgVBERERERERERERERERkhVAgFBEREREREREREREREVkhFAhFREREREREREREREREVggFQhEREREREREREREREZEVQoFQREREREREREREREREZIVQIBQRERERERERERERERFZIRQIRURERERERERERERERFYIBUIRERERERERERERERGRFUKBUERERERERERERERERGSFUCAUERERERERERERERERWawO/w8kAx5jjDS9mAAAAABJRU5ErkJggg==';
async function productionIdentityImage(){return Buffer.from(productionIdentityFixture,'base64')}

async function runProductionVerificationRaw(force=false){
  if(force)Object.assign(productionVerification,{status:'pending',documentUpload:false,identityOcr:false,clientAutofill:false,bulkImport:false,xlsx:false,csv:false,arabic:false,serviceMapping:false,dryRun:false,canonicalWrites:null,errors:{},completedAt:null});
  if((!productionVerification.enabled&&!force)||productionVerification.status==='running'||productionVerification.status==='complete')return {...productionVerification};
  productionVerification.status='running';
  let objectKey=null,documentId=null,verificationClientId=null;
  try{
    const caseRows=await db('cases',{query:'?archived_at=is.null&select=id,client_id&limit=1'});
    if(!caseRows.length)throw new Error('NO_CASE_AVAILABLE');
    const activeUsers=await db('app_users',{query:'?status=eq.active&select=auth_user_id&limit=1'});
    if(!activeUsers.length)throw new Error('NO_ACTIVE_USER_AVAILABLE');
    const payload=Buffer.from(`%PDF-1.7\nCaseflow production verification ${crypto.randomUUID()}\n%%EOF`);
    const checksum=crypto.createHash('sha256').update(payload).digest('hex');
    objectKey=`cases/${caseRows[0].id}/verification-${crypto.randomUUID()}.pdf`;
    documentId=crypto.randomUUID();
    await r2.send(new PutObjectCommand({Bucket:r2Bucket,Key:objectKey,Body:payload,ContentType:'application/pdf',ContentLength:payload.length,Metadata:{verification:'true'}}));
    const head=await r2.send(new HeadObjectCommand({Bucket:r2Bucket,Key:objectKey}));
    if(Number(head.ContentLength)!==payload.length||String(head.ContentType).toLowerCase()!=='application/pdf')throw new Error('R2_OBJECT_MISMATCH');
    await db('documents',{method:'POST',body:{id:documentId,case_id:caseRows[0].id,client_id:caseRows[0].client_id||null,object_key:objectKey,file_name:'caseflow-production-verification.pdf',content_type:'application/pdf',size_bytes:payload.length,content_checksum:checksum,object_etag:String(head.ETag||'').replace(/^"|"$/g,'')||null,uploaded_by:activeUsers[0].auth_user_id,status:'uploaded',category:'verification',review_status:'received'}});
    const rows=await db('documents',{query:`?id=eq.${documentId}&select=id,case_id,client_id,object_key,size_bytes,content_checksum`});
    if(rows.length!==1||rows[0].case_id!==caseRows[0].id||rows[0].client_id!==(caseRows[0].client_id||null)||rows[0].content_checksum!==checksum)throw new Error('DOCUMENT_METADATA_MISMATCH');
    const downloaded=await r2.send(new GetObjectCommand({Bucket:r2Bucket,Key:objectKey}));
    const bytes=Buffer.from(await downloaded.Body.transformToByteArray());
    if(!bytes.equals(payload))throw new Error('DOCUMENT_DOWNLOAD_MISMATCH');
    await getSignedUrl(r2,new GetObjectCommand({Bucket:r2Bucket,Key:objectKey,ResponseContentDisposition:'inline; filename="caseflow-production-verification.pdf"',ResponseContentType:'application/pdf'}),{expiresIn:60});
    productionVerification.documentUpload=true;
  }catch(error){productionVerification.errors.documentUpload=error.message}
  finally{
    if(documentId)await db('documents',{method:'DELETE',query:`?id=eq.${documentId}`}).catch(()=>{});
    if(objectKey)await r2.send(new DeleteObjectCommand({Bucket:r2Bucket,Key:objectKey})).catch(()=>{});
  }
  try{
    const result=await extractIdentityDocument(await productionIdentityImage());
    if(result.engine!=='tesseract.js'||!result.mrz.detected||!result.mrz.valid||result.fields.passport_number!=='L898902C3')throw new Error('IDENTITY_EXTRACTION_MISMATCH');
    productionVerification.identityOcr=true;
    verificationClientId=crypto.randomUUID();
    const record={id:verificationClientId,...normalizeClientInput({...result.fields,preferred_language:'English'}),created_by:null,updated_by:null};
    await db('clients',{method:'POST',body:record});
    const rows=await db('clients',{query:`?id=eq.${verificationClientId}&select=id,legal_name,date_of_birth,nationality,passport_number,passport_country,passport_expiration`});
    if(rows.length!==1||rows[0].passport_number!=='L898902C3'||rows[0].legal_name!==result.fields.legal_name)throw new Error('CLIENT_AUTOFILL_MISMATCH');
    productionVerification.clientAutofill=true;
  }catch(error){productionVerification.errors[productionVerification.identityOcr?'clientAutofill':'identityOcr']=error.message}
  finally{if(verificationClientId)await db('clients',{method:'DELETE',query:`?id=eq.${verificationClientId}`}).catch(()=>{})}
  try{
    const verified=await verifyImportRuntime(serviceCatalog);
    Object.assign(productionVerification,{bulkImport:true,...verified});
  }catch(error){productionVerification.errors.bulkImport=error.message}
  productionVerification.completedAt=new Date().toISOString();
  productionVerification.status='complete';
  return {...productionVerification};
}
export function runProductionVerification(force=false){
  return withSystemDatabase(()=>runProductionVerificationRaw(force));
}
async function audit(principal,action,entityType,entityId,payload={},req){try{await db('audit_events',{method:'POST',body:{id:crypto.randomUUID(),actor_user_id:principal?.id||null,actor_label:principal?.displayName||'System',actor_roles:principal?.roles||[],action,entity_type:entityType,entity_id:entityId||null,client_id:uuid(payload.client_id)?payload.client_id:null,case_id:uuid(payload.case_id)?payload.case_id:null,metadata:{...payload,...(req?safeAuditContext(req):{})}}})}catch(e){console.error('audit-write-failed',e.message)}}
async function event(caseId,type,payload={},principal,req){try{await db('case_events',{method:'POST',body:{id:crypto.randomUUID(),case_id:caseId,event_type:type,actor:principal?.displayName||'Caseflow Workspace',actor_user_id:principal?.id||null,payload}})}catch(e){console.error('event-write-failed',e.message)}await audit(principal,type,'case',caseId,payload,req)}

async function loadImportBatch(batchId){if(!uuid(batchId))throw Object.assign(new Error('VALID_IMPORT_ID_REQUIRED'),{status:400});const [batches,rows]=await Promise.all([db('import_batches',{query:`?id=eq.${encodeURIComponent(batchId)}&select=*&limit=1`}),db('import_rows',{query:`?batch_id=eq.${encodeURIComponent(batchId)}&select=*&order=source_row_number&limit=10000`})]);if(!batches.length)throw Object.assign(new Error('IMPORT_NOT_FOUND'),{status:404});return {batch:batches[0],rows};}
async function analyzeStagedRows(sourceRows,mapping){const [clients,cases]=await Promise.all([db('clients',{query:'?archived_at=is.null&select=id,client_number,legal_name,legal_name_ar,date_of_birth,email,phone,a_number,passport_number,uscis_account_number&limit=10000'}),db('cases',{query:'?archived_at=is.null&select=id,client_id,receipt_number&limit=10000'})]);return analyzeImportRows(sourceRows,mapping,{services:serviceCatalog,clients,cases});}
async function persistImportAnalysis(batchId,rows){for(const row of rows){const classification=row.duplicate.classification;const unresolved=row.errors.length>0||classification==='possible';await db('import_rows',{method:'PATCH',query:`?batch_id=eq.${encodeURIComponent(batchId)}&source_row_number=eq.${row.source_row_number}`,body:{normalized_row:row.normalized,validation_errors:row.errors,warnings:row.warnings,duplicate_classification:classification,duplicate_candidates:row.duplicate.case_id?[{case_id:row.duplicate.case_id}]:(row.duplicate.candidates||[]),merge_client_id:classification==='exact'?row.duplicate.client_id:null,row_status:unresolved?'review_required':'valid',updated_at:new Date().toISOString()}});}const stored=await db('import_rows',{query:`?batch_id=eq.${encodeURIComponent(batchId)}&select=*&order=source_row_number&limit=10000`});return {rows:stored,summary:importSummary(stored)};}
function clientIdentityKey(row){const n=row.normalized_row||{};return n.a_number||n.passport_number||n.uscis_account_number||`${String(n.legal_name||n.legal_name_ar||'').toLowerCase()}|${n.date_of_birth||''}|${n.email||n.phone||''}`;}
async function processImport(batchId,principal){
  try{let {batch,rows}=await loadImportBatch(batchId);if(!['approved','processing','failed'].includes(batch.status))return;await db('import_batches',{method:'PATCH',query:`?id=eq.${batchId}`,body:{status:'processing',started_at:batch.started_at||new Date().toISOString(),error_code:null,updated_at:new Date().toISOString()}});const identityCache=new Map();for(const row of rows)if(row.result_client_id)identityCache.set(clientIdentityKey(row),row.result_client_id);let processed=0,createdClients=new Set(rows.map(row=>row.result_client_id).filter(Boolean)).size,createdCases=new Set(rows.map(row=>row.result_case_id).filter(Boolean)).size,skipped=0,failed=0;
    for(const row of rows){if(['completed','skipped'].includes(row.row_status)){processed++;if(row.row_status==='skipped')skipped++;continue;}if(row.review_action==='skip'){await db('import_rows',{method:'PATCH',query:`?id=eq.${row.id}`,body:{row_status:'skipped',updated_at:new Date().toISOString()}});processed++;skipped++;continue;}if(row.validation_errors?.length||row.duplicate_classification==='possible'&&!row.merge_client_id){failed++;await db('import_rows',{method:'PATCH',query:`?id=eq.${row.id}`,body:{row_status:'failed',error_message:'UNRESOLVED_REVIEW_REQUIRED',updated_at:new Date().toISOString()}});continue;}
      try{const n=row.normalized_row||{};let clientId=row.result_client_id||row.merge_client_id||identityCache.get(clientIdentityKey(row));let client;if(clientId)client=(await db('clients',{query:`?id=eq.${encodeURIComponent(clientId)}&select=id,client_number,legal_name&limit=1`}))[0];if(!client){const record={id:crypto.randomUUID(),legal_name:n.legal_name||n.legal_name_ar,legal_name_ar:n.legal_name_ar,date_of_birth:n.date_of_birth,place_of_birth:n.place_of_birth,nationality:n.nationality,phone:n.phone,whatsapp:n.whatsapp,email:n.email,physical_address:n.physical_address,a_number:n.a_number,uscis_account_number:n.uscis_account_number,passport_number:n.passport_number,preferred_language:n.preferred_language,operational_notes:n.operational_notes,import_batch_id:batchId,import_row_id:row.id,created_by:batch.uploaded_by,updated_by:batch.uploaded_by};client=(await db('clients',{method:'POST',body:record}))[0];createdClients++;}clientId=client.id;identityCache.set(clientIdentityKey(row),clientId);let caseRecord=null;const matchedCaseId=row.duplicate_candidates?.find?.(candidate=>candidate.case_id)?.case_id;if(matchedCaseId&&!row.result_case_id)caseRecord=(await db('cases',{query:`?id=eq.${encodeURIComponent(matchedCaseId)}&select=id,case_number&limit=1`}))[0];else if(n.service_code&&!row.result_case_id){caseRecord=(await db('cases',{method:'POST',body:{id:crypto.randomUUID(),client_id:clientId,client_name:client.legal_name,service_code:n.service_code,case_type:n.service_name,status:'active',workflow_stage:n.workflow_stage||'intake',review_state:'prepared',priority:n.priority||'normal',receipt_number:n.receipt_number,notes:n.operational_notes,import_batch_id:batchId,import_row_id:row.id,created_by:batch.uploaded_by,updated_by:batch.uploaded_by}}))[0];if(n.assigned_user_id)await db('case_assignments',{method:'POST',body:{case_id:caseRecord.id,auth_user_id:n.assigned_user_id,assignment_role:'lead',active:true,assigned_by:batch.approved_by||batch.uploaded_by}});createdCases++;}else if(row.result_case_id)caseRecord=(await db('cases',{query:`?id=eq.${row.result_case_id}&select=id,case_number&limit=1`}))[0];await db('import_rows',{method:'PATCH',query:`?id=eq.${row.id}`,body:{row_status:'completed',result_client_id:clientId,result_case_id:caseRecord?.id||null,result_client_number:client.client_number,result_case_number:caseRecord?.case_number||null,error_message:null,updated_at:new Date().toISOString()}});processed++;}catch(error){failed++;await db('import_rows',{method:'PATCH',query:`?id=eq.${row.id}`,body:{row_status:'failed',error_message:String(error.message||'IMPORT_ROW_FAILED').slice(0,200),updated_at:new Date().toISOString()}});}if(processed%25===0)await db('import_batches',{method:'PATCH',query:`?id=eq.${batchId}`,body:{processed_rows:processed,created_clients:createdClients,created_cases:createdCases,skipped_rows:skipped,failed_rows:failed,updated_at:new Date().toISOString()}});}
    const finalStatus=failed?'failed':'completed';await db('import_batches',{method:'PATCH',query:`?id=eq.${batchId}`,body:{status:finalStatus,processed_rows:processed,created_clients:createdClients,created_cases:createdCases,skipped_rows:skipped,failed_rows:failed,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}});await audit(principal,'import_batch_processed','import_batch',batchId,{total_rows:rows.length,processed,created_clients:createdClients,created_cases:createdCases,skipped,failed});
    if(failed)throw new Error('IMPORT_ROWS_FAILED');
    return {batch_id:batchId,processed,created_clients:createdClients,created_cases:createdCases,skipped};
  }catch(error){await db('import_batches',{method:'PATCH',query:`?id=eq.${batchId}`,body:{status:'failed',error_code:String(error.message||'IMPORT_FAILED').slice(0,120),updated_at:new Date().toISOString()}}).catch(()=>{});throw error;}}

function canonicalJson(value){if(Array.isArray(value))return`[${value.map(canonicalJson).join(',')}]`;if(value&&typeof value==='object')return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;return JSON.stringify(value)??'null';}
function jobFingerprint(job){return crypto.createHash('sha256').update(canonicalJson({job_type:job.job_type,case_id:job.case_id||null,participant_id:job.participant_id||null,payload:job.payload||{}})).digest('hex');}
async function enqueueBackgroundJob(job){const record={...job,available_at:new Date().toISOString(),priority:100,max_attempts:5,input_fingerprint:jobFingerprint(job)};try{return(await systemDb('background_jobs',{method:'POST',body:record}))[0]||record;}catch(error){if(error.status!==409)throw error;const existing=await systemDb('background_jobs',{query:`?idempotency_key=eq.${encodeURIComponent(job.idempotency_key)}&select=*&limit=1`});if(existing.length)return existing[0];throw error;}}
function backgroundPrincipal(job){return{id:job.requested_by||null,displayName:'Caseflow background worker',roles:['system']};}
async function processOfficialPdfJob(job){
  const instanceId=job.payload?.form_instance_id;if(!uuid(instanceId)||!uuid(job.case_id))throw Object.assign(new Error('INVALID_PDF_JOB_INPUT'),{failureClass:'permanent'});
  const instances=await db('form_instances',{query:`?id=eq.${instanceId}&case_id=eq.${job.case_id}&select=*`});if(!instances.length)throw Object.assign(new Error('FORM_INSTANCE_NOT_FOUND'),{failureClass:'permanent'});const instance=instances[0];if(Number(instance.revision)!==Number(job.payload?.form_revision))throw Object.assign(new Error('STALE_FORM_REVISION'),{failureClass:'permanent'});
  if(job.input_fingerprint!==jobFingerprint(job))throw Object.assign(new Error('JOB_INPUT_FINGERPRINT_MISMATCH'),{failureClass:'permanent'});
  const[definitions,versions,answers,cases]=await Promise.all([db('form_definitions',{query:`?id=eq.${instance.form_definition_id}&select=*`}),db('form_versions',{query:`?id=eq.${instance.form_version_id}&select=*`}),db('form_answers',{query:`?form_instance_id=eq.${instance.id}&select=*`}),db('cases',{query:`?id=eq.${job.case_id}&select=client_id`})]);
  const definition=definitions[0]?.definition,version=versions[0];if(!version?.source_object_key||!Array.isArray(definition?.pdf_mapping))throw Object.assign(new Error('VERIFIED_PDF_MAPPING_REQUIRED'),{failureClass:'permanent'});
  const source=await r2.send(new GetObjectCommand({Bucket:r2Bucket,Key:version.source_object_key})),sourceBytes=Buffer.from(await source.Body.transformToByteArray()),canonicalData=Object.fromEntries(answers.map(answer=>[answer.field_path,answer.answer_value]));
  const pdf=await populateOfficialPdf({sourceBytes,mapping:definition.pdf_mapping,canonicalData,flatten:false});
  const artifact=await storeGeneratedArtifact({caseId:job.case_id,instanceId:instance.id,artifactType:'official_form_pdf',authority:instance.pinned_authority,formCode:instance.pinned_form_code,editionDate:instance.pinned_edition_date,mappingVersion:instance.pinned_mapping_version,sourceHash:instance.pinned_source_sha256,bytes:pdf.bytes,pdfHash:pdf.sha256,generatedBy:job.requested_by,backgroundJobId:job.id});
  await audit(backgroundPrincipal(job),'official_form_pdf_generated','generated_artifact',artifact.id,{case_id:job.case_id,client_id:cases[0]?.client_id,form_instance_id:instance.id,pdf_sha256:pdf.sha256,action_source:'SYSTEM'});
  return{artifact_id:artifact.id,pdf_sha256:pdf.sha256,round_trip_passed:pdf.round_trip_passed,overflows:pdf.overflows};
}
async function processAiReviewJob(job){
  if(!uuid(job.case_id)||job.input_fingerprint!==jobFingerprint(job))throw Object.assign(new Error('INVALID_AI_JOB_INPUT'),{failureClass:'permanent'});const provider=configuredAiProvider();if(!provider)throw Object.assign(new Error('AI_PROVIDER_NOT_CONFIGURED'),{failureClass:'transient'});
  const cases=await db('cases',{query:`?id=eq.${job.case_id}&select=id`});if(!cases.length)throw Object.assign(new Error('CASE_NOT_FOUND'),{failureClass:'permanent'});const principal=backgroundPrincipal(job),toolNames=Array.isArray(job.payload?.tool_names)?job.payload.tool_names:[];
  const priorRuns=await db('ai_review_runs',{query:`?background_job_id=eq.${job.id}&select=*&limit=1`});if(priorRuns[0]?.status==='review_required'){const findings=await db('ai_findings',{query:`?review_run_id=eq.${priorRuns[0].id}&select=id`});return{review_run_id:priorRuns[0].id,finding_count:findings.length};}if(priorRuns.length)throw Object.assign(new Error('AI_REVIEW_PARTIAL_RESULT_REQUIRES_REVIEW'),{failureClass:'permanent'});
  const run={id:crypto.randomUUID(),case_id:job.case_id,background_job_id:job.id,provider:provider.name,model_version:provider.model,workflow_version:'case-review-v1',status:'running',requested_by:job.requested_by,approved_by:job.requested_by,started_at:new Date().toISOString()};await db('ai_review_runs',{method:'POST',body:run});
  try{const result=await runConstrainedAiReview({provider,principal,caseId:job.case_id,toolNames,executeTool:executeAiReadTool,onSnapshot:async snapshot=>db('ai_review_runs',{method:'PATCH',query:`?id=eq.${run.id}`,body:{...snapshot,tool_names:toolNames,human_review_required:true}})});for(const finding of result.findings)await db('ai_findings',{method:'POST',body:{id:crypto.randomUUID(),review_run_id:run.id,case_id:job.case_id,participant_id:finding.participant_id||null,form_instance_id:finding.form_instance_id||null,finding_key:finding.finding_id,category:finding.category,severity:finding.severity,field_path:finding.field_path||null,claim:finding.claim,source_references:finding.source_references,source_snapshot_sha256:result.input_snapshot_sha256,reason:finding.reason,suggested_action:finding.suggested_action,confidence:finding.confidence||null,requires_owner_approval:true}});await db('ai_review_runs',{method:'PATCH',query:`?id=eq.${run.id}`,body:{status:'review_required',output_sha256:result.output_sha256,completed_at:new Date().toISOString()}});await audit(principal,'ai_review_completed','ai_review_run',run.id,{case_id:job.case_id,provider:provider.name,model_version:provider.model,input_snapshot_sha256:result.input_snapshot_sha256,output_sha256:result.output_sha256,finding_count:result.findings.length,requires_owner_approval:true});return{review_run_id:run.id,finding_count:result.findings.length};}catch(error){await db('ai_review_runs',{method:'PATCH',query:`?id=eq.${run.id}`,body:{status:'failed',failure_code:String(error.message).slice(0,120),completed_at:new Date().toISOString()}}).catch(()=>{});throw error;}
}
async function executeBackgroundJob(job){if(job.job_type==='BULK_IMPORT')return processImport(job.payload?.batch_id,backgroundPrincipal(job));if(job.job_type==='GENERATE_OFFICIAL_PDF')return processOfficialPdfJob(job);if(job.job_type==='AI_CASE_REVIEW')return processAiReviewJob(job);throw Object.assign(new Error('UNSUPPORTED_JOB_TYPE'),{failureClass:'permanent'});}
const backgroundWorkerId=`node-${process.pid}-${crypto.randomUUID()}`,backgroundLeaseSeconds=120;let backgroundWorkerActive=false;
export async function runBackgroundWorkerCycle(){if(backgroundWorkerActive)return 0;backgroundWorkerActive=true;try{return await withSystemDatabase(async()=>{const claimed=await systemDb('rpc/claim_background_jobs',{method:'POST',body:{p_worker_id:backgroundWorkerId,p_limit:2,p_lease_seconds:backgroundLeaseSeconds}});for(const job of claimed){let heartbeatError=null;const heartbeat=setInterval(()=>systemDb('rpc/heartbeat_background_job',{method:'POST',body:{p_job_id:job.id,p_lease_token:job.lease_token,p_lease_seconds:backgroundLeaseSeconds}}).then(ok=>{if(ok!==true)heartbeatError=new Error('JOB_LEASE_LOST')}).catch(error=>{heartbeatError=error}),30_000);heartbeat.unref();try{const result=await executeBackgroundJob(job);if(heartbeatError)throw heartbeatError;const completed=await systemDb('rpc/complete_background_job',{method:'POST',body:{p_job_id:job.id,p_lease_token:job.lease_token,p_result:result||{}}});if(completed!==true)throw new Error('JOB_LEASE_LOST');}catch(error){await systemDb('rpc/fail_background_job',{method:'POST',body:{p_job_id:job.id,p_lease_token:job.lease_token,p_error_code:String(error.message||'JOB_FAILED').slice(0,120),p_failure_class:error.failureClass||'transient'}}).catch(failure=>console.error('background-job-failure-recording-failed',job.id,failure.message));}finally{clearInterval(heartbeat);}}return claimed.length;});}finally{backgroundWorkerActive=false;}}
function wakeBackgroundWorker(){setImmediate(()=>runBackgroundWorkerCycle().catch(error=>{if(!isMissingRelation(error))console.error('background-worker-failed',error.message)}));}

async function syncApplicationUser(user){
  // Auth lifecycle provisioning follows a verified Supabase Auth result (or an
  // Owner-only admin operation) and is deliberately the only application-user
  // synchronization path allowed to use the trusted system boundary.
  const existing=await systemDb('app_users',{query:`?auth_user_id=eq.${encodeURIComponent(user.id)}&select=auth_user_id`});
  const record={display_name:user.display_name||user.email,email:String(user.email||'').toLowerCase(),status:user.status||'active',updated_at:new Date().toISOString()};
  if(existing.length)await systemDb('app_users',{method:'PATCH',query:`?auth_user_id=eq.${encodeURIComponent(user.id)}`,body:record});
  else await systemDb('app_users',{method:'POST',body:{auth_user_id:user.id,...record}});
  if(Array.isArray(user.roles)){
    await systemDb('user_roles',{method:'DELETE',query:`?auth_user_id=eq.${encodeURIComponent(user.id)}`});
    for(const role of user.roles)await systemDb('user_roles',{method:'POST',body:{auth_user_id:user.id,role_code:role,assigned_by:user.assigned_by||null}});
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
    return {...principal,displayName:users[0].display_name||principal.displayName,preferredLanguage:normalizeLanguage(users[0].preferred_language),profileObjectKey:users[0].profile_object_key||null,roles,permissions:permissionsForRoles(roles)};
  }catch(error){
    if(error.message==='USER_INACTIVE'||error.message==='NO_ASSIGNED_ROLE')throw error;
    // JWT metadata is bootstrap input, not an authorization fallback. If the
    // canonical application-user tables cannot be read, accepting JWT roles
    // would reopen removed roles during a database or schema failure.
    throw Object.assign(new Error('AUTHORIZATION_STATE_UNAVAILABLE'),{status:503});
  }
}

// Kept as the mutation-call compatibility hook. Decisions are intentionally
// not process-cached, so every request observes the current database state.
export function invalidateAccessCache(){}

// A missing table means the authorization migration has not been applied yet.
// That is the pre-migration state, in which no Owner decision exists and
// everyone keeps the access they already had, so it resolves to an empty
// policy set rather than locking the firm out. Every other failure fails
// closed, because silently dropping restrictions would hand out more access
// than the Owner granted.
function isMissingRelation(error){const d=error?.internalDetails;const m=typeof d==='string'?d:`${d?.message||''} ${d?.code||''}`;return error?.status===404||/does not exist|PGRST205|42P01/i.test(m)}

async function loadAccessTables(){
  // Security decisions are read for every request. This deliberately removes
  // the process-local authorization window: a revocation committed by one
  // replica is observed by every other replica on its next request.
  const tables={at:Date.now(),policies:[],recordGrants:[],teamMembers:[],clientAccess:[],assignments:[],degraded:false};
  try{
    const [policies,recordGrants,teamMembers,clientAccess,assignments]=await Promise.all([
      db('access_policies',{query:'?select=*'}),
      db('record_access_grants',{query:'?select=*'}),
      db('team_members',{query:'?select=team_id,user_id'}),
      db('client_access',{query:'?select=client_id,auth_user_id,access_role,status'}),
      db('case_assignments',{query:'?select=case_id,auth_user_id,active'}),
    ]);
    Object.assign(tables,{policies:policies||[],recordGrants:recordGrants||[],teamMembers:teamMembers||[],clientAccess:clientAccess||[],assignments:assignments||[]});
  }catch(error){
    if(!isMissingRelation(error))throw error;
    console.warn('access-tables-unavailable: falling back to role defaults (authorization migration not applied?)');
    tables.degraded=true;
  }
  return tables;
}

async function accessFor(principal){
  // Internal API-key callers and the owner are unrestricted, so they need no
  // policy lookup at all.
  if(principal?.authType==='internal'||principal?.permissions?.has?.('*'))return resolveAccess({principal});
  const t=await loadAccessTables();
  const me=String(principal?.id||'');
  return resolveAccess({
    principal,
    policies:t.policies,
    recordGrants:t.recordGrants,
    teamIds:t.teamMembers.filter(r=>String(r.user_id)===me).map(r=>r.team_id),
    clientIds:t.clientAccess.filter(r=>String(r.auth_user_id)===me&&r.status==='active').map(r=>r.client_id),
    assignedCaseIds:t.assignments.filter(r=>String(r.auth_user_id)===me&&r.active!==false).map(r=>r.case_id),
  });
}

// Fetch the case rows a set of documents or events depends on, so the record
// decision has the fields the configured scope needs. Skipped for an
// unrestricted principal.
async function casesById(access,ids){
  const index=new Map();
  if(access?.isOwner)return index;
  const unique=[...new Set(ids.filter(id=>uuid(id)).map(String))];
  if(!unique.length)return index;
  const rows=await db('cases',{query:`?id=in.(${unique.join(',')})&select=id,client_id,team_id,assigned_user_id,assigned_to,service_code`});
  for(const row of rows||[])index.set(String(row.id),row);
  return index;
}

// Which clients this principal may reach. null means no narrowing (owner, or
// the default global scope), so the common path costs no extra query.
// For the case-shaped scopes a client is reachable when a case the caller can
// already reach belongs to it.
async function accessibleClientIds(access,permission='clients.view'){
  if(access?.isOwner)return null;
  const scope=scopeFor(access,'clients');
  if(scope==='global'&&hasEffectivePermission(access,permission))return null;
  const reachable=new Set([...access.grantedClientIds].map(String));
  if(scope==='client_self')for(const id of access.clientIds)reachable.add(String(id));
  if(!['global','client_self','explicit_client'].includes(scope)){
    const filter=caseListFilter(access,'cases.view');
    if(!filter?.matchesNothing){
      const rows=await db('cases',{query:`?select=id,client_id,team_id,assigned_user_id,assigned_to,service_code&limit=1000${filter?filter.query:''}`});
      for(const row of filterAccessibleCases(access,rows||[],'cases.view'))if(row.client_id)reachable.add(String(row.client_id));
    }
  }
  for(const id of access.restrictedClientIds)reachable.delete(String(id));
  return reachable;
}

// Alerts and invoices exist in two shapes: attached to a case, or attached only
// to a client (passport-expiry alerts, retainer invoices). The listings gate
// both shapes; every write path has to apply the same boundary or a narrowed
// staff member reaches another client's record by addressing it directly.
async function canReachClientRecord(access,record,casePermission){
  if(record?.case_id){const cases=await casesById(access,[record.case_id]);return canAccessCase(access,cases.get(String(record.case_id)),casePermission)}
  if(record?.client_id){const reachableClientIds=await accessibleClientIds(access,'clients.view');return canAccessClient(access,{id:record.client_id},'clients.view',{reachableClientIds})}
  return Boolean(access?.isOwner);
}

// The /clients/:id sub-resources address a client by url id exactly the way the
// parent route does, so they resolve through the same decision. Null means the
// caller cannot reach it, and the caller reports 404 rather than confirming the
// id exists.
async function reachableClient(access,clientId,permission){
  const rows=await db('clients',{query:`?id=eq.${encodeURIComponent(clientId)}&select=*`});
  if(!Array.isArray(rows)||!rows.length)return null;
  return canAccessClient(access,rows[0],permission,{reachableClientIds:await accessibleClientIds(access,permission)})?rows[0]:null;
}

function requiredPermission(req,path){
  if(path.startsWith('/api/v1/portal/documents'))return 'portal.documents';
  if(path.startsWith('/api/v1/portal/intakes'))return 'portal.intake';
  if(path.startsWith('/api/v1/portal/messages'))return 'portal.messages';
  if(path.startsWith('/api/v1/portal'))return 'portal.view';
  if(/^\/api\/v1\/cases\/[0-9a-f-]{36}\/portal-access/i.test(path))return req.method==='GET'?'cases.view':'cases.manage';
  if(path==='/api/v1/users')return req.method==='GET'?'users.view':'users.manage';
  if(/^\/api\/v1\/users\/[0-9a-f-]{36}$/i.test(path))return 'users.manage';
  if(path==='/api/v1/audit')return 'audit.view';
  if(path.startsWith('/api/v1/billing'))return req.method==='GET'?'billing.view':'billing.manage';
  if(path.startsWith('/api/v1/reports'))return 'reports.view';
  if(path==='/api/v1/dashboard/operations')return 'dashboard.view';
  if(path==='/api/v1/communications/center')return 'access.manage';
  if(path.startsWith('/api/v1/communications/internal'))return req.method==='GET'?'cases.view':'cases.manage';
  if(path.startsWith('/api/v1/imports'))return 'imports.manage';
  if(path==='/api/v1/forms/registry')return 'cases.view';
  if(path.startsWith('/api/v1/form-sources/'))return 'access.manage';
  if(path==='/api/v1/passport-router'||path==='/api/v1/asylum-router')return 'cases.prepare';
  if(/^\/api\/v1\/cases\/[0-9a-f-]{36}\/office-documents$/i.test(path))return 'cases.prepare';
  if(/^\/api\/v1\/artifacts\/[0-9a-f-]{36}\/download-url$/i.test(path))return 'documents.view';
  if(path.startsWith('/api/v1/ai-review'))return 'access.manage';
  if(/^\/api\/v1\/cases\/[0-9a-f-]{36}\/participants/i.test(path))return req.method==='GET'?'cases.view':'cases.manage';
  if(/^\/api\/v1\/cases\/[0-9a-f-]{36}\/histories/i.test(path))return req.method==='GET'?'cases.view':'cases.manage';
  if(/^\/api\/v1\/cases\/[0-9a-f-]{36}\/forms/i.test(path))return req.method==='GET'?'cases.view':'cases.prepare';
  if(path.startsWith('/api/v1/review-queue'))return 'documents.review';
  if(path.startsWith('/api/v1/alerts'))return req.method==='GET'?'dashboard.view':'tasks.manage';
  if(path.startsWith('/api/v1/appointments'))return req.method==='GET'?'cases.view':'cases.manage';
  if(path.startsWith('/api/v1/legal-holds')||path.startsWith('/api/v1/retention-policies'))return 'settings.manage';
  if(path.startsWith('/api/v1/clients'))return req.method==='GET'?'clients.view':'clients.manage';
  if(path.startsWith('/api/v1/tasks'))return req.method==='GET'?'tasks.view':'tasks.manage';
  if(path.startsWith('/api/v1/deadlines'))return req.method==='GET'?'tasks.view':'tasks.manage';
  if(path.startsWith('/api/v1/intakes'))return req.method==='GET'?'cases.view':'cases.manage';
  if(path.startsWith('/api/v1/services'))return 'dashboard.view';
  if(path.startsWith('/api/v1/document-requests'))return req.method==='GET'?'documents.view':'documents.manage';
  if(path.startsWith('/api/v1/agency-requests')||path.startsWith('/api/v1/evidence-requirements'))return req.method==='GET'?'cases.view':'cases.manage';
  if(path.startsWith('/api/v1/documents'))return path.endsWith('/review')?'documents.review':req.method==='GET'||path.endsWith('/download-url')?'documents.view':'documents.manage';
  if(path.startsWith('/api/v1/identity'))return 'clients.manage';
  if(path.startsWith('/api/v1/cases'))return req.method==='GET'?'cases.view':'cases.manage';
  if(path==='/api/v1/search')return 'cases.view';
  if(path.startsWith('/api/v1/settings'))return 'settings.manage';
  // Owner access management. No role holds access.manage by default, so these
  // are owner-only until the Owner delegates the permission.
  if(path.startsWith('/api/v1/access'))return 'access.manage';
  if(path==='/api/v1/teams'||path.startsWith('/api/v1/teams/'))return 'access.manage';
  // Deny by default. Falling through to dashboard.view meant any route added
  // later silently inherited the weakest permission in the system.
  return null;
}

async function authorize(req,res,permission){
  let principal;
  if(req.headers['x-api-key'])principal=internalAuth(req);
  else{assertSameOrigin(req);const sessionPrincipal=await authenticateSession(req,res);activateUserDatabase(sessionPrincipal.databaseAccessToken);principal=await resolveApplicationPrincipal(sessionPrincipal)}
  const access=await accessFor(principal);
  // A null permission means no rule matched the route: deny. The module-level
  // check happens here; record-level checks happen in the route, where the
  // record is available.
  if(!permission||!hasEffectivePermission(access,permission))throw Object.assign(new Error('FORBIDDEN'),{status:403});
  return {principal,access};
}

async function portalCase(principal,caseId){
  if(!uuid(caseId))throw Object.assign(new Error('INVALID_CASE_ID'),{status:400});
  if(principal.permissions.has('*')){
    const cases=await db('cases',{query:`?id=eq.${encodeURIComponent(caseId)}&archived_at=is.null&select=*`});
    if(!cases.length)throw Object.assign(new Error('CASE_NOT_FOUND'),{status:404});
    return cases[0];
  }
  const access=await db('client_access',{query:`?auth_user_id=eq.${encodeURIComponent(principal.id)}&status=eq.active&select=client_id,access_role`});
  const direct=await db('portal_case_access',{query:`?auth_user_id=eq.${encodeURIComponent(principal.id)}&case_id=eq.${encodeURIComponent(caseId)}&status=eq.active&select=case_id,portal_type,person_id`});
  if(!access.length&&!direct.length)throw Object.assign(new Error('CASE_NOT_FOUND'),{status:404});
  const clientIds=access.map(item=>item.client_id);
  const clientClause=clientIds.length?`&client_id=in.(${clientIds.map(encodeURIComponent).join(',')})`:'';
  const cases=await db('cases',{query:`?id=eq.${encodeURIComponent(caseId)}${direct.length?'':clientClause}&archived_at=is.null&select=*`});
  if(!cases.length)throw Object.assign(new Error('CASE_NOT_FOUND'),{status:404});
  return cases[0];
}

async function operationalReport(access,params){
  const from=String(params.get('from')||''),to=String(params.get('to')||''),serviceCode=String(params.get('service_code')||''),teamId=String(params.get('team_id')||''),assignedUserId=String(params.get('assigned_user_id')||'');
  if(from&&!/^\d{4}-\d{2}-\d{2}$/.test(from)||to&&!/^\d{4}-\d{2}-\d{2}$/.test(to)||from&&to&&from>to)throw Object.assign(new Error('INVALID_REPORT_DATE_RANGE'),{status:400});
  if(teamId&&!uuid(teamId)||assignedUserId&&!uuid(assignedUserId)||serviceCode&&!/^[A-Za-z0-9-]{1,40}$/.test(serviceCode))throw Object.assign(new Error('INVALID_REPORT_FILTER'),{status:400});
  const [allCases,allTasks,allDeadlines,allDocuments,allInvoices,allPayments,allAgencyRequests]=await Promise.all([
    db('cases',{query:'?archived_at=is.null&select=id,client_id,team_id,assigned_user_id,assigned_to,service_code,workflow_stage,priority,created_at,updated_at'}),
    db('tasks',{query:'?archived_at=is.null&select=id,case_id,status,due_date,priority,assigned_user_id,created_at,completed_at'}),
    db('deadlines',{query:'?select=id,case_id,status,deadline_date,deadline_type'}),
    db('documents',{query:'?archived_at=is.null&select=id,case_id,review_status,category,created_at'}),
    db('invoices',{query:'?select=id,client_id,case_id,status,currency,office_fee_cents,government_fee_cents,other_fee_cents,created_at'}),
    db('payments',{query:'?status=eq.recorded&select=id,invoice_id,amount_cents,currency,received_at'}),
    db('agency_requests',{query:'?select=id,case_id,request_type,status,response_due_date,created_at'}),
  ]);
  let caseRows=filterAccessibleCases(access,allCases||[],'cases.view');
  caseRows=caseRows.filter(row=>(!from||String(row.created_at||'').slice(0,10)>=from)&&(!to||String(row.created_at||'').slice(0,10)<=to)&&(!serviceCode||row.service_code===serviceCode)&&(!teamId||row.team_id===teamId)&&(!assignedUserId||row.assigned_user_id===assignedUserId));
  const caseIds=new Set(caseRows.map(row=>String(row.id))),clientIds=new Set(caseRows.map(row=>String(row.client_id)).filter(Boolean));
  const tasks=(allTasks||[]).filter(row=>caseIds.has(String(row.case_id))),deadlines=(allDeadlines||[]).filter(row=>caseIds.has(String(row.case_id))),documents=(allDocuments||[]).filter(row=>caseIds.has(String(row.case_id))),agency=(allAgencyRequests||[]).filter(row=>caseIds.has(String(row.case_id)));
  const invoices=(allInvoices||[]).filter(row=>row.case_id?caseIds.has(String(row.case_id)):clientIds.has(String(row.client_id))),invoiceIds=new Set(invoices.map(row=>String(row.id))),payments=(allPayments||[]).filter(row=>invoiceIds.has(String(row.invoice_id)));
  const countBy=(rows,key)=>rows.reduce((out,row)=>{const value=String(row[key]||'unknown');out[value]=(out[value]||0)+1;return out},{});
  const sum=(rows,key)=>rows.reduce((total,row)=>total+Number(row[key]||0),0),today=new Date().toISOString().slice(0,10);
  const completedDurations=tasks.filter(row=>row.completed_at&&row.created_at).map(row=>(new Date(row.completed_at)-new Date(row.created_at))/86400000).filter(Number.isFinite);
  const billed=invoices.filter(row=>row.status!=='void').reduce((total,row)=>total+Number(row.office_fee_cents||0)+Number(row.government_fee_cents||0)+Number(row.other_fee_cents||0),0),collected=sum(payments,'amount_cents');
  return {
    filters:{from:from||null,to:to||null,service_code:serviceCode||null,team_id:teamId||null,assigned_user_id:assignedUserId||null},
    cases:{total:caseRows.length,by_stage:countBy(caseRows,'workflow_stage'),by_priority:countBy(caseRows,'priority'),by_service:countBy(caseRows,'service_code'),by_team:countBy(caseRows,'team_id')},
    tasks:{total:tasks.length,overdue:tasks.filter(row=>!['completed','cancelled'].includes(row.status)&&row.due_date&&row.due_date<today).length,by_status:countBy(tasks,'status'),average_completion_days:completedDurations.length?Number((sum(completedDurations.map(value=>({value})),'value')/completedDurations.length).toFixed(2)):null},
    deadlines:{open:deadlines.filter(row=>row.status==='open').length,overdue:deadlines.filter(row=>row.status==='open'&&row.deadline_date<today).length,by_type:countBy(deadlines,'deadline_type')},
    documents:{total:documents.length,by_review_status:countBy(documents,'review_status'),by_category:countBy(documents,'category')},
    agency_requests:{total:agency.length,open:agency.filter(row=>!['filed','closed'].includes(row.status)).length,overdue:agency.filter(row=>!['filed','closed'].includes(row.status)&&row.response_due_date&&row.response_due_date<today).length,by_type:countBy(agency,'request_type')},
    billing:{invoice_count:invoices.length,billed_cents:billed,collected_cents:collected,outstanding_cents:Math.max(0,billed-collected),by_status:countBy(invoices,'status')},
  };
}

function reportCsv(report){
  const rows=[['section','metric','key','value']];
  for(const [section,metrics] of Object.entries(report))if(section!=='filters')for(const [metric,value] of Object.entries(metrics)){
    if(value&&typeof value==='object')for(const [key,count] of Object.entries(value))rows.push([section,metric,key,count]);
    else rows.push([section,metric,'',value??'']);
  }
  const escape=value=>`"${String(value).replace(/"/g,'""')}"`;
  return Buffer.from('\ufeff'+rows.map(row=>row.map(escape).join(',')).join('\r\n'),'utf8');
}

// The owner role is the root of this system's authority: it is unrestricted by
// design, so being able to hand it out is equivalent to being able to take
// over. Only an existing owner may grant or remove it, and only an owner may
// alter an owner's account at all. Without this, any holder of users.manage
// (every admin) could promote themselves and escape every Owner decision.
function assertOwnerRoleChangeAllowed(access,principal,target,requestedRoles,requestedStatus){
  if(access?.isOwner)return;
  const targetIsOwner=(target?.roles||[]).includes('owner');
  if(targetIsOwner)throw Object.assign(new Error('OWNER_ACCOUNT_IS_OWNER_CONTROLLED'),{status:403});
  if(Array.isArray(requestedRoles)&&requestedRoles.includes('owner'))throw Object.assign(new Error('OWNER_ROLE_IS_OWNER_CONTROLLED'),{status:403});
  // Changing your own roles is how a self-escalation chain starts.
  if(target?.id&&String(target.id)===String(principal?.id)&&requestedRoles!==undefined)throw Object.assign(new Error('SELF_ROLE_CHANGE_NOT_PERMITTED'),{status:403});
  if(requestedStatus!==undefined&&targetIsOwner)throw Object.assign(new Error('OWNER_ACCOUNT_IS_OWNER_CONTROLLED'),{status:403});
}

// A serialisable view of a resolved principal, used by /auth/me, login, and the
// Owner's effective-access preview.
function describeAccess(a){
  const scopes={};
  for(const m of accessModules)scopes[m]=scopeFor(a,m);
  return {is_owner:a.isOwner,permissions:a.isOwner?['*']:[...a.permissions].sort(),restrictions:[...a.restrictions].sort(),scopes,
    team_ids:[...a.teamIds],client_ids:[...a.clientIds],granted_case_ids:[...a.grantedCaseIds],granted_client_ids:[...a.grantedClientIds],
    restricted_case_ids:[...a.restrictedCaseIds],restricted_client_ids:[...a.restrictedClientIds]};
}

async function publicUser(principal){
  const a=await accessFor(principal);
  // Permissions and scopes are published so the workspace can hide controls the
  // caller cannot use. Presentation only -- every route enforces the model
  // server-side, per record.
  return {id:principal.id,email:principal.email,display_name:principal.displayName,preferred_language:normalizeLanguage(principal.preferredLanguage),profile_object_key:principal.profileObjectKey||null,roles:principal.roles,
    permissions:a.isOwner?['*']:[...a.permissions],access:describeAccess(a)};
}

function validationError(fields){return Object.assign(new Error('VALIDATION_FAILED'),{status:400,fields})}

function validateAccessPolicy(body){
  const errors={};
  const subjectType=String(body.subject_type||'');
  if(!['role','team','user'].includes(subjectType))errors.subject_type='Must be role, team or user';
  const subjectId=String(body.subject_id||'').trim();
  if(!subjectId)errors.subject_id='A subject is required';
  if(subjectType==='role'&&!roleDefinitions[subjectId])errors.subject_id='Unknown role';
  if((subjectType==='team'||subjectType==='user')&&!uuid(subjectId))errors.subject_id='Must be a UUID';
  // The Owner is unrestricted by definition; a policy pretending to limit the
  // owner role would be a lie the engine ignores, so it is refused here.
  if(subjectType==='role'&&subjectId==='owner')errors.subject_id='The owner role cannot be restricted';
  const catalogue=new Set(permissionCatalogue());
  const grants=Array.isArray(body.grants)?body.grants.map(v=>String(v).trim()).filter(Boolean):[];
  const restrictions=Array.isArray(body.restrictions)?body.restrictions.map(v=>String(v).trim()).filter(Boolean):[];
  if(new Set(grants).size!==grants.length)errors.grants='Duplicate permissions are not allowed';
  if(new Set(restrictions).size!==restrictions.length)errors.restrictions='Duplicate permissions are not allowed';
  if(grants.some(permission=>restrictions.includes(permission)))errors.permissions='The same permission cannot be granted and restricted';
  if(grants.includes('*')||restrictions.includes('*'))errors.permissions='Wildcard policy permissions are not accepted';
  for(const permission of [...grants,...restrictions])if(permission!=='*'&&!catalogue.has(permission))errors.permissions=`Unknown permission: ${permission}`;
  const scopes={};
  const supplied=body.scopes&&typeof body.scopes==='object'&&!Array.isArray(body.scopes)?body.scopes:{};
  for(const [module,scope] of Object.entries(supplied)){
    if(!accessModules.includes(module))errors.scopes=`Unknown module: ${module}`;
    else if(!isValidScope(scope))errors.scopes=`Unknown scope: ${scope}`;
    else scopes[module]=scope;
  }
  if(Object.keys(errors).length)throw validationError(errors);
  return {subject_type:subjectType,subject_id:subjectId,grants,restrictions,scopes,note:String(body.note||'').trim().slice(0,400)||null};
}

const serviceCodes=new Set(serviceCatalog.map(service=>service.code));
const serviceCategories=new Set(serviceCatalog.map(service=>service.category));

function validateRecordGrant(body){
  const errors={};
  if(!['user','team'].includes(body.subject_type))errors.subject_type='Must be user or team';
  if(!uuid(body.subject_id))errors.subject_id='Must be a UUID';
  if(!['case','client','category','service'].includes(body.resource_type))errors.resource_type='Must be case, client, category or service';
  // case/client are addressed by uuid; category/service by a catalogue key,
  // validated against the catalogue so a typo cannot create a dead grant.
  const keyed=['category','service'].includes(body.resource_type);
  if(!keyed&&!uuid(body.resource_id))errors.resource_id='Must be a UUID';
  if(keyed){
    const key=String(body.resource_key||'').trim();
    const known=body.resource_type==='category'?serviceCategories:serviceCodes;
    if(!key||!known.has(key))errors.resource_key=`Unknown ${body.resource_type}`;
  }
  if(!['grant','restrict'].includes(body.effect))errors.effect='Must be grant or restrict';
  const catalogue=new Set(permissionCatalogue());
  const permissions=Array.isArray(body.permissions)?body.permissions.map(v=>String(v).trim()).filter(Boolean):[];
  if(new Set(permissions).size!==permissions.length)errors.permissions='Duplicate permissions are not allowed';
  if(permissions.includes('*'))errors.permissions='Wildcard record permissions are not accepted';
  for(const permission of permissions)if(!catalogue.has(permission))errors.permissions=`Unknown permission: ${permission}`;
  if(Object.keys(errors).length)throw validationError(errors);
  const keyedTarget=['category','service'].includes(body.resource_type);
  return {subject_type:body.subject_type,subject_id:body.subject_id,resource_type:body.resource_type,
    resource_id:keyedTarget?null:body.resource_id,resource_key:keyedTarget?String(body.resource_key).trim():null,
    effect:body.effect,permissions,note:String(body.note||'').trim().slice(0,400)||null};
}

async function assertPolicyReferences(policy){
  if(policy.subject_type==='role')return;
  const table=policy.subject_type==='team'?'teams':'app_users',column=policy.subject_type==='team'?'id':'auth_user_id';
  const rows=await db(table,{query:`?${column}=eq.${encodeURIComponent(policy.subject_id)}&select=${column}&limit=1`});
  if(!rows.length)throw validationError({subject_id:`Unknown ${policy.subject_type}`});
  if(policy.subject_type==='user'){
    const roles=await db('user_roles',{query:`?auth_user_id=eq.${encodeURIComponent(policy.subject_id)}&role_code=eq.owner&select=role_code&limit=1`});
    if(roles.length)throw validationError({subject_id:'The Owner cannot be restricted by user policy'});
  }
}

async function assertGrantReferences(grant){
  const subjectTable=grant.subject_type==='team'?'teams':'app_users',subjectColumn=grant.subject_type==='team'?'id':'auth_user_id';
  const subjects=await db(subjectTable,{query:`?${subjectColumn}=eq.${encodeURIComponent(grant.subject_id)}&select=${subjectColumn}&limit=1`});
  if(!subjects.length)throw validationError({subject_id:`Unknown ${grant.subject_type}`});
  if(grant.subject_type==='user'){
    const roles=await db('user_roles',{query:`?auth_user_id=eq.${encodeURIComponent(grant.subject_id)}&role_code=eq.owner&select=role_code&limit=1`});
    if(roles.length)throw validationError({subject_id:'The Owner cannot receive record rules'});
  }
  if(grant.resource_type==='case'||grant.resource_type==='client'){
    const table=grant.resource_type==='case'?'cases':'clients';
    const resources=await db(table,{query:`?id=eq.${encodeURIComponent(grant.resource_id)}&select=id&limit=1`});
    if(!resources.length)throw validationError({resource_id:`Unknown ${grant.resource_type}`});
  }
  const key=grant.resource_type==='case'||grant.resource_type==='client'?`resource_id=eq.${encodeURIComponent(grant.resource_id)}`:`resource_key=eq.${encodeURIComponent(grant.resource_key)}`;
  const conflicts=await db('record_access_grants',{query:`?subject_type=eq.${grant.subject_type}&subject_id=eq.${encodeURIComponent(grant.subject_id)}&resource_type=eq.${grant.resource_type}&${key}&select=id,effect`});
  if(conflicts.length)throw validationError({effect:'A rule for this subject and resource already exists; revoke it before replacing it'});
}

async function handleRaw(req,res){
  const requestId=req.headers['x-request-id']||crypto.randomUUID();res.setHeader('x-request-id',requestId);const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);const ch=cors(req);
  if(req.method==='OPTIONS'){res.writeHead(204,{...securityHeaders(),...ch});return res.end()}
  if(req.method==='GET'&&u.pathname==='/brand/logo'){
    if(!r2||!r2Bucket)return json(res,404,{error:'BRAND_LOGO_NOT_FOUND',requestId},ch);
    try{
      const settings=await officeSettings();
      if(!settings.logo_object_key)return json(res,404,{error:'BRAND_LOGO_NOT_FOUND',requestId},ch);
      const object=await r2.send(new GetObjectCommand({Bucket:r2Bucket,Key:settings.logo_object_key}));
      const body=Buffer.from(await object.Body.transformToByteArray());
      res.writeHead(200,{...securityHeaders(),'cache-control':'public, max-age=3600, stale-while-revalidate=86400','content-type':object.ContentType||'image/png','content-length':body.length});
      return res.end(body);
    }catch{return json(res,404,{error:'BRAND_LOGO_NOT_FOUND',requestId},ch)}
  }
  if(req.method==='GET'&&publicAssets[u.pathname])return sendPublicAsset(req,res,publicAssets[u.pathname])
  if(req.method==='GET'&&u.pathname==='/health')return json(res,200,{status:'ok',service,version,requestId},ch);
  if(req.method==='GET'&&u.pathname==='/ready'){
    const [authStatus,databaseState,r2State]=await Promise.all([
      getAuthProvisioningStatus(),
      (async()=>{
        const state={connected:false,coreSchema:false,phase1Schema:false,importSchema:false,formsSchema:false,authorizationSchema:false,authorizationTables:{teams:false,teamMembers:false,accessPolicies:false,recordAccessGrants:false},authorizationTableErrors:{}};
        try{await db('cases',{query:'?select=id&limit=1'});state.connected=true}catch{return state}
        try{await db('clients',{query:'?select=id&limit=1'});state.coreSchema=true}catch{return state}
        try{
          await Promise.all([
            db('clients',{query:'?select=id,client_number,legal_name_ar&limit=1'}),
            db('cases',{query:'?select=id,case_number,opened_on&limit=1'}),
            db('app_users',{query:'?select=auth_user_id,preferred_language&limit=1'}),
            db('office_settings',{query:'?select=singleton&limit=1'}),
            db('communication_templates',{query:'?select=id&limit=1'}),
            db('outbound_communications',{query:'?select=id&limit=1'}),
          ]);
          state.phase1Schema=true;
        }catch{}
        try{await Promise.all([db('import_batches',{query:'?select=id,status&limit=1'}),db('import_rows',{query:'?select=id,batch_id&limit=1'})]);state.importSchema=true}catch{}
        try{await Promise.all([db('form_registry',{query:'?select=id&limit=1'}),db('form_instances',{query:'?select=id&limit=1'}),db('background_jobs',{query:'?select=id&limit=1'}),db('generated_artifacts',{query:'?select=id&limit=1'})]);state.formsSchema=true}catch{}
        const tableChecks=await Promise.all([
          ['teams','teams','id'],
          ['teamMembers','team_members','team_id'],
          ['accessPolicies','access_policies','id'],
          ['recordAccessGrants','record_access_grants','id'],
        ].map(async([check,table,column])=>{
          try{await db(table,{query:`?select=${column}&limit=1`});return [check,true,null]}
          catch(error){
            const detail=error?.internalDetails;
            const code=typeof detail==='object'?String(detail?.code||''):'';
            const category=isMissingRelation(error)?'schema_or_cache_missing':code==='42501'||error?.status===401||error?.status===403?'permission_denied':'unavailable';
            return [check,false,category];
          }
        }));
        state.authorizationTables=Object.fromEntries(tableChecks.map(([check,ok])=>[check,ok]));
        state.authorizationTableErrors=Object.fromEntries(tableChecks.filter(([,ok])=>!ok).map(([check,,category])=>[check,category]));
        state.authorizationSchema=Object.values(state.authorizationTables).every(Boolean);
        return state;
      })(),
      r2&&r2Bucket?r2.send(new HeadBucketCommand({Bucket:r2Bucket})).then(()=>true).catch(()=>false):Promise.resolve(false),
    ]);
    const emailConfigured=Boolean(process.env.RESEND_API_KEY&&process.env.RESEND_FROM_EMAIL);const checks={supabase:databaseState.connected,coreSchema:databaseState.coreSchema,phase1Schema:databaseState.phase1Schema,importSchema:databaseState.importSchema,authorizationSchema:databaseState.authorizationSchema,r2:r2State,internalAuth:Boolean(internalApiKey),userAuth:authStatus.configured,ownerAccount:authStatus.ownerProvisioned};
    if(productionVerification.enabled)Object.assign(checks,{documentUpload:productionVerification.documentUpload,identityOcr:productionVerification.identityOcr,clientAutofill:productionVerification.clientAutofill,bulkImport:productionVerification.bulkImport,xlsx:productionVerification.xlsx,csv:productionVerification.csv,arabic:productionVerification.arabic,serviceMapping:productionVerification.serviceMapping,dryRun:productionVerification.dryRun});
    const ready=Object.values(checks).every(Boolean);
    return json(res,ready?200:503,{status:ready?'ready':'not-ready',service,version,checks,capabilities:{staffForms:databaseState.formsSchema,aiReview:Boolean(process.env.AI_PROVIDER&&process.env.AI_PROVIDER_URL&&process.env.AI_PROVIDER_MODEL&&process.env.AI_PROVIDER_API_KEY),emailDelivery:emailConfigured},emailDelivery:{status:emailConfigured?'CONFIGURED':'PROVIDER_NOT_CONFIGURED',configured:emailConfigured},authorizationTables:databaseState.authorizationTables,authorizationTableErrors:databaseState.authorizationTableErrors,verification:productionVerification,requestId},ch);
  }

  // Unauthenticated. Reports only whether sign-in is usable; the tenant user
  // count is operational data and stays behind authentication.
  if(req.method==='GET'&&u.pathname==='/api/v1/auth/status'){const status=await getAuthProvisioningStatus();return json(res,200,{configured:status.configured,ownerProvisioned:status.ownerProvisioned,errorCode:status.errorCode||null,requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/auth/accept-invite'){assertSameOrigin(req);const body=await readJson(req,24_576);const session=await acceptInvitedUser({accessToken:body.access_token,password:body.password},req);activateUserDatabase(session.access_token);const principal=await resolveApplicationPrincipal({...principalFromUser(session.user),databaseAccessToken:session.access_token});await syncApplicationUser({id:principal.id,email:principal.email,display_name:principal.displayName,status:'active',roles:principal.roles});setSessionCookies(res,session);await audit(principal,'invitation_accepted','session',principal.id,{},req);return json(res,200,{user:await publicUser(principal),requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/auth/resend-owner-activation'){const principal=internalAuth(req);const result=await resendConfiguredOwnerActivation();await audit(principal,'owner_activation_resent','user',result.userId,{redirect_to:result.redirectTo},req);return json(res,200,{sent:true,redirectTo:result.redirectTo,requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/auth/login'){assertSameOrigin(req);const body=await readJson(req,16_384);const session=await signInWithPassword(body.email,body.password,req);activateUserDatabase(session.access_token);const principal=await resolveApplicationPrincipal({...principalFromUser(session.user),databaseAccessToken:session.access_token});setSessionCookies(res,session);await audit(principal,'login','session',principal.id,{},req);return json(res,200,{user:await publicUser(principal),requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/auth/logout'){assertSameOrigin(req);let principal=null;try{principal=await authenticateSession(req,res);activateUserDatabase(principal.databaseAccessToken)}catch{}const {accessToken}=sessionTokens(req);await revokeSession(accessToken);clearSessionCookies(res);await audit(principal,'logout','session',principal?.id||null,{},req);return json(res,200,{signedOut:true,requestId},ch)}
  if(req.method==='GET'&&u.pathname==='/api/v1/auth/me'){const sessionPrincipal=await authenticateSession(req,res);activateUserDatabase(sessionPrincipal.databaseAccessToken);const principal=await resolveApplicationPrincipal(sessionPrincipal);return json(res,200,{user:await publicUser(principal),requestId},ch)}

  if(u.pathname==='/api/v1/profile/preferences'&&(req.method==='GET'||req.method==='PATCH')){
    assertSameOrigin(req);
    const profileSessionPrincipal=await authenticateSession(req,res);activateUserDatabase(profileSessionPrincipal.databaseAccessToken);const profilePrincipal=await resolveApplicationPrincipal(profileSessionPrincipal);
    if(req.method==='GET')return json(res,200,{data:{display_name:profilePrincipal.displayName,preferred_language:normalizeLanguage(profilePrincipal.preferredLanguage),profile_object_key:profilePrincipal.profileObjectKey||null},requestId},ch);
    const body=await readJson(req,16_384);
    const patch={preferred_language:normalizeLanguage(body.preferred_language),updated_at:new Date().toISOString()};
    if(body.display_name!==undefined)patch.display_name=cleanText(body.display_name,{required:true,max:120});
    const data=await db('app_users',{method:'PATCH',query:`?auth_user_id=eq.${encodeURIComponent(profilePrincipal.id)}`,body:patch});
    await audit(profilePrincipal,'profile_preferences_updated','user',profilePrincipal.id,{preferred_language:patch.preferred_language},req);
    return json(res,200,{data:data[0]||patch,requestId},ch);
  }

  let principal=null;
  let access=null;
  if(u.pathname.startsWith('/api/'))({principal,access}=await authorize(req,res,requiredPermission(req,u.pathname)));

  if(req.method==='GET'&&u.pathname==='/api/v1/forms/registry'){const registry=await db('form_registry',{query:'?select=*&order=authority,form_code'}),versions=registry.length?await db('form_versions',{query:`?registry_id=in.(${registry.map(x=>x.id).join(',')})&select=*&order=created_at.desc`}):[];return json(res,200,{data:registry.map(x=>({...x,versions:versions.filter(v=>v.registry_id===x.id)})),requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/form-sources/probe'){
    if(!access.isOwner)throw Object.assign(new Error('OWNER_APPROVAL_REQUIRED'),{status:403});if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});
    const b=await readJson(req,32_768);if(!uuid(b.registry_id)||!String(b.edition_date||'').trim())throw Object.assign(new Error('FORM_VERSION_INPUT_REQUIRED'),{status:400});
    const registry=await db('form_registry',{query:`?id=eq.${b.registry_id}&select=*&limit=1`});if(!registry.length)throw Object.assign(new Error('FORM_NOT_REGISTERED'),{status:404});
    const existing=await db('form_versions',{query:`?registry_id=eq.${b.registry_id}&edition_date=eq.${encodeURIComponent(String(b.edition_date).trim())}&select=*&limit=1`});
    const probe=await probeOfficialSource({url:b.official_pdf_source,etag:existing[0]?.source_etag,lastModified:existing[0]?.source_last_modified});
    if(!probe.changed)return json(res,200,{data:{changed:false,version:existing[0]},requestId},ch);
    const objectKey=safeKey(`official-forms/${b.registry_id}/${String(b.edition_date).replace(/[^0-9A-Za-z.-]/g,'_')}-${probe.sha256}.pdf`);
    await r2.send(new PutObjectCommand({Bucket:r2Bucket,Key:objectKey,Body:probe.bytes,ContentType:probe.content_type,ContentLength:probe.bytes.length,Metadata:{registry_id:b.registry_id,source_sha256:probe.sha256}}));
    if(existing.length&&['active','verified_source','mapped','tested'].includes(existing[0].status)&&existing[0].source_sha256&&existing[0].source_sha256!==probe.sha256){
      const instances=await db('form_instances',{query:`?form_version_id=eq.${existing[0].id}&select=case_id`}),alertRows=await db('form_update_alerts',{query:`?form_version_id=eq.${existing[0].id}&detected_source_sha256=eq.${probe.sha256}&status=in.(open,acknowledged)&select=*`});
      const alert=alertRows[0]||(await db('form_update_alerts',{method:'POST',body:{id:crypto.randomUUID(),form_version_id:existing[0].id,authority:registry[0].authority,form_code:registry[0].form_code,old_source_sha256:existing[0].source_sha256,detected_source_sha256:probe.sha256,old_etag:existing[0].source_etag,detected_etag:probe.etag,official_source:String(b.official_pdf_source),affected_open_cases:new Set(instances.map(x=>x.case_id)).size,mapping_status:'review_required',status:'open',metadata:{quarantine_object_key:objectKey,detected_last_modified:probe.last_modified}}}))[0];
      await audit(principal,'official_form_source_change_detected','form_update_alert',alert.id,{registry_id:b.registry_id,form_version_id:existing[0].id,old_sha256:existing[0].source_sha256,detected_sha256:probe.sha256,affected_open_cases:alert.affected_open_cases,action_source:'SYSTEM'},req);
      return json(res,202,{data:{changed:true,quarantined:true,alert,active_version_unchanged:true},requestId},ch);
    }
    const values={official_pdf_source:String(b.official_pdf_source),official_instructions_source:cleanText(b.official_instructions_source,{max:1000}),source_object_key:objectKey,retrieved_at:probe.retrieved_at,source_etag:probe.etag,source_last_modified:probe.last_modified,source_sha256:probe.sha256,status:'retrieved',mapping_test_status:'not_run'};
    const rows=existing.length?await db('form_versions',{method:'PATCH',query:`?id=eq.${existing[0].id}`,body:values}):await db('form_versions',{method:'POST',body:{id:crypto.randomUUID(),registry_id:b.registry_id,edition_date:String(b.edition_date).trim(),...values}});
    await audit(principal,'official_form_source_retrieved','form_version',rows[0]?.id,{registry_id:b.registry_id,authority:registry[0].authority,form_code:registry[0].form_code,source_sha256:probe.sha256,action_source:'SYSTEM'},req);
    return json(res,201,{data:{changed:true,version:rows[0]},requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/form-sources/verify'){
    if(!access.isOwner)throw Object.assign(new Error('OWNER_APPROVAL_REQUIRED'),{status:403});if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});
    const b=await readJson(req,500_000);if(b.human_confirmed!==true||!uuid(b.version_id))throw Object.assign(new Error('HUMAN_SOURCE_CONFIRMATION_REQUIRED'),{status:400});
    const versions=await db('form_versions',{query:`?id=eq.${b.version_id}&select=*&limit=1`});if(!versions.length||!versions[0].source_object_key)throw Object.assign(new Error('FORM_SOURCE_NOT_RETRIEVED'),{status:409});const versionRecord=versions[0];
    if(String(b.confirmed_sha256||'')!==String(versionRecord.source_sha256||''))throw Object.assign(new Error('FORM_SOURCE_HASH_MISMATCH'),{status:409});
    const definition=b.definition&&typeof b.definition==='object'&&!Array.isArray(b.definition)?b.definition:null,mapping=definition?.pdf_mapping;if(!Array.isArray(mapping))throw Object.assign(new Error('PDF_MAPPING_REQUIRED'),{status:400});
    const source=await r2.send(new GetObjectCommand({Bucket:r2Bucket,Key:versionRecord.source_object_key})),sourceBytes=Buffer.from(await source.Body.transformToByteArray());
    const synthetic=Object.fromEntries(mapping.map(x=>[x.canonical_field_path,x.test_value??(x.control_type==='checkbox'?true:'TEST')]));
    await populateOfficialPdf({sourceBytes,mapping,canonicalData:synthetic});
    const mappingVersion=Math.max(1,Number(b.mapping_version||1)),definitionHash=crypto.createHash('sha256').update(JSON.stringify(definition)).digest('hex');
    const oldDefinitions=await db('form_definitions',{query:`?form_version_id=eq.${versionRecord.id}&mapping_version=eq.${mappingVersion}&select=id`});
    let definitionRows=oldDefinitions.length?await db('form_definitions',{method:'PATCH',query:`?id=eq.${oldDefinitions[0].id}`,body:{definition,definition_sha256:definitionHash,status:'tested'}}):await db('form_definitions',{method:'POST',body:{id:crypto.randomUUID(),form_version_id:versionRecord.id,mapping_version:mappingVersion,definition,definition_sha256:definitionHash,status:'tested',created_by:principal.id}});
    await db('form_definitions',{method:'PATCH',query:`?form_version_id=eq.${versionRecord.id}&status=eq.active&id=neq.${definitionRows[0].id}`,body:{status:'superseded'}});definitionRows=await db('form_definitions',{method:'PATCH',query:`?id=eq.${definitionRows[0].id}`,body:{status:'active'}});
    await db('form_versions',{method:'PATCH',query:`?registry_id=eq.${versionRecord.registry_id}&status=eq.active`,body:{status:'superseded'}});
    const versionRows=await db('form_versions',{method:'PATCH',query:`?id=eq.${versionRecord.id}`,body:{verified_at:new Date().toISOString(),mapping_version:mappingVersion,mapping_test_status:'passed',status:'active',activated_by:principal.id,activated_at:new Date().toISOString()}});
    await audit(principal,'official_form_version_activated','form_version',versionRecord.id,{registry_id:versionRecord.registry_id,source_sha256:versionRecord.source_sha256,mapping_version:mappingVersion,definition_id:definitionRows[0]?.id,human_confirmed:true},req);
    return json(res,200,{data:{version:versionRows[0],definition:definitionRows[0]},requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/passport-router'){const b=await readJson(req,32768);return json(res,200,{data:routePassport(b),requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/asylum-router'){const b=await readJson(req,16384);return json(res,200,{data:routeAsylumAuthority(b),requestId},ch)}

  const agencyRequests=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})\/agency-requests$/i);
  if(agencyRequests&&(req.method==='GET'||req.method==='POST')){
    const caseRows=await db('cases',{query:`?id=eq.${agencyRequests[1]}&select=*`}),permission=req.method==='GET'?'cases.view':'cases.manage';if(!caseRows.length||!canAccessCase(access,caseRows[0],permission))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
    if(req.method==='GET'){const[requests,requirements,links]=await Promise.all([db('agency_requests',{query:`?case_id=eq.${agencyRequests[1]}&select=*&order=response_due_date.asc.nullslast,created_at.desc`}),db('evidence_requirements',{query:`?case_id=eq.${agencyRequests[1]}&select=*&order=sort_order.asc,created_at.asc`}),db('evidence_links',{query:`?case_id=eq.${agencyRequests[1]}&select=*&order=created_at.asc`})]);return json(res,200,{data:{requests,requirements,links},requestId},ch)}
    const b=await readJson(req,64_000),requestType=String(b.request_type||'').toLowerCase();if(!['rfe','rfie','noid','noir','other'].includes(requestType))throw Object.assign(new Error('INVALID_AGENCY_REQUEST_TYPE'),{status:400});if(b.source_document_id){if(!uuid(b.source_document_id))throw Object.assign(new Error('VALID_SOURCE_DOCUMENT_REQUIRED'),{status:400});const documents=await db('documents',{query:`?id=eq.${b.source_document_id}&case_id=eq.${agencyRequests[1]}&archived_at=is.null&select=id`});if(!documents.length)throw Object.assign(new Error('SOURCE_DOCUMENT_NOT_IN_CASE'),{status:409})}const record={id:crypto.randomUUID(),case_id:agencyRequests[1],source_document_id:b.source_document_id||null,request_type:requestType,title:cleanText(b.title,{required:true,max:240}),notice_date:cleanDate(b.notice_date),response_due_date:cleanDate(b.response_due_date),status:'open',summary:cleanText(b.summary,{max:10000}),created_by:principal.id,updated_by:principal.id};if(record.notice_date&&record.response_due_date&&record.response_due_date<record.notice_date)throw Object.assign(new Error('INVALID_AGENCY_RESPONSE_DUE_DATE'),{status:400});const data=await db('agency_requests',{method:'POST',body:record});await audit(principal,'agency_request_created','agency_request',record.id,{case_id:record.case_id,client_id:caseRows[0].client_id,request_type:record.request_type,source_document_id:record.source_document_id,response_due_date:record.response_due_date},req);return json(res,201,{data:data[0]||record,requestId},ch)
  }

  const agencyRequest=u.pathname.match(/^\/api\/v1\/agency-requests\/([0-9a-f-]{36})$/i);
  if(agencyRequest&&req.method==='PATCH'){
    const rows=await db('agency_requests',{query:`?id=eq.${agencyRequest[1]}&select=*`});if(!rows.length)throw Object.assign(new Error('AGENCY_REQUEST_NOT_FOUND'),{status:404});const cases=await db('cases',{query:`?id=eq.${rows[0].case_id}&select=*`});if(!cases.length||!canAccessCase(access,cases[0],'cases.manage'))throw Object.assign(new Error('AGENCY_REQUEST_NOT_FOUND'),{status:404});const b=await readJson(req,64_000),patch={updated_by:principal.id};if(b.status!==undefined){if(!['open','collecting','review','ready','filed','closed'].includes(b.status))throw Object.assign(new Error('INVALID_AGENCY_REQUEST_STATUS'),{status:400});patch.status=b.status}if(b.title!==undefined)patch.title=cleanText(b.title,{required:true,max:240});if(b.summary!==undefined)patch.summary=cleanText(b.summary,{max:10000});if(b.response_due_date!==undefined)patch.response_due_date=cleanDate(b.response_due_date);if(Object.keys(patch).length===1)throw Object.assign(new Error('NO_VALID_FIELDS'),{status:400});const data=await db('agency_requests',{method:'PATCH',query:`?id=eq.${agencyRequest[1]}&case_id=eq.${rows[0].case_id}`,body:patch});await audit(principal,'agency_request_updated','agency_request',agencyRequest[1],{case_id:rows[0].case_id,client_id:cases[0].client_id,previous_status:rows[0].status,new_status:patch.status||rows[0].status},req);return json(res,200,{data:data[0],requestId},ch)
  }

  const evidenceRequirements=u.pathname.match(/^\/api\/v1\/agency-requests\/([0-9a-f-]{36})\/requirements$/i);
  if(evidenceRequirements&&req.method==='POST'){
    const requests=await db('agency_requests',{query:`?id=eq.${evidenceRequirements[1]}&select=*`});if(!requests.length)throw Object.assign(new Error('AGENCY_REQUEST_NOT_FOUND'),{status:404});const cases=await db('cases',{query:`?id=eq.${requests[0].case_id}&select=*`});if(!cases.length||!canAccessCase(access,cases[0],'cases.manage'))throw Object.assign(new Error('AGENCY_REQUEST_NOT_FOUND'),{status:404});const b=await readJson(req,64_000);if(b.document_request_id){if(!uuid(b.document_request_id))throw Object.assign(new Error('VALID_DOCUMENT_REQUEST_REQUIRED'),{status:400});const linked=await db('document_requests',{query:`?id=eq.${b.document_request_id}&case_id=eq.${requests[0].case_id}&select=id`});if(!linked.length)throw Object.assign(new Error('DOCUMENT_REQUEST_NOT_IN_CASE'),{status:409})}const code=cleanText(b.requirement_code,{required:true,max:80}).toUpperCase();if(!/^[A-Z0-9][A-Z0-9._-]*$/.test(code))throw Object.assign(new Error('INVALID_REQUIREMENT_CODE'),{status:400});const record={id:crypto.randomUUID(),agency_request_id:requests[0].id,case_id:requests[0].case_id,document_request_id:b.document_request_id||null,requirement_code:code,title:cleanText(b.title,{required:true,max:240}),description:cleanText(b.description,{max:10000}),status:b.document_request_id?'requested':'missing',sort_order:Number.isSafeInteger(b.sort_order)&&b.sort_order>=0?b.sort_order:0,created_by:principal.id,updated_by:principal.id};const data=await db('evidence_requirements',{method:'POST',body:record});await audit(principal,'evidence_requirement_created','evidence_requirement',record.id,{case_id:record.case_id,client_id:cases[0].client_id,agency_request_id:record.agency_request_id,document_request_id:record.document_request_id},req);return json(res,201,{data:data[0]||record,requestId},ch)
  }

  const evidenceRequirement=u.pathname.match(/^\/api\/v1\/evidence-requirements\/([0-9a-f-]{36})$/i);
  if(evidenceRequirement&&req.method==='PATCH'){
    const rows=await db('evidence_requirements',{query:`?id=eq.${evidenceRequirement[1]}&select=*`});if(!rows.length)throw Object.assign(new Error('EVIDENCE_REQUIREMENT_NOT_FOUND'),{status:404});const cases=await db('cases',{query:`?id=eq.${rows[0].case_id}&select=*`});if(!cases.length||!canAccessCase(access,cases[0],'cases.manage'))throw Object.assign(new Error('EVIDENCE_REQUIREMENT_NOT_FOUND'),{status:404});const b=await readJson(req,32_768);if(!['missing','requested','received','accepted','insufficient','waived'].includes(b.status))throw Object.assign(new Error('INVALID_EVIDENCE_STATUS'),{status:400});const data=await db('evidence_requirements',{method:'PATCH',query:`?id=eq.${rows[0].id}&case_id=eq.${rows[0].case_id}`,body:{status:b.status,updated_by:principal.id}});await audit(principal,'evidence_requirement_status_changed','evidence_requirement',rows[0].id,{case_id:rows[0].case_id,client_id:cases[0].client_id,previous_status:rows[0].status,new_status:b.status},req);return json(res,200,{data:data[0],requestId},ch)
  }

  const evidenceDocuments=u.pathname.match(/^\/api\/v1\/evidence-requirements\/([0-9a-f-]{36})\/documents$/i);
  if(evidenceDocuments&&req.method==='POST'){
    const requirements=await db('evidence_requirements',{query:`?id=eq.${evidenceDocuments[1]}&select=*`});if(!requirements.length)throw Object.assign(new Error('EVIDENCE_REQUIREMENT_NOT_FOUND'),{status:404});const requirement=requirements[0],cases=await db('cases',{query:`?id=eq.${requirement.case_id}&select=*`});if(!cases.length||!canAccessCase(access,cases[0],'cases.manage')||!hasEffectivePermission(access,'documents.manage'))throw Object.assign(new Error('EVIDENCE_REQUIREMENT_NOT_FOUND'),{status:404});const b=await readJson(req,32_768);if(!uuid(b.document_id))throw Object.assign(new Error('VALID_DOCUMENT_ID_REQUIRED'),{status:400});const documents=await db('documents',{query:`?id=eq.${b.document_id}&case_id=eq.${requirement.case_id}&archived_at=is.null&select=*`});if(!documents.length||!canAccessDocument(access,documents[0],cases[0],'documents.manage'))throw Object.assign(new Error('DOCUMENT_NOT_IN_CASE'),{status:409});const existing=await db('evidence_links',{query:`?evidence_requirement_id=eq.${requirement.id}&document_id=eq.${b.document_id}&select=*`});if(existing.length)return json(res,200,{data:existing[0],idempotent:true,requestId},ch);const record={id:crypto.randomUUID(),evidence_requirement_id:requirement.id,document_id:b.document_id,case_id:requirement.case_id,relevance_status:'proposed',notes:cleanText(b.notes,{max:5000}),linked_by:principal.id};const data=await db('evidence_links',{method:'POST',body:record});await audit(principal,'evidence_document_linked','evidence_link',record.id,{case_id:record.case_id,client_id:cases[0].client_id,agency_request_id:requirement.agency_request_id,evidence_requirement_id:record.evidence_requirement_id,document_id:record.document_id},req);return json(res,201,{data:data[0]||record,requestId},ch)
  }

  const portalAccessRoute=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})\/portal-access(?:\/([0-9a-f-]{36}))?$/i);
  if(portalAccessRoute){
    const caseId=portalAccessRoute[1],caseRows=await db('cases',{query:`?id=eq.${caseId}&archived_at=is.null&select=*`});
    if(!caseRows.length||!canAccessCase(access,caseRows[0],req.method==='GET'?'cases.view':'cases.manage'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
    if(req.method==='GET')return json(res,200,{data:await db('portal_case_access',{query:`?case_id=eq.${caseId}&select=*&order=granted_at`}),requestId},ch);
    if(req.method==='POST'){
      const body=await readJson(req,16_384),portalType=String(body.portal_type||'');
      if(!uuid(body.auth_user_id)||!['employer','beneficiary'].includes(portalType))throw Object.assign(new Error('VALID_PORTAL_ACCESS_REQUIRED'),{status:400});
      if(portalType==='beneficiary'){
        if(!uuid(body.person_id))throw Object.assign(new Error('BENEFICIARY_PERSON_REQUIRED'),{status:400});
        const links=await db('case_people',{query:`?case_id=eq.${caseId}&person_id=eq.${encodeURIComponent(body.person_id)}&case_role=in.(beneficiary,principal_applicant,derivative_beneficiary,spouse,child)&select=person_id&limit=1`});
        if(!links.length)throw Object.assign(new Error('BENEFICIARY_NOT_IN_CASE'),{status:409});
      }
      const expectedRole=portalType==='employer'?'employer_portal':'beneficiary_portal';
      const role=await db('user_roles',{query:`?auth_user_id=eq.${encodeURIComponent(body.auth_user_id)}&role_code=eq.${expectedRole}&select=auth_user_id&limit=1`});
      if(!role.length)throw Object.assign(new Error('PORTAL_ROLE_MISMATCH'),{status:409});
      const existing=await db('portal_case_access',{query:`?case_id=eq.${caseId}&auth_user_id=eq.${encodeURIComponent(body.auth_user_id)}&select=case_id,status,portal_type,person_id`});
      if(existing.length&&(existing[0].portal_type!==portalType||String(existing[0].person_id||'')!==String(body.person_id||'')))throw Object.assign(new Error('PORTAL_ACCESS_IDENTITY_IMMUTABLE'),{status:409});
      const record={case_id:caseId,auth_user_id:body.auth_user_id,portal_type:portalType,person_id:body.person_id||null,status:'active',granted_by:principal.id,granted_at:new Date().toISOString(),revoked_at:null};
      const data=existing.length?await db('portal_case_access',{method:'PATCH',query:`?case_id=eq.${caseId}&auth_user_id=eq.${encodeURIComponent(body.auth_user_id)}`,body:{status:'active',revoked_at:null}}):await db('portal_case_access',{method:'POST',body:record});
      await audit(principal,'case_portal_access_granted','case',caseId,{case_id:caseId,client_id:caseRows[0].client_id,auth_user_id:body.auth_user_id,portal_type:portalType,person_id:body.person_id||null},req);
      return json(res,200,{data:data[0]||data,requestId},ch);
    }
    if(req.method==='DELETE'&&portalAccessRoute[2]){
      const data=await db('portal_case_access',{method:'PATCH',query:`?case_id=eq.${caseId}&auth_user_id=eq.${portalAccessRoute[2]}&status=eq.active`,body:{status:'revoked',revoked_at:new Date().toISOString()}});
      if(!data.length)return json(res,404,{error:'PORTAL_CASE_ACCESS_NOT_FOUND',requestId},ch);
      await audit(principal,'case_portal_access_revoked','case',caseId,{case_id:caseId,client_id:caseRows[0].client_id,auth_user_id:portalAccessRoute[2]},req);
      return json(res,200,{data:data[0],requestId},ch);
    }
  }

  const participantRoute=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})\/participants(?:\/(match))?$/i);
  if(participantRoute){const caseId=participantRoute[1],caseRows=await db('cases',{query:`?id=eq.${caseId}&select=*`});if(!caseRows.length||!canAccessCase(access,caseRows[0],req.method==='GET'?'cases.view':'cases.manage'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);if(req.method==='GET'){const links=await db('case_people',{query:`?case_id=eq.${caseId}&select=case_id,person_id,case_role,created_at&order=created_at`}),people=links.length?await db('people',{query:`?id=in.(${links.map(x=>x.person_id).join(',')})&select=*`}):[];return json(res,200,{data:links.map(x=>({...x,person:people.find(p=>p.id===x.person_id)||null})),requestId},ch)}const b=await readJson(req,64000),candidates=await db('people',{query:'?archived_at=is.null&select=id,legal_name,date_of_birth,a_number,passport_number,email,phone&limit=1000'}),matches=participantMatch(b,candidates);if(participantRoute[2])return json(res,200,{data:{matches,requires_human_review:Boolean(matches.length)},requestId},ch);const roles=new Set(['petitioner','beneficiary','principal_applicant','spouse','child','parent','sibling','derivative_beneficiary','sponsor','joint_sponsor','household_member','interpreter']),caseRole=String(b.case_role||'beneficiary');if(!roles.has(caseRole))throw Object.assign(new Error('INVALID_PARTICIPANT_ROLE'),{status:400});let personId,operation='participant_created';if(b.decision==='link_existing'){if(!uuid(b.person_id)||!matches.some(x=>x.person_id===b.person_id))throw Object.assign(new Error('MATCHED_PERSON_REQUIRED'),{status:409});personId=b.person_id;operation='participant_linked'}else{if(matches.length&&b.decision!=='create_new'){const review={id:crypto.randomUUID(),case_id:caseId,proposed_data:b,matched_person_id:matches[0].person_id,match_reasons:matches,status:'pending',created_by:principal.id};await db('participant_match_reviews',{method:'POST',body:review});throw Object.assign(new Error('POSSIBLE_PARTICIPANT_DUPLICATE_REQUIRES_REVIEW'),{status:409,details:{review_id:review.id,matches}})}if(matches.length){if(!uuid(b.match_review_id))throw Object.assign(new Error('MATCH_REVIEW_REQUIRED'),{status:409});const reviews=await db('participant_match_reviews',{query:`?id=eq.${b.match_review_id}&case_id=eq.${caseId}&status=eq.pending&select=id`});if(!reviews.length)throw Object.assign(new Error('MATCH_REVIEW_NOT_FOUND'),{status:409});await db('participant_match_reviews',{method:'PATCH',query:`?id=eq.${b.match_review_id}`,body:{status:'create_new',resolved_by:principal.id,resolved_at:new Date().toISOString()}})}personId=crypto.randomUUID();await db('people',{method:'POST',body:{id:personId,legal_name:cleanText(b.legal_name,{required:true,max:180}),legal_name_ar:cleanText(b.legal_name_ar,{max:180}),date_of_birth:cleanDate(b.date_of_birth),place_of_birth:cleanText(b.place_of_birth,{max:180}),nationality:cleanText(b.nationality,{max:120}),current_country:cleanText(b.current_country,{max:120}),a_number:cleanText(b.a_number,{max:30}),uscis_account_number:cleanText(b.uscis_account_number,{max:40}),passport_number:cleanText(b.passport_number,{max:60}),passport_expiration:cleanDate(b.passport_expiration),email:cleanText(b.email,{max:254}),phone:cleanText(b.phone,{max:60}),whatsapp:cleanText(b.whatsapp,{max:60}),physical_address:cleanText(b.physical_address,{max:500}),postal_code:cleanText(b.postal_code,{max:30}),immigration_status:cleanText(b.immigration_status,{max:180}),preferred_language:normalizeLanguage(b.preferred_language),identity_verification_status:'unverified'}})}const exists=await db('case_people',{query:`?case_id=eq.${caseId}&person_id=eq.${personId}&case_role=eq.${caseRole}&select=case_id`});if(!exists.length)await db('case_people',{method:'POST',body:{case_id:caseId,person_id:personId,case_role:caseRole}});await audit(principal,operation,'person',personId,{case_id:caseId,client_id:caseRows[0].client_id,participant_id:personId,case_role:caseRole,action_source:'STAFF_ASSISTED'},req);return json(res,201,{data:{person_id:personId,case_id:caseId,case_role:caseRole},requestId},ch)}

  const histories=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})\/histories$/i);if(histories){const caseRows=await db('cases',{query:`?id=eq.${histories[1]}&select=*`});if(!caseRows.length||!canAccessCase(access,caseRows[0],req.method==='GET'?'cases.view':'cases.manage'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);if(req.method==='GET')return json(res,200,{data:await db('person_history_records',{query:`?case_id=eq.${histories[1]}&archived_at=is.null&select=*&order=starts_on.desc`}),requestId},ch);const b=await readJson(req,64000),link=await db('case_people',{query:`?case_id=eq.${histories[1]}&person_id=eq.${b.person_id}&select=case_id`});if(!uuid(b.person_id)||!link.length)throw Object.assign(new Error('PARTICIPANT_NOT_IN_CASE'),{status:409});if(!['immigration','address','employment','travel'].includes(b.history_type))throw Object.assign(new Error('INVALID_HISTORY_TYPE'),{status:400});const record={id:crypto.randomUUID(),person_id:b.person_id,case_id:histories[1],history_type:b.history_type,starts_on:cleanDate(b.starts_on),ends_on:cleanDate(b.ends_on),current_record:b.current_record===true,details:b.details&&typeof b.details==='object'&&!Array.isArray(b.details)?b.details:{},verification_status:'unverified',revision:1,created_by:principal.id,updated_by:principal.id};if(record.starts_on&&record.ends_on&&record.ends_on<record.starts_on)throw Object.assign(new Error('INVALID_HISTORY_RANGE'),{status:400});const data=await db('person_history_records',{method:'POST',body:record});await audit(principal,'participant_history_created','person_history',record.id,{case_id:record.case_id,client_id:caseRows[0].client_id,participant_id:record.person_id,history_type:record.history_type,action_source:'STAFF_ASSISTED'},req);return json(res,201,{data:data[0]||record,requestId},ch)}

  const forms=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})\/forms$/i);if(forms){const caseRows=await db('cases',{query:`?id=eq.${forms[1]}&select=*`});if(!caseRows.length||!canAccessCase(access,caseRows[0],req.method==='GET'?'cases.view':'cases.prepare'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);if(req.method==='GET'){const instances=await db('form_instances',{query:`?case_id=eq.${forms[1]}&select=*&order=updated_at.desc`}),findings=await db('form_findings',{query:`?case_id=eq.${forms[1]}&status=eq.open&select=*`}),jobs=await db('background_jobs',{query:`?case_id=eq.${forms[1]}&select=*&limit=100`}),artifacts=await db('generated_artifacts',{query:`?case_id=eq.${forms[1]}&select=*`});return json(res,200,{data:{instances,findings,jobs,artifacts},requestId},ch)}const b=await readJson(req,32768);if(b.participant_id){if(!uuid(b.participant_id))throw Object.assign(new Error('INVALID_PARTICIPANT_ID'),{status:400});const links=await db('case_people',{query:`?case_id=eq.${forms[1]}&person_id=eq.${b.participant_id}&select=person_id&limit=1`});if(!links.length)throw Object.assign(new Error('PARTICIPANT_NOT_IN_CASE'),{status:409})}const registry=await db('form_registry',{query:`?authority=eq.${encodeURIComponent(b.authority)}&form_code=eq.${encodeURIComponent(b.form_code)}&select=id,authority,form_code&limit=1`});if(!registry.length)throw Object.assign(new Error('FORM_NOT_REGISTERED'),{status:404});const versions=await db('form_versions',{query:`?registry_id=eq.${registry[0].id}&status=eq.active&select=*&limit=1`});if(!versions.length)throw Object.assign(new Error('NO_ACTIVE_VERIFIED_FORM_EDITION'),{status:409});const defs=await db('form_definitions',{query:`?form_version_id=eq.${versions[0].id}&status=eq.active&select=*&limit=1`});if(!defs.length)throw Object.assign(new Error('ACTIVE_FORM_MAPPING_NOT_FOUND'),{status:409});const v=validateVersionActivation(versions[0],defs[0].definition);if(!v.allowed)throw Object.assign(new Error('FORM_EDITION_NOT_ACTIVATABLE'),{status:409,details:v});const record={id:crypto.randomUUID(),case_id:forms[1],participant_id:b.participant_id||null,form_version_id:versions[0].id,form_definition_id:defs[0].id,pinned_authority:registry[0].authority,pinned_form_code:registry[0].form_code,pinned_edition_date:versions[0].edition_date,pinned_mapping_version:versions[0].mapping_version,pinned_source_sha256:versions[0].source_sha256,status:'draft',revision:1,created_by:principal.id,updated_by:principal.id};const data=await db('form_instances',{method:'POST',body:record});await audit(principal,'form_instance_created','form_instance',record.id,{case_id:record.case_id,client_id:caseRows[0].client_id,action_source:'STAFF_ASSISTED'},req);return json(res,201,{data:data[0]||record,requestId},ch)}

  const canonicalAutofill=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})\/forms\/([0-9a-f-]{36})\/canonical-autofill$/i);
  if(canonicalAutofill&&(req.method==='GET'||req.method==='POST')){
    const caseRows=await db('cases',{query:`?id=eq.${canonicalAutofill[1]}&select=*`});if(!caseRows.length||!canAccessCase(access,caseRows[0],req.method==='GET'?'cases.view':'cases.prepare'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
    const instances=await db('form_instances',{query:`?id=eq.${canonicalAutofill[2]}&case_id=eq.${canonicalAutofill[1]}&select=*`});if(!instances.length)throw Object.assign(new Error('FORM_INSTANCE_NOT_FOUND'),{status:404});const instance=instances[0];
    const[definitions,answers,facts]=await Promise.all([db('form_definitions',{query:`?id=eq.${instance.form_definition_id}&select=definition`}),db('form_answers',{query:`?form_instance_id=eq.${instance.id}&select=*`}),instance.participant_id?db('verified_canonical_fields',{query:`?person_id=eq.${instance.participant_id}&case_id=eq.${instance.case_id}&status=eq.current&select=*`}):db('verified_canonical_fields',{query:`?client_id=eq.${caseRows[0].client_id}&subject_type=eq.client&status=eq.current&select=*`})]);
    const suggestions=buildCanonicalSuggestions(definitions[0]?.definition,facts,answers);if(req.method==='GET')return json(res,200,{data:{suggestions,human_confirmation_required:true},requestId},ch);
    const body=await readJson(req,64_000);if(body.confirmed!==true)throw Object.assign(new Error('HUMAN_CONFIRMATION_REQUIRED'),{status:400});if(!Array.isArray(body.field_paths)||!body.field_paths.length||body.field_paths.some(path=>typeof path!=='string'))throw Object.assign(new Error('CANONICAL_FIELD_SELECTION_REQUIRED'),{status:400});
    const selected=new Set(body.field_paths),chosen=suggestions.filter(item=>selected.has(item.field_path));if(chosen.length!==selected.size||chosen.some(item=>!item.eligible))throw Object.assign(new Error('INVALID_CANONICAL_FIELD_SELECTION'),{status:409});const saved=[];
    for(const suggestion of chosen){const existing=answers.find(item=>item.field_path===suggestion.field_path),revision=Number(existing?.revision||0),values={answer_value:suggestion.value,blank_state:null,source_type:'verified_field',source_record_id:suggestion.verified_canonical_field_id,source_document_id:null,canonical_field_path:suggestion.canonical_field_path,verified_canonical_field_id:suggestion.verified_canonical_field_id,canonical_value_sha256:crypto.createHash('sha256').update(JSON.stringify(suggestion.value)).digest('hex'),verification_status:'verified',validation_errors:[],revision:revision+1,last_changed_by:principal.id,last_changed_source:'STAFF_ASSISTED',updated_at:new Date().toISOString()},rows=existing?await db('form_answers',{method:'PATCH',query:`?id=eq.${existing.id}&revision=eq.${revision}`,body:values}):await db('form_answers',{method:'POST',body:{id:crypto.randomUUID(),form_instance_id:instance.id,field_path:suggestion.field_path,...values}});if(!rows.length)throw Object.assign(new Error('AUTOSAVE_CONFLICT'),{status:409});saved.push(rows[0])}
    await audit(principal,'form_canonical_autofill_confirmed','form_instance',instance.id,{case_id:instance.case_id,client_id:caseRows[0].client_id,participant_id:instance.participant_id||null,verified_field_ids:chosen.map(item=>item.verified_canonical_field_id),field_paths:chosen.map(item=>item.field_path),human_confirmed:true,action_source:'STAFF_ASSISTED'},req);return json(res,200,{data:{answers:saved,human_confirmed:true},requestId},ch);
  }

  const reverseIngest=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})\/forms\/([0-9a-f-]{36})\/reverse-ingest$/i);
  if(reverseIngest&&req.method==='POST'){
    const caseRows=await db('cases',{query:`?id=eq.${reverseIngest[1]}&select=*`});if(!caseRows.length||!canAccessCase(access,caseRows[0],'cases.prepare'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
    const body=await readJson(req,64_000);if(!uuid(body.document_id))throw Object.assign(new Error('VALID_DOCUMENT_ID_REQUIRED'),{status:400});const instances=await db('form_instances',{query:`?id=eq.${reverseIngest[2]}&case_id=eq.${reverseIngest[1]}&select=*`});if(!instances.length)throw Object.assign(new Error('FORM_INSTANCE_NOT_FOUND'),{status:404});const instance=instances[0];
    const[documents,definitions,answers]=await Promise.all([db('documents',{query:`?id=eq.${body.document_id}&case_id=eq.${reverseIngest[1]}&content_type=eq.application%2Fpdf&archived_at=is.null&select=*`}),db('form_definitions',{query:`?id=eq.${instance.form_definition_id}&select=definition`}),db('form_answers',{query:`?form_instance_id=eq.${instance.id}&select=*`})]);if(!documents.length)throw Object.assign(new Error('SOURCE_PDF_NOT_IN_CASE'),{status:404});if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});
    const object=await r2.send(new GetObjectCommand({Bucket:r2Bucket,Key:documents[0].object_key})),sourceBytes=Buffer.from(await object.Body.transformToByteArray()),checksum=crypto.createHash('sha256').update(sourceBytes).digest('hex');if(checksum!==documents[0].content_checksum)throw Object.assign(new Error('DOCUMENT_BYTE_VERSION_MISMATCH'),{status:409});const definition=definitions[0]?.definition||{},preview=await extractOfficialPdfAnswers({sourceBytes,mapping:definition.pdf_mapping});
    const fields=new Map((definition.fields||[]).map(field=>[field.path,field])),eligible=preview.answers.filter(item=>fields.has(item.field_path)&&validateFieldAnswer(fields.get(item.field_path),item.value).length===0);if(body.confirmed!==true)return json(res,200,{data:{...preview,answers:eligible},requestId},ch);if(!Array.isArray(body.field_paths)||!body.field_paths.length)throw Object.assign(new Error('REVERSE_INGEST_SELECTION_REQUIRED'),{status:400});const selected=new Set(body.field_paths),chosen=eligible.filter(item=>selected.has(item.field_path));if(chosen.length!==selected.size)throw Object.assign(new Error('INVALID_REVERSE_INGEST_SELECTION'),{status:409});const saved=[];
    for(const item of chosen){const existing=answers.find(answer=>answer.field_path===item.field_path),revision=Number(existing?.revision||0),values={answer_value:item.value,blank_state:null,source_type:'document_ocr',source_record_id:documents[0].id,source_document_id:documents[0].id,canonical_field_path:fields.get(item.field_path).canonical_field_path,verified_canonical_field_id:null,canonical_value_sha256:null,verification_status:'review_required',validation_errors:[],revision:revision+1,last_changed_by:principal.id,last_changed_source:'STAFF_ASSISTED',updated_at:new Date().toISOString()},rows=existing?await db('form_answers',{method:'PATCH',query:`?id=eq.${existing.id}&revision=eq.${revision}`,body:values}):await db('form_answers',{method:'POST',body:{id:crypto.randomUUID(),form_instance_id:instance.id,field_path:item.field_path,...values}});if(!rows.length)throw Object.assign(new Error('AUTOSAVE_CONFLICT'),{status:409});saved.push(rows[0])}
    await audit(principal,'official_pdf_reverse_ingest_confirmed','form_instance',instance.id,{case_id:instance.case_id,client_id:caseRows[0].client_id,source_document_id:documents[0].id,source_sha256:preview.source_sha256,field_paths:chosen.map(item=>item.field_path),human_confirmed:true,action_source:'STAFF_ASSISTED'},req);return json(res,200,{data:{answers:saved,human_confirmed:true},requestId},ch)
  }

  const answer=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})\/forms\/([0-9a-f-]{36})\/answers\/([^/]+)$/i);
  if(answer&&req.method==='PATCH'){
    const fieldPath=decodeURIComponent(answer[3]);if(!/^[a-zA-Z0-9_.\[\]-]{1,240}$/.test(fieldPath))throw Object.assign(new Error('INVALID_FORM_FIELD_PATH'),{status:400});
    const caseRows=await db('cases',{query:`?id=eq.${answer[1]}&select=*`});if(!caseRows.length||!canAccessCase(access,caseRows[0],'cases.prepare'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
    const instances=await db('form_instances',{query:`?id=eq.${answer[2]}&case_id=eq.${answer[1]}&select=*`});if(!instances.length)throw Object.assign(new Error('FORM_INSTANCE_NOT_FOUND'),{status:404});
    const definitions=await db('form_definitions',{query:`?id=eq.${instances[0].form_definition_id}&select=definition`}),field=definitions[0]?.definition?.fields?.find(item=>item.path===fieldPath);if(!field)throw Object.assign(new Error('FORM_FIELD_NOT_DEFINED'),{status:400});
    const b=await readJson(req,64000),canonicalFact=await validateAnswerProvenance(caseRows[0],b),value=b.value===undefined?null:b.value,validationErrors=validateFieldAnswer(field,value);if(validationErrors.length)throw Object.assign(new Error('INVALID_FORM_ANSWER'),{status:400,details:{field_path:fieldPath,errors:validationErrors}});
    if(canonicalFact&&(canonicalFact.subject_type==='person'&&canonicalFact.person_id!==instances[0].participant_id||canonicalFact.subject_type==='client'&&instances[0].participant_id))throw Object.assign(new Error('ANSWER_SOURCE_NOT_FORM_SUBJECT'),{status:409});
    if(canonicalFact&&JSON.stringify(canonicalFact.field_value)!==JSON.stringify(value))throw Object.assign(new Error('VERIFIED_FIELD_VALUE_MISMATCH'),{status:409});
    const existing=await db('form_answers',{query:`?form_instance_id=eq.${answer[2]}&field_path=eq.${encodeURIComponent(fieldPath)}&select=*`}),expected=Number(b.expected_revision||0);if(existing.length&&expected!==Number(existing[0].revision))throw Object.assign(new Error('AUTOSAVE_CONFLICT'),{status:409,details:{server:existing[0],expected_revision:expected}});
    const sourceType=b.source_type||'manual',values={answer_value:value,blank_state:b.blank_state||null,source_type:sourceType,source_record_id:b.source_record_id||null,source_document_id:b.source_document_id||null,canonical_field_path:field.canonical_field_path,verified_canonical_field_id:canonicalFact?.id||null,canonical_value_sha256:canonicalFact?crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'):null,verification_status:canonicalFact?'verified':sourceType==='manual'?'unverified':'review_required',validation_errors:validationErrors,revision:existing.length?Number(existing[0].revision)+1:1,last_changed_by:principal.id,last_changed_source:'STAFF_ASSISTED',updated_at:new Date().toISOString()};
    const data=existing.length?await db('form_answers',{method:'PATCH',query:`?id=eq.${existing[0].id}&revision=eq.${expected}`,body:values}):await db('form_answers',{method:'POST',body:{id:crypto.randomUUID(),form_instance_id:answer[2],field_path:fieldPath,...values}});if(existing.length&&!data.length)throw Object.assign(new Error('AUTOSAVE_CONFLICT'),{status:409});
    await audit(principal,'form_answer_saved','form_answer',data[0]?.id,{case_id:answer[1],client_id:caseRows[0].client_id,field_path:fieldPath,old_value:existing[0]?.answer_value??null,new_value:values.answer_value,verified_canonical_field_id:canonicalFact?.id||null,action_source:'STAFF_ASSISTED'},req);return json(res,200,{data:data[0]||data,requestId},ch)
  }

  const validate=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})\/forms\/([0-9a-f-]{36})\/validate$/i);if(validate&&req.method==='POST'){const caseRows=await db('cases',{query:`?id=eq.${validate[1]}&select=*`});if(!caseRows.length||!canAccessCase(access,caseRows[0],'cases.prepare'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);const instances=await db('form_instances',{query:`?id=eq.${validate[2]}&case_id=eq.${validate[1]}&select=id`});if(!instances.length)throw Object.assign(new Error('FORM_INSTANCE_NOT_FOUND'),{status:404});const review=await buildDeterministicCaseReview(validate[1],{persist:true,actorId:principal.id}),readiness=review.readiness_by_instance[validate[2]];return json(res,200,{data:{...readiness,deterministic_findings:review.findings.filter(item=>item.form_instance_id===validate[2]||item.form_instance_id===null)},requestId},ch)}

  const generate=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})\/forms\/([0-9a-f-]{36})\/generate$/i);
  if(generate&&req.method==='POST'){
    const generationRequest=await readJson(req,16_384);
    const cases=await db('cases',{query:`?id=eq.${generate[1]}&select=*`});if(!cases.length||!canAccessCase(access,cases[0],'cases.prepare'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
    const instances=await db('form_instances',{query:`?id=eq.${generate[2]}&case_id=eq.${generate[1]}&select=*`});if(!instances.length)throw Object.assign(new Error('FORM_INSTANCE_NOT_FOUND'),{status:404});const instance=instances[0];
    const[defs,versions,answers]=await Promise.all([db('form_definitions',{query:`?id=eq.${instance.form_definition_id}&select=*`}),db('form_versions',{query:`?id=eq.${instance.form_version_id}&select=*`}),db('form_answers',{query:`?form_instance_id=eq.${instance.id}&select=*`})]);const definition=defs[0]?.definition,versionRecord=versions[0];
    const deterministicReview=await buildDeterministicCaseReview(generate[1],{persist:true,actorId:principal.id}),readiness=deterministicReview.readiness_by_instance[instance.id]||formReadiness({definition,answers:Object.fromEntries(answers.map(a=>[a.field_path,a.answer_value])),version:versionRecord||{}});if(!readiness.filing_ready)throw Object.assign(new Error('FORM_NOT_READY_FOR_GENERATION'),{status:409,details:{...readiness,deterministic_findings:deterministicReview.findings.filter(item=>item.form_instance_id===instance.id||item.form_instance_id===null)}});
    if(!versionRecord?.source_object_key||!Array.isArray(definition?.pdf_mapping))throw Object.assign(new Error('VERIFIED_PDF_MAPPING_REQUIRED'),{status:409});
    let job=newJob({jobType:'GENERATE_OFFICIAL_PDF',idempotencyKey:`official:${instance.id}:${instance.revision}`,caseId:generate[1],participantId:instance.participant_id,payload:{form_instance_id:instance.id,form_revision:instance.revision},requestedBy:principal.id});
    const existingJobs=await db('background_jobs',{query:`?idempotency_key=eq.${encodeURIComponent(job.idempotency_key)}&select=*`});
    if(existingJobs.length){if(existingJobs[0].status!=='failed'||generationRequest.retry_failed!==true)return json(res,200,{data:existingJobs[0],idempotent:true,requestId},ch);job=existingJobs[0];await systemDb('background_jobs',{method:'PATCH',query:`?id=eq.${job.id}`,body:{status:'retrying',progress:0,attempt_count:0,available_at:new Date().toISOString(),last_error_code:null,failure_class:null,completed_at:null,updated_at:new Date().toISOString()}})}else job=await enqueueBackgroundJob(job);
    await audit(principal,'official_form_pdf_queued','background_job',job.id,{case_id:generate[1],client_id:cases[0].client_id,form_instance_id:instance.id,action_source:'STAFF_ASSISTED'},req);wakeBackgroundWorker();return json(res,202,{data:job,requestId},ch);
  }

  const officeDocument=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})\/office-documents$/i);
  if(officeDocument&&req.method==='POST'){
    const cases=await db('cases',{query:`?id=eq.${officeDocument[1]}&select=*`});if(!cases.length||!canAccessCase(access,cases[0],'cases.prepare'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);const b=await readJson(req,250_000);
    const templates=await db('controlled_document_templates',{query:`?document_type=eq.${encodeURIComponent(b.document_type)}&jurisdiction=eq.${encodeURIComponent(b.jurisdiction)}&language=eq.${encodeURIComponent(b.language||'English')}&active=eq.true&source_review_status=eq.verified&select=*&order=template_version.desc&limit=1`});if(!templates.length)throw Object.assign(new Error('VERIFIED_OFFICE_TEMPLATE_REQUIRED'),{status:409});
    const t=templates[0],rendered=await generateControlledOfficeDocument({documentType:t.document_type,title:cleanText(b.title,{required:true,max:180}),language:t.language,jurisdiction:t.jurisdiction,purpose:t.purpose,sections:t.template_definition.sections||[]}),artifact=await storeGeneratedArtifact({caseId:officeDocument[1],artifactType:'office_document_pdf',authority:'OFFICE',formCode:t.document_type,editionDate:String(t.effective_date||''),mappingVersion:t.template_version,sourceHash:crypto.createHash('sha256').update(JSON.stringify(t.template_definition)).digest('hex'),bytes:rendered.bytes,pdfHash:rendered.sha256,generatedBy:principal.id});
    await audit(principal,'office_document_generated','generated_artifact',artifact.id,{case_id:officeDocument[1],client_id:cases[0].client_id,document_type:t.document_type,official:false,action_source:'STAFF_ASSISTED'},req);return json(res,201,{data:artifact,official:false,requestId},ch);
  }

  const artifactDownload=u.pathname.match(/^\/api\/v1\/artifacts\/([0-9a-f-]{36})\/download-url$/i);
  if(artifactDownload&&req.method==='POST'){
    const rows=await db('generated_artifacts',{query:`?id=eq.${artifactDownload[1]}&select=*`});if(!rows.length)throw Object.assign(new Error('ARTIFACT_NOT_FOUND'),{status:404});const artifact=rows[0],cases=await db('cases',{query:`?id=eq.${artifact.case_id}&select=*`});if(!cases.length||!canAccessCase(access,cases[0],'documents.view'))throw Object.assign(new Error('ARTIFACT_NOT_FOUND'),{status:404});
    const downloadUrl=await getSignedUrl(r2,new GetObjectCommand({Bucket:r2Bucket,Key:artifact.object_key,ResponseContentDisposition:`attachment; filename*=UTF-8''${encodeURIComponent(artifact.form_code+'.pdf')}`,ResponseContentType:'application/pdf'}),{expiresIn:300});return json(res,200,{download_url:downloadUrl,expires_in:300,requestId},ch);
  }

  if(req.method==='POST'&&u.pathname==='/api/v1/ai-review'){
    if(!access.isOwner)throw Object.assign(new Error('OWNER_APPROVAL_REQUIRED'),{status:403});const provider=configuredAiProvider();if(!provider)throw Object.assign(new Error('AI_PROVIDER_NOT_CONFIGURED'),{status:503});
    const b=await readJson(req,64000);if(!uuid(b.case_id))throw Object.assign(new Error('VALID_CASE_ID_REQUIRED'),{status:400});const cases=await db('cases',{query:`?id=eq.${b.case_id}&select=id`});if(!cases.length)throw Object.assign(new Error('CASE_NOT_FOUND'),{status:404});
    const toolNames=Array.isArray(b.tool_names)&&b.tool_names.length?b.tool_names:['get_case_summary','get_participants','get_documents','get_open_findings','get_deadlines'];
    let job=newJob({jobType:'AI_CASE_REVIEW',idempotencyKey:cleanText(b.idempotency_key,{required:true,max:200}),caseId:b.case_id,payload:{workflow:b.workflow||'full_case_review',tool_names:toolNames},requestedBy:principal.id});const existing=await db('background_jobs',{query:`?idempotency_key=eq.${encodeURIComponent(job.idempotency_key)}&select=*`});if(existing.length){if(existing[0].status!=='failed'||b.retry_failed!==true)return json(res,200,{data:existing[0],idempotent:true,requestId},ch);job=existing[0];await systemDb('background_jobs',{method:'PATCH',query:`?id=eq.${job.id}`,body:{status:'retrying',progress:0,attempt_count:0,available_at:new Date().toISOString(),last_error_code:null,failure_class:null,completed_at:null,updated_at:new Date().toISOString()}})}else job=await enqueueBackgroundJob(job);await audit(principal,'ai_review_queued','background_job',job.id,{case_id:b.case_id,provider:provider.name,model_version:provider.model,requires_owner_approval:true},req);wakeBackgroundWorker();return json(res,202,{data:job,requestId},ch);
  }
  const aiFinding=u.pathname.match(/^\/api\/v1\/ai-review\/findings\/([0-9a-f-]{36})$/i);
  if(aiFinding&&req.method==='PATCH'){
    if(!access.isOwner)throw Object.assign(new Error('OWNER_APPROVAL_REQUIRED'),{status:403});const b=await readJson(req,16_384);if(!['accepted','rejected','resolved'].includes(b.resolution))throw Object.assign(new Error('INVALID_AI_FINDING_RESOLUTION'),{status:400});
    const existing=await db('ai_findings',{query:`?id=eq.${aiFinding[1]}&select=*`});if(!existing.length)throw Object.assign(new Error('AI_FINDING_NOT_FOUND'),{status:404});const rows=await db('ai_findings',{method:'PATCH',query:`?id=eq.${aiFinding[1]}`,body:{resolution:b.resolution,resolved_by:principal.id,resolved_at:new Date().toISOString()}});
    await audit(principal,'ai_finding_human_resolved','ai_finding',aiFinding[1],{case_id:existing[0].case_id,resolution:b.resolution,canonical_data_changed:false},req);return json(res,200,{data:rows[0],requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/imports'){const data=await db('import_batches',{query:'?select=*&order=created_at.desc&limit=100'});return json(res,200,{data,requestId},ch);}
  if(req.method==='POST'&&u.pathname==='/api/v1/imports/upload'){
    const filename=cleanText(u.searchParams.get('filename'),{required:true,max:240});const size=Number(u.searchParams.get('size_bytes')||req.headers['content-length']||0);if(!Number.isSafeInteger(size)||size<1||size>25*1024*1024)throw Object.assign(new Error('IMPORT_FILE_SIZE_NOT_ALLOWED'),{status:413});const buffer=await readBuffer(req,25*1024*1024);if(buffer.length!==size)throw Object.assign(new Error('IMPORT_FILE_SIZE_MISMATCH'),{status:409});const fileType=filename.toLowerCase().endsWith('.csv')?'csv':filename.toLowerCase().endsWith('.xlsx')?'xlsx':null;if(!fileType)throw Object.assign(new Error('IMPORT_FILE_TYPE_NOT_SUPPORTED'),{status:415});const checksum=crypto.createHash('sha256').update(buffer).digest('hex');const previous=await db('import_batches',{query:`?file_checksum=eq.${checksum}&uploaded_by=eq.${encodeURIComponent(principal.id)}&select=id,status&limit=1`});if(previous.length)return json(res,409,{error:'IMPORT_FILE_ALREADY_STAGED',data:previous[0],requestId},ch);const parsed=await parseImportFile(buffer,filename);const analyzed=await analyzeStagedRows(parsed.rows,parsed.mapping);const batchId=crypto.randomUUID();const rowRecords=analyzed.map(row=>({id:crypto.randomUUID(),batch_id:batchId,source_row_number:row.source_row_number,source_row:row.source,normalized_row:row.normalized,validation_errors:row.errors,warnings:row.warnings,duplicate_classification:row.duplicate.classification,duplicate_candidates:row.duplicate.case_id?[{case_id:row.duplicate.case_id}]:(row.duplicate.candidates||[]),merge_client_id:row.duplicate.classification==='exact'?row.duplicate.client_id:null,row_status:row.errors.length||row.duplicate.classification==='possible'?'review_required':'valid'}));const summary=importSummary(rowRecords);await db('import_batches',{method:'POST',body:{id:batchId,filename,file_type:fileType,file_checksum:checksum,status:'uploaded',headers:parsed.headers,field_mapping:parsed.mapping,summary,total_rows:rowRecords.length,uploaded_by:principal.id}});for(let index=0;index<rowRecords.length;index+=200)await db('import_rows',{method:'POST',body:rowRecords.slice(index,index+200)});await audit(principal,'import_batch_uploaded','import_batch',batchId,{filename,file_type:fileType,file_checksum:checksum,row_count:rowRecords.length},req);return json(res,201,{data:{id:batchId,filename,file_type:fileType,status:'uploaded',headers:parsed.headers,field_mapping:parsed.mapping,summary,rows:rowRecords.slice(0,100)},requestId},ch);
  }
  const importMatch=u.pathname.match(/^\/api\/v1\/imports\/([0-9a-f-]{36})$/i);if(importMatch&&req.method==='GET'){const data=await loadImportBatch(importMatch[1]);return json(res,200,{data,requestId},ch);}
  const mappingMatch=u.pathname.match(/^\/api\/v1\/imports\/([0-9a-f-]{36})\/mapping$/i);if(mappingMatch&&req.method==='PATCH'){const body=await readJson(req,64_000);const mapping=body.mapping&&typeof body.mapping==='object'&&!Array.isArray(body.mapping)?body.mapping:{};for(const [field,header] of Object.entries(mapping))if(!importFields.includes(field)||typeof header!=='string')throw Object.assign(new Error('INVALID_IMPORT_MAPPING'),{status:400});const current=await loadImportBatch(mappingMatch[1]);const analyzed=await analyzeStagedRows(current.rows.map(row=>({source_row_number:row.source_row_number,source:row.source_row})),mapping);const result=await persistImportAnalysis(mappingMatch[1],analyzed);await db('import_batches',{method:'PATCH',query:`?id=eq.${mappingMatch[1]}`,body:{field_mapping:mapping,status:'mapped',summary:result.summary,updated_at:new Date().toISOString()}});await audit(principal,'import_mapping_updated','import_batch',mappingMatch[1],{mapped_fields:Object.keys(mapping)},req);return json(res,200,{data:{mapping,summary:result.summary,rows:result.rows},requestId},ch);}
  const dryRunMatch=u.pathname.match(/^\/api\/v1\/imports\/([0-9a-f-]{36})\/dry-run$/i);if(dryRunMatch&&req.method==='POST'){const current=await loadImportBatch(dryRunMatch[1]);const analyzed=await analyzeStagedRows(current.rows.map(row=>({source_row_number:row.source_row_number,source:row.source_row})),current.batch.field_mapping);const result=await persistImportAnalysis(dryRunMatch[1],analyzed);const needsReview=result.rows.some(row=>row.row_status==='review_required');await db('import_batches',{method:'PATCH',query:`?id=eq.${dryRunMatch[1]}`,body:{status:needsReview?'review_required':'validated',summary:result.summary,updated_at:new Date().toISOString()}});await audit(principal,'import_dry_run_completed','import_batch',dryRunMatch[1],result.summary,req);return json(res,200,{data:{summary:result.summary,rows:result.rows,canonical_writes:0},requestId},ch);}
  const importRowMatch=u.pathname.match(/^\/api\/v1\/imports\/([0-9a-f-]{36})\/rows\/([0-9a-f-]{36})$/i);if(importRowMatch&&req.method==='PATCH'){const body=await readJson(req,64_000);const current=await loadImportBatch(importRowMatch[1]);const row=current.rows.find(item=>item.id===importRowMatch[2]);if(!row)throw Object.assign(new Error('IMPORT_ROW_NOT_FOUND'),{status:404});const source={...row.source_row,...(body.corrections&&typeof body.corrections==='object'?body.corrections:{})};const analyzed=(await analyzeStagedRows([{source_row_number:row.source_row_number,source}],current.batch.field_mapping))[0];const action=String(body.action||'approve');if(!['approve','skip','merge'].includes(action))throw Object.assign(new Error('INVALID_IMPORT_REVIEW_ACTION'),{status:400});let mergeClientId=null;if(action==='merge'){if(!uuid(body.merge_client_id))throw Object.assign(new Error('VALID_MERGE_CLIENT_REQUIRED'),{status:400});mergeClientId=body.merge_client_id;analyzed.errors=analyzed.errors.filter(error=>error!=='POSSIBLE_DUPLICATE_REQUIRES_REVIEW');}if(body.service_code){const service=serviceCatalog.find(item=>item.code===body.service_code);if(!service)throw Object.assign(new Error('INVALID_SERVICE_MAPPING'),{status:400});Object.assign(analyzed.normalized,{service_code:service.code,service_name:service.name,unmapped_service:null});analyzed.errors=analyzed.errors.filter(error=>error!=='UNMAPPED_SERVICE');}if(body.assigned_user_id!==undefined){if(body.assigned_user_id&&!uuid(body.assigned_user_id))throw Object.assign(new Error('VALID_ASSIGNED_STAFF_REQUIRED'),{status:400});analyzed.normalized.assigned_user_id=body.assigned_user_id||null;analyzed.warnings=analyzed.warnings.filter(warning=>warning!=='ASSIGNED_STAFF_REQUIRES_REVIEW');}const rowStatus=action==='skip'?'skipped':analyzed.errors.length?'review_required':'approved';const data=await db('import_rows',{method:'PATCH',query:`?id=eq.${row.id}`,body:{source_row:source,normalized_row:analyzed.normalized,validation_errors:analyzed.errors,warnings:analyzed.warnings,duplicate_classification:analyzed.duplicate.classification,duplicate_candidates:analyzed.duplicate.case_id?[{case_id:analyzed.duplicate.case_id}]:(analyzed.duplicate.candidates||[]),review_action:action,merge_client_id:mergeClientId||analyzed.duplicate.client_id||null,row_status:rowStatus,reviewed_by:principal.id,reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()}});await audit(principal,'import_row_reviewed','import_batch',importRowMatch[1],{source_row_number:row.source_row_number,action,service_code:analyzed.normalized.service_code},req);return json(res,200,{data:data[0],requestId},ch);}
  const approveMatch=u.pathname.match(/^\/api\/v1\/imports\/([0-9a-f-]{36})\/approve$/i);if(approveMatch&&req.method==='POST'){const current=await loadImportBatch(approveMatch[1]);const unresolved=current.rows.filter(row=>row.row_status!=='skipped'&&(row.validation_errors?.length||row.duplicate_classification==='possible'&&!row.merge_client_id));if(unresolved.length)throw Object.assign(new Error('IMPORT_REVIEW_INCOMPLETE'),{status:409,details:{rows:unresolved.map(row=>row.source_row_number)}});for(const row of current.rows)if(row.row_status!=='skipped')await db('import_rows',{method:'PATCH',query:`?id=eq.${row.id}`,body:{row_status:'approved',review_action:row.review_action||'approve',reviewed_by:row.reviewed_by||principal.id,reviewed_at:row.reviewed_at||new Date().toISOString(),updated_at:new Date().toISOString()}});const data=await db('import_batches',{method:'PATCH',query:`?id=eq.${approveMatch[1]}`,body:{status:'approved',approved_by:principal.id,approved_at:new Date().toISOString(),updated_at:new Date().toISOString()}});await audit(principal,'import_batch_approved','import_batch',approveMatch[1],{row_count:current.rows.length},req);return json(res,200,{data:data[0],requestId},ch);}
  const processMatch=u.pathname.match(/^\/api\/v1\/imports\/([0-9a-f-]{36})\/(process|retry)$/i);if(processMatch&&req.method==='POST'){const current=await loadImportBatch(processMatch[1]);if(!['approved','failed','processing'].includes(current.batch.status))throw Object.assign(new Error('IMPORT_NOT_APPROVED'),{status:409});if(current.batch.status==='failed')await db('import_batches',{method:'PATCH',query:`?id=eq.${processMatch[1]}`,body:{status:'approved',error_code:null,updated_at:new Date().toISOString()}});const key=`bulk-import:${processMatch[1]}`,existing=await db('background_jobs',{query:`?idempotency_key=eq.${encodeURIComponent(key)}&select=*`});let job;if(existing.length){job=existing[0];if(job.status==='failed'&&processMatch[2]==='retry')await systemDb('background_jobs',{method:'PATCH',query:`?id=eq.${job.id}`,body:{status:'retrying',progress:0,attempt_count:0,available_at:new Date().toISOString(),last_error_code:null,failure_class:null,completed_at:null,updated_at:new Date().toISOString()}});else if(!['queued','retrying','running'].includes(job.status))return json(res,200,{data:job,idempotent:true,requestId},ch);}else job=await enqueueBackgroundJob(newJob({jobType:'BULK_IMPORT',idempotencyKey:key,payload:{batch_id:processMatch[1]},requestedBy:principal.id}));wakeBackgroundWorker();return json(res,202,{data:{id:processMatch[1],status:'processing',job_id:job.id},requestId},ch);}
  const reportMatch=u.pathname.match(/^\/api\/v1\/imports\/([0-9a-f-]{36})\/report\.(csv|xlsx)$/i);if(reportMatch&&req.method==='GET'){const current=await loadImportBatch(reportMatch[1]);const buffer=await buildImportReport(current.rows,reportMatch[2]);res.writeHead(200,{...securityHeaders(),'content-type':reportMatch[2]==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/csv; charset=utf-8','content-disposition':`attachment; filename="import-${reportMatch[1]}.${reportMatch[2]}"`,'content-length':buffer.length});return res.end(buffer);}

  if(req.method==='GET'&&u.pathname==='/api/v1/settings/office'){
    const settings=await officeSettings();
    const emailConfigured=Boolean(process.env.RESEND_API_KEY&&process.env.RESEND_FROM_EMAIL);return json(res,200,{data:{...settings,logo_url:settings.logo_object_key?'/brand/logo':null,email_provider_configured:emailConfigured,email_provider_status:emailConfigured?'CONFIGURED':'PROVIDER_NOT_CONFIGURED'},requestId},ch);
  }
  if(req.method==='PATCH'&&u.pathname==='/api/v1/settings/office'){
    const body=await readJson(req,32_768);
    const patch={
      office_name:cleanText(body.office_name,{required:true,max:160}),
      office_email:body.office_email===undefined?null:cleanText(body.office_email,{max:254}),
      office_phone:cleanText(body.office_phone,{max:60}),
      office_whatsapp:cleanText(body.office_whatsapp,{max:60}),
      office_address:cleanText(body.office_address,{max:500}),
      default_language:normalizeLanguage(body.default_language),
      email_footer_en:cleanText(body.email_footer_en,{max:2000}),
      email_footer_ar:cleanText(body.email_footer_ar,{max:2000}),
      updated_by:principal.id,
      updated_at:new Date().toISOString(),
    };
    const data=await db('office_settings',{method:'PATCH',query:'?singleton=eq.true',body:patch});
    await audit(principal,'office_settings_updated','office_settings',null,{default_language:patch.default_language},req);
    return json(res,200,{data:data[0]||patch,requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/settings/logo'){
    if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});
    const contentType=String(req.headers['content-type']||'').split(';')[0].toLowerCase();
    if(!['image/png','image/jpeg','image/webp','image/svg+xml'].includes(contentType))throw Object.assign(new Error('UNSUPPORTED_LOGO_TYPE'),{status:415});
    const logo=await readBuffer(req,2*1024*1024);if(!logo.length)throw Object.assign(new Error('LOGO_REQUIRED'),{status:400});
    const extension=contentType==='image/svg+xml'?'svg':contentType.split('/')[1].replace('jpeg','jpg');
    const objectKey=`branding/office-logo-${crypto.randomUUID()}.${extension}`;
    const existing=await officeSettings();
    await r2.send(new PutObjectCommand({Bucket:r2Bucket,Key:objectKey,Body:logo,ContentType:contentType,ContentLength:logo.length,Metadata:{asset:'office-logo'}}));
    try{
      await db('office_settings',{method:'PATCH',query:'?singleton=eq.true',body:{logo_object_key:objectKey,updated_by:principal.id,updated_at:new Date().toISOString()}});
      if(existing.logo_object_key)await r2.send(new DeleteObjectCommand({Bucket:r2Bucket,Key:existing.logo_object_key})).catch(()=>{});
    }catch(error){await r2.send(new DeleteObjectCommand({Bucket:r2Bucket,Key:objectKey})).catch(()=>{});throw error}
    await audit(principal,'office_logo_updated','office_settings',null,{object_key:objectKey},req);
    return json(res,200,{data:{logo_url:'/brand/logo'},requestId},ch);
  }
  if(req.method==='GET'&&u.pathname==='/api/v1/search'){
    const term=String(u.searchParams.get('q')||'').trim().replace(/[^a-zA-Z0-9\u0600-\u06ff@.+_\-\s]/g,'').slice(0,120);
    if(term.length<2)return json(res,200,{data:{clients:[],cases:[],documents:[],participants:[]},requestId},ch);
    const pattern=`*${encodeURIComponent(term)}*`;
    const [clientRows,caseRows,documentRows,participantRows]=await Promise.all([
      hasEffectivePermission(access,'clients.view')?db('clients',{query:`?archived_at=is.null&or=(client_number.ilike.${pattern},legal_name.ilike.${pattern},legal_name_ar.ilike.${pattern},passport_number.ilike.${pattern},a_number.ilike.${pattern},uscis_account_number.ilike.${pattern},phone.ilike.${pattern},whatsapp.ilike.${pattern},email.ilike.${pattern})&select=id,client_number,legal_name,legal_name_ar,email,phone,a_number,uscis_account_number,passport_number,preferred_language&limit=50`}):Promise.resolve([]),
      db('cases',{query:`?archived_at=is.null&or=(case_number.ilike.${pattern},case_reference.ilike.${pattern},client_name.ilike.${pattern},receipt_number.ilike.${pattern},case_type.ilike.${pattern})&select=*&limit=50`}),
      hasEffectivePermission(access,'documents.view')?db('documents',{query:`?archived_at=is.null&or=(file_name.ilike.${pattern},category.ilike.${pattern})&select=id,case_id,client_id,person_id,file_name,category,content_type,review_status,version,created_at&limit=50`}):Promise.resolve([]),
      db('people',{query:`?archived_at=is.null&or=(legal_name.ilike.${pattern},legal_name_ar.ilike.${pattern},passport_number.ilike.${pattern},a_number.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern})&select=id,legal_name,legal_name_ar,passport_number,a_number,email,phone&limit=50`}),
    ]);
    const reachableClientIds=hasEffectivePermission(access,'clients.view')?await accessibleClientIds(access,'clients.view'):new Set();
    const visibleClients=reachableClientIds?(clientRows||[]).filter(client=>canAccessClient(access,client,'clients.view',{reachableClientIds})):clientRows||[];
    const visibleCases=filterAccessibleCases(access,caseRows||[],'cases.view');
    const documentCases=await casesById(access,(documentRows||[]).map(row=>row.case_id));
    const visibleDocuments=(documentRows||[]).filter(row=>canAccessDocument(access,row,documentCases.get(String(row.case_id)),'documents.view'));
    let visibleParticipants=[];
    if(participantRows.length){
      const links=await db('case_people',{query:`?person_id=in.(${participantRows.map(row=>encodeURIComponent(row.id)).join(',')})&select=case_id,person_id,case_role`});
      const participantCases=await casesById(access,links.map(link=>link.case_id));
      visibleParticipants=links.filter(link=>canAccessCase(access,participantCases.get(String(link.case_id)),'cases.view')).map(link=>({...participantRows.find(row=>String(row.id)===String(link.person_id)),case_id:link.case_id,case_role:link.case_role}));
    }
    return json(res,200,{data:{clients:visibleClients,cases:visibleCases,documents:visibleDocuments,participants:visibleParticipants},requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/dashboard/operations'){
    const [allCases,allTasks,allDeadlines,allDocuments,allRequests,allAppointments,allAlerts,allAssignments,allUsers]=await Promise.all([
      db('cases',{query:'?archived_at=is.null&select=*&order=updated_at.desc&limit=1000'}),
      hasEffectivePermission(access,'tasks.view')?db('tasks',{query:'?archived_at=is.null&select=*&limit=1000'}):Promise.resolve([]),
      hasEffectivePermission(access,'tasks.view')?db('deadlines',{query:'?status=eq.open&select=*&limit=1000'}):Promise.resolve([]),
      hasEffectivePermission(access,'documents.view')?db('documents',{query:'?archived_at=is.null&select=*&limit=1000'}):Promise.resolve([]),
      hasEffectivePermission(access,'documents.view')?db('document_requests',{query:'?select=*&limit=1000'}):Promise.resolve([]),
      db('appointments',{query:'?select=*&limit=1000'}),
      db('alerts',{query:'?status=in.(open,acknowledged)&select=*&limit=1000'}),
      db('case_assignments',{query:'?active=eq.true&select=*&limit=1000'}),
      optionalDb('app_users',{query:'?status=eq.active&select=auth_user_id,display_name,email&limit=1000'}),
    ]);
    const cases=filterAccessibleCases(access,allCases||[],'cases.view'),caseIds=new Set(cases.map(row=>String(row.id))),dashboardClientIds=new Set(cases.map(row=>String(row.client_id)).filter(Boolean));
    const tasks=(allTasks||[]).filter(row=>caseIds.has(String(row.case_id))&&canAccessCase(access,cases.find(item=>String(item.id)===String(row.case_id)),'tasks.view'));
    const deadlines=(allDeadlines||[]).filter(row=>caseIds.has(String(row.case_id))&&canAccessCase(access,cases.find(item=>String(item.id)===String(row.case_id)),'tasks.view'));
    const documents=(allDocuments||[]).filter(row=>caseIds.has(String(row.case_id))&&canAccessDocument(access,row,cases.find(item=>String(item.id)===String(row.case_id)),'documents.view'));
    const requests=(allRequests||[]).filter(row=>caseIds.has(String(row.case_id)));
    const appointments=(allAppointments||[]).filter(row=>caseIds.has(String(row.case_id)));
    const alerts=(allAlerts||[]).filter(row=>row.case_id?caseIds.has(String(row.case_id)):row.client_id?dashboardClientIds.has(String(row.client_id)):principal.roles?.includes('owner'));
    const assignments=(allAssignments||[]).filter(row=>caseIds.has(String(row.case_id)));
    const today=new Date().toISOString().slice(0,10),stages={},documentHealth={approved:0,pending_review:0,rejected:0,unclassified:0,expiring:0};
    for(const row of cases){const key=row.workflow_stage||row.status||'intake';stages[key]=(stages[key]||0)+1}
    for(const row of documents){if(!row.category)documentHealth.unclassified++;if(row.review_status==='approved')documentHealth.approved++;else if(row.review_status==='rejected')documentHealth.rejected++;else documentHealth.pending_review++;if(row.expires_on&&row.expires_on<=new Date(Date.now()+90*86400000).toISOString().slice(0,10))documentHealth.expiring++}
    const attention=[
      ...alerts.map(row=>({type:'alert',id:row.id,case_id:row.case_id,title:row.title,severity:row.severity,due_at:row.due_at})),
      ...tasks.filter(row=>row.due_date&&row.due_date<today&&!['completed','cancelled'].includes(row.status)).map(row=>({type:'task',id:row.id,case_id:row.case_id,title:row.title,severity:'high',due_at:row.due_date})),
      ...documents.filter(row=>row.review_status==='rejected'||!row.category).map(row=>({type:'document',id:row.id,case_id:row.case_id,title:row.file_name,severity:row.review_status==='rejected'?'high':'normal'})),
    ].slice(0,50);
    const workload=[...new Set(assignments.map(row=>String(row.auth_user_id)))].map(userId=>{const assignedCaseIds=new Set(assignments.filter(row=>String(row.auth_user_id)===userId).map(row=>String(row.case_id)));const user=allUsers.find(row=>String(row.auth_user_id)===userId);return{auth_user_id:userId,display_name:user?.display_name||user?.email||userId,active_cases:assignedCaseIds.size,open_tasks:tasks.filter(row=>assignedCaseIds.has(String(row.case_id))&&!['completed','cancelled'].includes(row.status)).length,overdue_tasks:tasks.filter(row=>assignedCaseIds.has(String(row.case_id))&&row.due_date&&row.due_date<today&&!['completed','cancelled'].includes(row.status)).length}}).sort((a,b)=>b.active_cases-a.active_cases);
    const ownerSignals=principal.roles?.includes('owner')||hasEffectivePermission(access,'access.manage')?{unassigned_cases:cases.filter(row=>!assignments.some(link=>String(link.case_id)===String(row.id))).length,overdue_tasks:tasks.filter(row=>row.due_date&&row.due_date<today&&!['completed','cancelled'].includes(row.status)).length,failed_communications:(await db('outbound_communications',{query:'?status=eq.failed&select=id&limit=1000'})).length,open_alerts:alerts.length}:null;
    return json(res,200,{data:{metrics:{active_cases:cases.filter(row=>!['closed','archived'].includes(row.workflow_stage||row.status)).length,intake:cases.filter(row=>(row.workflow_stage||row.status)==='intake').length,awaiting_documents:cases.filter(row=>(row.workflow_stage||row.status)==='awaiting_documents').length,ready_to_file:cases.filter(row=>(row.workflow_stage||row.status)==='ready_to_file').length,filed_receipted:cases.filter(row=>['filed','receipt_received'].includes(row.workflow_stage||row.status)).length,overdue_tasks:tasks.filter(row=>row.due_date&&row.due_date<today&&!['completed','cancelled'].includes(row.status)).length,upcoming_deadlines:deadlines.filter(row=>row.deadline_date>=today).length,upcoming_appointments:appointments.filter(row=>String(row.starts_at||'').slice(0,10)>=today).length,missing_documents:requests.filter(row=>row.status==='missing').length},workflow_distribution:stages,document_health:documentHealth,attention,workload,owner_signals:ownerSignals,drilldown:{case_ids:cases.map(row=>row.id),attention_case_ids:[...new Set(attention.map(row=>row.case_id).filter(Boolean))]}},requestId},ch);
  }

  const clientFileMatch=u.pathname.match(/^\/api\/v1\/clients\/([0-9a-f-]{36})\/file$/i);
  if(clientFileMatch&&req.method==='GET'){
    const clientId=clientFileMatch[1],clientRows=await db('clients',{query:`?id=eq.${encodeURIComponent(clientId)}&archived_at=is.null&select=*&limit=1`});
    const reachableClientIds=await accessibleClientIds(access,'clients.view');
    if(!clientRows.length||!canAccessClient(access,clientRows[0],'clients.view',{reachableClientIds}))return json(res,404,{error:'CLIENT_NOT_FOUND',requestId},ch);
    const allCases=await db('cases',{query:`?client_id=eq.${encodeURIComponent(clientId)}&archived_at=is.null&select=*&order=updated_at.desc`}),cases=filterAccessibleCases(access,allCases,'cases.view'),caseIds=cases.map(row=>row.id),caseFilter=caseIds.length?`in.(${caseIds.map(encodeURIComponent).join(',')})`:null;
    const [documents,requests,tasks,deadlines,appointments,communications,events,people]=await Promise.all([
      caseFilter&&hasEffectivePermission(access,'documents.view')?db('documents',{query:`?case_id=${caseFilter}&archived_at=is.null&select=*&order=created_at.desc`}):Promise.resolve([]),
      caseFilter&&hasEffectivePermission(access,'documents.view')?db('document_requests',{query:`?case_id=${caseFilter}&select=*&order=created_at.desc`}):Promise.resolve([]),
      caseFilter&&hasEffectivePermission(access,'tasks.view')?db('tasks',{query:`?case_id=${caseFilter}&archived_at=is.null&select=*&order=due_date.asc.nullslast`}):Promise.resolve([]),
      caseFilter&&hasEffectivePermission(access,'tasks.view')?db('deadlines',{query:`?case_id=${caseFilter}&select=*&order=deadline_date.asc`}):Promise.resolve([]),
      caseFilter?db('appointments',{query:`?case_id=${caseFilter}&select=*&order=starts_at.asc`}):Promise.resolve([]),
      caseFilter&&hasEffectivePermission(access,'cases.manage')?db('outbound_communications',{query:`?case_id=${caseFilter}&select=id,case_id,client_id,channel,recipient,language,subject,status,provider,failure_code,sent_at,delivered_at,created_at&order=created_at.desc`}):Promise.resolve([]),
      caseFilter?db('case_events',{query:`?case_id=${caseFilter}&select=*&order=created_at.desc&limit=500`}):Promise.resolve([]),
      caseFilter?db('case_people',{query:`?case_id=${caseFilter}&select=case_id,person_id,case_role,created_at,people(*)&order=created_at`}):Promise.resolve([]),
    ]);
    return json(res,200,{data:{client:clientRows[0],cases,documents,document_requests:requests,tasks,deadlines,appointments,communications,timeline:events,participants:people},requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/communications/internal'){
    const caseId=u.searchParams.get('case_id');if(!uuid(caseId))throw Object.assign(new Error('VALID_CASE_ID_REQUIRED'),{status:400});
    const caseRows=await db('cases',{query:`?id=eq.${encodeURIComponent(caseId)}&select=*&limit=1`});if(!caseRows.length||!canAccessCase(access,caseRows[0],'cases.view'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
    const [messages,metadata,users]=await Promise.all([db('case_messages',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=*&order=created_at.asc`}),db('case_events',{query:`?case_id=eq.${encodeURIComponent(caseId)}&event_type=eq.internal_message_sent&select=*&order=created_at.asc`}),optionalDb('app_users',{query:'?select=auth_user_id,display_name,email&limit=1000'})]);
    const metaByMessage=new Map(metadata.map(row=>[String(row.payload?.message_id||''),row.payload||{}]));
    return json(res,200,{data:messages.map(row=>{const meta=metaByMessage.get(String(row.id))||{},sender=users.find(user=>String(user.auth_user_id)===String(row.sender_user_id));return{...row,sender_name:sender?.display_name||sender?.email||row.sender_type,recipient_user_ids:meta.recipient_user_ids||[],mention_user_ids:meta.mention_user_ids||[],document_ids:meta.document_ids||[],client_id:caseRows[0].client_id}}),requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/communications/internal'){
    const body=await readJson(req,65_536);if(!uuid(body.case_id))throw Object.assign(new Error('VALID_CASE_ID_REQUIRED'),{status:400});
    const caseRows=await db('cases',{query:`?id=eq.${encodeURIComponent(body.case_id)}&select=*&limit=1`});if(!caseRows.length||!canAccessCase(access,caseRows[0],'cases.manage'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
    const recipientIds=[...new Set((Array.isArray(body.recipient_user_ids)?body.recipient_user_ids:[]).map(String))],mentionIds=[...new Set((Array.isArray(body.mention_user_ids)?body.mention_user_ids:[]).map(String))],documentIds=[...new Set((Array.isArray(body.document_ids)?body.document_ids:[]).map(String))];
    if(!recipientIds.length||recipientIds.some(id=>!uuid(id))||mentionIds.some(id=>!uuid(id))||documentIds.some(id=>!uuid(id)))throw Object.assign(new Error('VALID_MESSAGE_LINKS_REQUIRED'),{status:400});
    const recipients=await db('app_users',{query:`?auth_user_id=in.(${[...new Set([...recipientIds,...mentionIds])].map(encodeURIComponent).join(',')})&status=eq.active&select=auth_user_id`});if(recipients.length!==new Set([...recipientIds,...mentionIds]).size)throw Object.assign(new Error('MESSAGE_RECIPIENT_NOT_FOUND'),{status:409});
    if(documentIds.length){const docs=await db('documents',{query:`?id=in.(${documentIds.map(encodeURIComponent).join(',')})&case_id=eq.${encodeURIComponent(body.case_id)}&archived_at=is.null&select=id,case_id`});if(docs.length!==documentIds.length)throw Object.assign(new Error('MESSAGE_DOCUMENT_NOT_IN_CASE'),{status:409})}
    const record={id:crypto.randomUUID(),case_id:body.case_id,sender_user_id:principal.id,sender_type:'staff',body:cleanText(body.body,{required:true,max:10000})};const rows=await db('case_messages',{method:'POST',body:record});
    const payload={message_id:record.id,case_id:body.case_id,client_id:caseRows[0].client_id,recipient_user_ids:recipientIds,mention_user_ids:mentionIds,document_ids:documentIds};await event(body.case_id,'internal_message_sent',payload,principal,req);
    return json(res,201,{data:{...(rows[0]||record),...payload,sender_name:principal.displayName},requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/communications/center'){
    const [messages,outbound,events,cases,clients,users]=await Promise.all([db('case_messages',{query:'?select=*&order=created_at.desc&limit=500'}),db('outbound_communications',{query:'?select=id,client_id,case_id,channel,recipient,language,subject,status,provider,failure_code,sent_at,delivered_at,created_at&order=created_at.desc&limit=500'}),db('case_events',{query:'?event_type=eq.internal_message_sent&select=*&order=created_at.desc&limit=500'}),db('cases',{query:'?select=id,case_number,case_reference,client_id,client_name&limit=1000'}),db('clients',{query:'?select=id,client_number,legal_name,legal_name_ar&limit=1000'}),optionalDb('app_users',{query:'?select=auth_user_id,display_name,email&limit=1000'})]);
    const metaByMessage=new Map(events.map(row=>[String(row.payload?.message_id||''),row.payload||{}])),caseById=new Map(cases.map(row=>[String(row.id),row])),clientById=new Map(clients.map(row=>[String(row.id),row]));
    const internal=messages.map(row=>{const currentCase=caseById.get(String(row.case_id)),client=clientById.get(String(currentCase?.client_id)),sender=users.find(user=>String(user.auth_user_id)===String(row.sender_user_id));return{kind:'internal',...row,...(metaByMessage.get(String(row.id))||{}),sender_name:sender?.display_name||sender?.email||row.sender_type,case_number:currentCase?.case_number||currentCase?.case_reference,client_number:client?.client_number,client_name:client?.legal_name||currentCase?.client_name}});
    const external=outbound.map(row=>{const currentCase=caseById.get(String(row.case_id)),client=clientById.get(String(row.client_id||currentCase?.client_id));return{kind:'external',...row,case_number:currentCase?.case_number||currentCase?.case_reference,client_number:client?.client_number,client_name:client?.legal_name||currentCase?.client_name}});
    const kind=u.searchParams.get('kind'),status=u.searchParams.get('status'),q=String(u.searchParams.get('q')||'').trim().toLowerCase();let data=[...internal,...external].filter(row=>(!kind||row.kind===kind)&&(!status||row.status===status)&&(!q||JSON.stringify(row).toLowerCase().includes(q))).sort((a,b)=>String(b.created_at||b.sent_at||'').localeCompare(String(a.created_at||a.sent_at||'')));
    return json(res,200,{data:data.slice(0,500),adapters:{email:process.env.RESEND_API_KEY?'configured':'provider_not_configured',whatsapp:'provider_not_configured'},requestId},ch);
  }

  if(req.method==='PATCH'&&u.pathname==='/api/v1/portal/language'){
    const body=await readJson(req,8_192);const language=normalizeLanguage(body.preferred_language);
    const links=await db('client_access',{query:`?auth_user_id=eq.${encodeURIComponent(principal.id)}&status=eq.active&select=client_id`});
    for(const link of links)await db('clients',{method:'PATCH',query:`?id=eq.${encodeURIComponent(link.client_id)}`,body:{preferred_language:language,updated_by:principal.id,updated_at:new Date().toISOString()}});
    await db('app_users',{method:'PATCH',query:`?auth_user_id=eq.${encodeURIComponent(principal.id)}`,body:{preferred_language:language,updated_at:new Date().toISOString()}});
    await audit(principal,'client_language_updated','client',links[0]?.client_id||null,{client_ids:links.map(link=>link.client_id),preferred_language:language},req);
    return json(res,200,{data:{preferred_language:language},requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/portal'){
    const access=principal.permissions.has('*')?[]:await db('client_access',{query:`?auth_user_id=eq.${encodeURIComponent(principal.id)}&status=eq.active&select=client_id,access_role`});
    const direct=principal.permissions.has('*')?[]:await db('portal_case_access',{query:`?auth_user_id=eq.${encodeURIComponent(principal.id)}&status=eq.active&select=case_id,portal_type,person_id`});
    const linkedClientIds=[...new Set(access.map(item=>item.client_id))];
    if(!principal.permissions.has('*')&&!linkedClientIds.length&&!direct.length)return json(res,200,{data:{clients:[],cases:[],document_requests:[],appointments:[],deadlines:[],documents:[],billing:[],notifications:[],portal_contexts:[],participants:[]},requestId},ch);
    const caseSelect='id,client_id,case_number,case_reference,case_type,service_code,workflow_stage,agency,receipt_number,opened_on,updated_at';
    const clientCases=principal.permissions.has('*')?await db('cases',{query:`?select=${caseSelect}&archived_at=is.null&order=updated_at.desc`}):linkedClientIds.length?await db('cases',{query:`?select=${caseSelect}&archived_at=is.null&client_id=in.(${linkedClientIds.map(encodeURIComponent).join(',')})&order=updated_at.desc`}):[];
    const directCases=direct.length?await db('cases',{query:`?select=${caseSelect}&archived_at=is.null&id=in.(${direct.map(item=>encodeURIComponent(item.case_id)).join(',')})&order=updated_at.desc`}):[];
    const caseRows=[...new Map([...clientCases,...directCases].map(item=>[item.id,item])).values()].sort((a,b)=>String(b.updated_at||'').localeCompare(String(a.updated_at||'')));
    const clientIds=principal.permissions.has('*')?[...new Set(caseRows.map(item=>item.client_id).filter(Boolean))]:linkedClientIds;
    const clients=clientIds.length?await db('clients',{query:`?select=id,client_number,legal_name,legal_name_ar,preferred_language,email,phone&archived_at=is.null&id=in.(${clientIds.map(encodeURIComponent).join(',')})`}):[];
    const personIds=[...new Set(direct.map(item=>item.person_id).filter(Boolean))];
    const participants=personIds.length?await db('people',{query:`?id=in.(${personIds.map(encodeURIComponent).join(',')})&select=id,legal_name,legal_name_ar,preferred_language,email,phone`}):[];
    const caseIds=caseRows.map(item=>item.id);
    const directCaseIds=[...new Set(direct.map(item=>item.case_id))];
    const encodedCases=caseIds.map(encodeURIComponent).join(',');
    const encodedClients=clientIds.map(encodeURIComponent).join(',');
    const encodedDirectCases=directCaseIds.map(encodeURIComponent).join(',');
    const [documentRequests,clientAppointments,directAppointments,deadlines,documents,clientBilling,directBilling,clientNotifications,directNotifications]=await Promise.all([
      caseIds.length?db('document_requests',{query:`?case_id=in.(${encodedCases})&select=id,case_id,person_id,category,title,instructions,required,due_date,status,reviewer_notes,updated_at&order=created_at.desc`}):Promise.resolve([]),
      clientIds.length?db('appointments',{query:`?client_id=in.(${encodedClients})&client_visible=eq.true&select=id,case_id,client_id,title,appointment_type,starts_at,ends_at,location,status&order=starts_at.asc`}):Promise.resolve([]),
      directCaseIds.length?db('appointments',{query:`?case_id=in.(${encodedDirectCases})&client_visible=eq.true&select=id,case_id,client_id,title,appointment_type,starts_at,ends_at,location,status&order=starts_at.asc`}):Promise.resolve([]),
      caseIds.length?db('deadlines',{query:`?case_id=in.(${encodedCases})&client_visible=eq.true&select=id,case_id,title,deadline_date,deadline_type,status&order=deadline_date.asc`}):Promise.resolve([]),
      caseIds.length?db('documents',{query:`?case_id=in.(${encodedCases})&request_id=not.is.null&archived_at=is.null&select=id,case_id,request_id,file_name,content_type,size_bytes,category,review_status,created_at&order=created_at.desc`}):Promise.resolve([]),
      clientIds.length?db('invoices',{query:`?client_id=in.(${encodedClients})&client_visible=eq.true&status=in.(issued,partially_paid,paid,overdue)&select=id,invoice_number,client_id,case_id,currency,status,office_fee_cents,government_fee_cents,other_fee_cents,due_date,issued_at&order=created_at.desc`}):Promise.resolve([]),
      directCaseIds.length?db('invoices',{query:`?case_id=in.(${encodedDirectCases})&client_visible=eq.true&status=in.(issued,partially_paid,paid,overdue)&select=id,invoice_number,client_id,case_id,currency,status,office_fee_cents,government_fee_cents,other_fee_cents,due_date,issued_at&order=created_at.desc`}):Promise.resolve([]),
      clientIds.length?db('alerts',{query:`?client_id=in.(${encodedClients})&client_visible=eq.true&status=in.(open,acknowledged)&select=id,client_id,case_id,alert_type,severity,title,due_at,status,created_at&order=created_at.desc`}):Promise.resolve([]),
      directCaseIds.length?db('alerts',{query:`?case_id=in.(${encodedDirectCases})&client_visible=eq.true&status=in.(open,acknowledged)&select=id,client_id,case_id,alert_type,severity,title,due_at,status,created_at&order=created_at.desc`}):Promise.resolve([]),
    ]);
    const mergeRows=(...groups)=>[...new Map(groups.flat().map(item=>[item.id,item])).values()];
    const appointments=mergeRows(clientAppointments,directAppointments),billing=mergeRows(clientBilling,directBilling),notifications=mergeRows(clientNotifications,directNotifications);
    return json(res,200,{data:{clients,cases:caseRows,document_requests:documentRequests,appointments,deadlines,documents,billing,notifications,portal_contexts:direct,participants},requestId},ch);
  }

  const portalCaseMatch=u.pathname.match(/^\/api\/v1\/portal\/cases\/([0-9a-f-]{36})$/i);
  if(portalCaseMatch&&req.method==='GET'){
    const currentCase=await portalCase(principal,portalCaseMatch[1]);
    const [requests,appointments,messages,updates,deadlines,documents,invoices,notifications,communications]=await Promise.all([
      db('document_requests',{query:`?case_id=eq.${encodeURIComponent(currentCase.id)}&select=id,person_id,category,title,instructions,required,due_date,status,reviewer_notes,updated_at&order=created_at.desc`}),
      db('appointments',{query:`?case_id=eq.${encodeURIComponent(currentCase.id)}&client_visible=eq.true&select=id,title,appointment_type,starts_at,ends_at,location,status&order=starts_at.asc`}),
      db('case_messages',{query:`?case_id=eq.${encodeURIComponent(currentCase.id)}&select=id,sender_type,body,created_at,edited_at&order=created_at.asc`}),
      db('case_notes',{query:`?case_id=eq.${encodeURIComponent(currentCase.id)}&visibility=eq.client&select=id,body,created_at,updated_at&order=created_at.desc`}),
      db('deadlines',{query:`?case_id=eq.${encodeURIComponent(currentCase.id)}&client_visible=eq.true&select=id,title,deadline_date,deadline_type,status&order=deadline_date.asc`}),
      db('documents',{query:`?case_id=eq.${encodeURIComponent(currentCase.id)}&request_id=not.is.null&archived_at=is.null&select=id,request_id,file_name,content_type,size_bytes,category,review_status,created_at&order=created_at.desc`}),
      db('invoices',{query:`?case_id=eq.${encodeURIComponent(currentCase.id)}&client_visible=eq.true&status=in.(issued,partially_paid,paid,overdue)&select=id,invoice_number,currency,status,office_fee_cents,government_fee_cents,other_fee_cents,due_date,issued_at&order=created_at.desc`}),
      db('alerts',{query:`?case_id=eq.${encodeURIComponent(currentCase.id)}&client_visible=eq.true&status=in.(open,acknowledged)&select=id,alert_type,severity,title,due_at,status,created_at&order=created_at.desc`}),
      db('outbound_communications',{query:`?case_id=eq.${encodeURIComponent(currentCase.id)}&status=in.(sent,delivered)&select=id,language,subject,body_text,status,sent_at,delivered_at,created_at&order=created_at.desc`}),
    ]);
    const safeCase={id:currentCase.id,client_id:currentCase.client_id,case_number:currentCase.case_number,case_reference:currentCase.case_reference,case_type:currentCase.case_type,service_code:currentCase.service_code,workflow_stage:currentCase.workflow_stage,agency:currentCase.agency,receipt_number:currentCase.receipt_number,opened_on:currentCase.opened_on,updated_at:currentCase.updated_at};
    return json(res,200,{data:{case:safeCase,document_requests:requests,appointments,messages,updates,deadlines,documents,invoices,notifications,approved_communications:communications},requestId},ch);
  }

  const portalDocumentMatch=u.pathname.match(/^\/api\/v1\/portal\/documents\/([0-9a-f-]{36})\/url$/i);
  if(portalDocumentMatch&&req.method==='GET'){
    const rows=await db('documents',{query:`?id=eq.${encodeURIComponent(portalDocumentMatch[1])}&request_id=not.is.null&archived_at=is.null&select=id,case_id,client_id,object_key,file_name,content_type&limit=1`});
    if(!rows.length)return json(res,404,{error:'DOCUMENT_NOT_FOUND',requestId},ch);
    const currentCase=await portalCase(principal,rows[0].case_id);
    if(rows[0].client_id&&rows[0].client_id!==currentCase.client_id)return json(res,404,{error:'DOCUMENT_NOT_FOUND',requestId},ch);
    const signedUrl=await getSignedUrl(r2,new GetObjectCommand({Bucket:r2Bucket,Key:rows[0].object_key,ResponseContentDisposition:`inline; filename="${String(rows[0].file_name||'document').replace(/["\r\n]/g,'_')}"`,ResponseContentType:rows[0].content_type}),{expiresIn:300});
    await audit(principal,'portal_document_viewed','document',rows[0].id,{case_id:currentCase.id,client_id:currentCase.client_id},req);
    return json(res,200,{data:{url:signedUrl,expires_in:300},requestId},ch);
  }

  const portalMessagesMatch=u.pathname.match(/^\/api\/v1\/portal\/messages\/([0-9a-f-]{36})$/i);
  if(portalMessagesMatch&&req.method==='POST'){
    const currentCase=await portalCase(principal,portalMessagesMatch[1]);
    const body=await readJson(req,32_768);
    const record={id:crypto.randomUUID(),case_id:currentCase.id,sender_user_id:principal.id,sender_type:principal.roles.some(role=>role.startsWith('client_')||role.endsWith('_portal'))?'client':'staff',body:cleanText(body.body,{required:true,max:5000})};
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
    const definitions=await systemDb('intake_definitions',{query:`?id=eq.${definitionId}&select=id`});
    if(!definitions.length)await systemDb('intake_definitions',{method:'POST',body:{id:definitionId,service_code:serviceCode,version:definition.version,definition,active:true,published_at:new Date().toISOString(),created_by:principal.id}});
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
    const verified=await verifiedStoredDocument(key,input,body.content_checksum);
    const duplicates=await db('documents',{query:`?case_id=eq.${encodeURIComponent(input.caseId)}&content_checksum=eq.${verified.checksum}&archived_at=is.null&select=id`});if(duplicates.length){await r2.send(new DeleteObjectCommand({Bucket:r2Bucket,Key:key}));throw Object.assign(new Error('DUPLICATE_DOCUMENT'),{status:409});}
    const record={id:crypto.randomUUID(),case_id:input.caseId,client_id:currentCase.client_id,person_id:body.person_id||null,request_id:body.request_id||null,object_key:key,file_name:input.fileName,content_type:input.contentType,size_bytes:input.sizeBytes,content_checksum:verified.checksum,object_etag:verified.etag,status:'uploaded',category:cleanText(body.category,{max:100}),review_status:'received',uploaded_by:principal.id};
    // Committing byte metadata is an explicit trusted operation: ordinary JWT
    // roles cannot attest to R2 contents. Ownership and version invariants are
    // still enforced by the database trigger for service-role calls.
    const data=await systemDb('documents',{method:'POST',body:record});
    // This workflow transition is trusted only after the user-scoped document
    // insert and the verified R2 object; clients have no direct request UPDATE.
    if(record.request_id)await systemDb('document_requests',{method:'PATCH',query:`?id=eq.${encodeURIComponent(record.request_id)}`,body:{status:'received',updated_at:new Date().toISOString()}});
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
    const visibleCases=filterAccessibleCases(access,caseReviews||[],'cases.view'),reviewCases=await casesById(access,(documentReviews||[]).map(row=>row.case_id));
    return json(res,200,{data:{cases:visibleCases,documents:(documentReviews||[]).filter(row=>canAccessDocument(access,row,reviewCases.get(String(row.case_id)),'documents.review'))},requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/alerts'){
    const status=u.searchParams.get('status')||'open';
    if(!['open','acknowledged','resolved','dismissed'].includes(status))throw Object.assign(new Error('INVALID_ALERT_STATUS'),{status:400});
    const data=await db('alerts',{query:`?status=eq.${status}&select=*&order=due_at.asc.nullslast,created_at.desc&limit=250`}),alertCases=await casesById(access,(data||[]).map(row=>row.case_id).filter(Boolean)),reachableClientIds=await accessibleClientIds(access,'clients.view');
    const visible=(data||[]).filter(row=>row.case_id?canAccessCase(access,alertCases.get(String(row.case_id)),'cases.view'):row.client_id?canAccessClient(access,{id:row.client_id},'clients.view',{reachableClientIds}):principal.roles?.includes('owner'));
    return json(res,200,{data:visible,requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/alerts/refresh'){
    const [taskRows,deadlineRows,clientRows]=await Promise.all([db('tasks',{query:'?archived_at=is.null&select=id,case_id,client_id,title,due_date,status'}),db('deadlines',{query:'?status=eq.open&select=id,case_id,title,deadline_date'}),db('clients',{query:'?archived_at=is.null&passport_expiration=not.is.null&select=id,legal_name,passport_expiration'})]);
    const [taskCases,deadlineCases,reachableClientIds]=await Promise.all([casesById(access,taskRows.map(row=>row.case_id).filter(Boolean)),casesById(access,deadlineRows.map(row=>row.case_id).filter(Boolean)),accessibleClientIds(access,'clients.view')]);
    const visibleTasks=taskRows.filter(row=>row.case_id?canAccessCase(access,taskCases.get(String(row.case_id)),'tasks.manage'):canAccessClient(access,{id:row.client_id},'clients.view',{reachableClientIds}));
    const visibleDeadlines=deadlineRows.filter(row=>canAccessCase(access,deadlineCases.get(String(row.case_id)),'tasks.manage'));
    const visibleClients=clientRows.filter(row=>canAccessClient(access,row,'clients.view',{reachableClientIds}));
    const today=new Date();today.setUTCHours(0,0,0,0);const horizon=new Date(today);horizon.setUTCDate(horizon.getUTCDate()+180);
    const candidates=[];
    for(const task of visibleTasks)if(task.due_date&& !['completed','cancelled'].includes(task.status)){const due=new Date(task.due_date+'T00:00:00Z');if(due<=horizon)candidates.push({client_id:task.client_id,case_id:task.case_id,alert_type:due<today?'task_overdue':'task_due',severity:due<today?'high':'normal',title:task.title,due_at:due.toISOString(),source_type:'task',source_id:task.id});}
    for(const deadline of visibleDeadlines){const due=new Date(deadline.deadline_date+'T00:00:00Z');if(due<=horizon)candidates.push({case_id:deadline.case_id,alert_type:due<today?'deadline_overdue':'deadline_due',severity:due<today?'critical':'high',title:deadline.title,due_at:due.toISOString(),source_type:'deadline',source_id:deadline.id});}
    for(const client of visibleClients){const due=new Date(client.passport_expiration+'T00:00:00Z');if(due<=horizon)candidates.push({client_id:client.id,alert_type:'passport_expiration',severity:due<today?'high':'normal',title:`Passport expiration — ${client.legal_name}`,due_at:due.toISOString(),source_type:'client_passport',source_id:client.id});}
    let created=0;
    for(const candidate of candidates){const existing=await db('alerts',{query:`?alert_type=eq.${encodeURIComponent(candidate.alert_type)}&source_type=eq.${encodeURIComponent(candidate.source_type)}&source_id=eq.${encodeURIComponent(candidate.source_id)}&status=in.(open,acknowledged)&select=id`});if(!existing.length){await db('alerts',{method:'POST',body:{id:crypto.randomUUID(),...candidate}});created++;}}
    await audit(principal,'alerts_refreshed','alert',null,{candidates:candidates.length,created},req);
    return json(res,200,{data:{candidates:candidates.length,created},requestId},ch);
  }
  const alertMatch=u.pathname.match(/^\/api\/v1\/alerts\/([0-9a-f-]{36})$/i);
  if(alertMatch&&req.method==='PATCH'){
    const body=await readJson(req,8_192);
    if(!['acknowledged','resolved','dismissed'].includes(body.status))throw Object.assign(new Error('INVALID_ALERT_STATUS'),{status:400});
    const existing=await db('alerts',{query:`?id=eq.${encodeURIComponent(alertMatch[1])}&select=*&limit=1`});if(!existing.length)return json(res,404,{error:'ALERT_NOT_FOUND',requestId},ch);if(!await canReachClientRecord(access,existing[0],'tasks.manage'))return json(res,404,{error:'ALERT_NOT_FOUND',requestId},ch);
    const data=await db('alerts',{method:'PATCH',query:`?id=eq.${encodeURIComponent(alertMatch[1])}`,body:{status:body.status,updated_at:new Date().toISOString()}});
    if(!data.length)return json(res,404,{error:'ALERT_NOT_FOUND',requestId},ch);
    await audit(principal,'alert_updated','alert',alertMatch[1],{case_id:data[0].case_id,client_id:data[0].client_id,status:body.status},req);
    return json(res,200,{data:data[0],requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/appointments'){
    const caseId=u.searchParams.get('case_id');
    if(caseId&&!uuid(caseId))throw Object.assign(new Error('INVALID_CASE_ID'),{status:400});
    const data=await db('appointments',{query:`?select=*&order=starts_at.asc&limit=250${caseId?`&case_id=eq.${encodeURIComponent(caseId)}`:''}`}),appointmentCases=await casesById(access,(data||[]).map(row=>row.case_id).filter(Boolean)),reachableClientIds=await accessibleClientIds(access,'clients.view');
    const visible=(data||[]).filter(row=>row.case_id?canAccessCase(access,appointmentCases.get(String(row.case_id)),'cases.view'):canAccessClient(access,{id:row.client_id},'clients.view',{reachableClientIds}));
    return json(res,200,{data:visible,requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/appointments'){
    const body=await readJson(req,32_768);
    if(!uuid(body.client_id)||body.case_id&&!uuid(body.case_id))throw Object.assign(new Error('INVALID_APPOINTMENT_REFERENCE'),{status:400});
    if(body.case_id){const caseRows=await db('cases',{query:`?id=eq.${encodeURIComponent(body.case_id)}&select=*&limit=1`});if(!caseRows.length||String(caseRows[0].client_id)!==String(body.client_id)||!canAccessCase(access,caseRows[0],'cases.manage'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch)}else{const clientRows=await db('clients',{query:`?id=eq.${encodeURIComponent(body.client_id)}&select=*&limit=1`}),reachableClientIds=await accessibleClientIds(access,'clients.manage');if(!clientRows.length||!canAccessClient(access,clientRows[0],'clients.manage',{reachableClientIds}))return json(res,404,{error:'CLIENT_NOT_FOUND',requestId},ch)}
    const startsAt=new Date(body.starts_at);if(Number.isNaN(startsAt.getTime()))throw Object.assign(new Error('INVALID_APPOINTMENT_TIME'),{status:400});
    const endsAt=body.ends_at?new Date(body.ends_at):null;if(endsAt&&(!Number.isFinite(endsAt.getTime())||endsAt<=startsAt))throw Object.assign(new Error('INVALID_APPOINTMENT_TIME'),{status:400});
    const record={id:crypto.randomUUID(),case_id:body.case_id||null,client_id:body.client_id,title:cleanText(body.title,{required:true,max:200}),appointment_type:cleanText(body.appointment_type,{required:true,max:80}),starts_at:startsAt.toISOString(),ends_at:endsAt?.toISOString()||null,location:cleanText(body.location,{max:300}),status:'scheduled',client_visible:body.client_visible!==false,created_by:principal.id};
    const data=await db('appointments',{method:'POST',body:record});
    await audit(principal,'appointment_created','appointment',record.id,{case_id:record.case_id,client_id:record.client_id,starts_at:record.starts_at},req);
    return json(res,201,{data:data[0]||data,requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/billing/invoices'){
    const data=await db('invoices',{query:'?select=*&order=created_at.desc&limit=250'});
    const invoiceCases=await casesById(access,(data||[]).map(row=>row.case_id).filter(Boolean)),reachableClientIds=await accessibleClientIds(access,'clients.view');
    return json(res,200,{data:(data||[]).filter(row=>row.case_id?canAccessCase(access,invoiceCases.get(String(row.case_id)),'billing.view'):canAccessClient(access,{id:row.client_id},'clients.view',{reachableClientIds})),requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/billing/invoices'){
    const body=await readJson(req,32_768);
    if(!uuid(body.client_id)||body.case_id&&!uuid(body.case_id))throw Object.assign(new Error('INVALID_INVOICE_REFERENCE'),{status:400});
    if(body.case_id){const caseRows=await db('cases',{query:`?id=eq.${encodeURIComponent(body.case_id)}&select=*&limit=1`});if(!caseRows.length||String(caseRows[0].client_id)!==String(body.client_id)||!canAccessCase(access,caseRows[0],'billing.manage'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch)}else{const clientRows=await db('clients',{query:`?id=eq.${encodeURIComponent(body.client_id)}&select=*&limit=1`}),reachableClientIds=await accessibleClientIds(access,'clients.manage');if(!clientRows.length||!canAccessClient(access,clientRows[0],'clients.manage',{reachableClientIds}))return json(res,404,{error:'CLIENT_NOT_FOUND',requestId},ch)}
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
    const existing=await db('invoices',{query:`?id=eq.${encodeURIComponent(invoiceMatch[1])}&select=*&limit=1`});if(!existing.length)return json(res,404,{error:'INVOICE_NOT_FOUND',requestId},ch);if(!await canReachClientRecord(access,existing[0],'billing.manage'))return json(res,404,{error:'INVOICE_NOT_FOUND',requestId},ch);
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
    if(!await canReachClientRecord(access,invoices[0],'billing.manage'))return json(res,404,{error:'INVOICE_NOT_FOUND',requestId},ch);
    const receivedAt=body.received_at?new Date(body.received_at):new Date();if(Number.isNaN(receivedAt.getTime()))throw Object.assign(new Error('INVALID_PAYMENT_DATE'),{status:400});
    const record={id:crypto.randomUUID(),invoice_id:body.invoice_id,amount_cents:amount,currency:invoices[0].currency,method:cleanText(body.method,{required:true,max:50}),external_reference:cleanText(body.external_reference,{max:120}),status:'recorded',received_at:receivedAt.toISOString(),created_by:principal.id};
    const data=await db('payments',{method:'POST',body:record});
    await audit(principal,'payment_recorded','payment',record.id,{case_id:invoices[0].case_id,client_id:invoices[0].client_id,invoice_id:record.invoice_id,amount_cents:amount},req);
    return json(res,201,{data:data[0]||data,requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/reports/summary'){
    return json(res,200,{data:await operationalReport(access,u.searchParams),requestId},ch);
  }
  if(req.method==='GET'&&u.pathname==='/api/v1/reports/export.csv'){
    const report=await operationalReport(access,u.searchParams),buffer=reportCsv(report);
    await audit(principal,'operational_report_exported','report',null,{filters:report.filters,case_count:report.cases.total},req);
    res.writeHead(200,{...securityHeaders(),'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="caseflow-operational-report.csv"','content-length':buffer.length});
    return res.end(buffer);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/retention-policies'){const data=await db('retention_policies',{query:'?select=*&order=record_type'});return json(res,200,{data,requestId},ch);}
  if(req.method==='PUT'&&u.pathname==='/api/v1/retention-policies'){
    const body=await readJson(req,16_384);const recordType=cleanText(body.record_type,{required:true,max:80});const days=Number(body.retention_days);if(!Number.isSafeInteger(days)||days<0||days>36500)throw Object.assign(new Error('INVALID_RETENTION_DAYS'),{status:400});if(!['review','archive','delete'].includes(body.action))throw Object.assign(new Error('INVALID_RETENTION_ACTION'),{status:400});
    const existing=await db('retention_policies',{query:`?record_type=eq.${encodeURIComponent(recordType)}&select=record_type`});const values={retention_days:days,action:body.action,updated_by:principal.id,updated_at:new Date().toISOString()};const data=existing.length?await db('retention_policies',{method:'PATCH',query:`?record_type=eq.${encodeURIComponent(recordType)}`,body:values}):await db('retention_policies',{method:'POST',body:{record_type:recordType,...values}});await audit(principal,'retention_policy_updated','retention_policy',null,{record_type:recordType,retention_days:days,action:body.action},req);return json(res,200,{data:data[0]||data,requestId},ch);
  }
  if(req.method==='GET'&&u.pathname==='/api/v1/legal-holds'){const data=await db('legal_holds',{query:'?select=*&order=placed_at.desc&limit=250'}),visible=[];for(const row of data||[])if(await canReachClientRecord(access,row,'cases.view'))visible.push(row);return json(res,200,{data:visible,requestId},ch);}
  if(req.method==='POST'&&u.pathname==='/api/v1/legal-holds'){
    const body=await readJson(req,16_384);if(body.client_id&&!uuid(body.client_id)||body.case_id&&!uuid(body.case_id)||!body.client_id&&!body.case_id)throw Object.assign(new Error('VALID_HOLD_REFERENCE_REQUIRED'),{status:400});let caseRecord=null;if(body.case_id){const rows=await db('cases',{query:`?id=eq.${encodeURIComponent(body.case_id)}&select=*&limit=1`});if(!rows.length||body.client_id&&String(body.client_id)!==String(rows[0].client_id)||!canAccessCase(access,rows[0],'cases.view'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);caseRecord=rows[0]}else if(!await reachableClient(access,body.client_id,'clients.view'))return json(res,404,{error:'CLIENT_NOT_FOUND',requestId},ch);const record={id:crypto.randomUUID(),client_id:body.client_id||caseRecord?.client_id||null,case_id:body.case_id||null,reason:cleanText(body.reason,{required:true,max:2000}),active:true,placed_by:principal.id};const data=await db('legal_holds',{method:'POST',body:record});await audit(principal,'legal_hold_placed','legal_hold',record.id,{case_id:record.case_id,client_id:record.client_id},req);return json(res,201,{data:data[0]||data,requestId},ch);
  }
  const holdMatch=u.pathname.match(/^\/api\/v1\/legal-holds\/([0-9a-f-]{36})\/release$/i);
  if(holdMatch&&req.method==='POST'){const rows=await db('legal_holds',{query:`?id=eq.${encodeURIComponent(holdMatch[1])}&active=eq.true&select=*&limit=1`});if(!rows.length||!await canReachClientRecord(access,rows[0],'cases.view'))return json(res,404,{error:'ACTIVE_LEGAL_HOLD_NOT_FOUND',requestId},ch);const data=await db('legal_holds',{method:'PATCH',query:`?id=eq.${encodeURIComponent(holdMatch[1])}&active=eq.true`,body:{active:false,released_by:principal.id,released_at:new Date().toISOString()}});if(!data.length)return json(res,404,{error:'ACTIVE_LEGAL_HOLD_NOT_FOUND',requestId},ch);await audit(principal,'legal_hold_released','legal_hold',holdMatch[1],{case_id:data[0].case_id,client_id:data[0].client_id},req);return json(res,200,{data:data[0],requestId},ch);}

  if(req.method==='GET'&&u.pathname==='/api/v1/users'){const data=await listAuthUsers();return json(res,200,{data,requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/users'){const body=await readJson(req,32_768);assertOwnerRoleChangeAllowed(access,principal,null,body.roles,undefined);const data=await inviteAuthUser({email:body.email,displayName:body.display_name,roles:body.roles});await syncApplicationUser({...data,display_name:body.display_name,assigned_by:principal.id});await audit(principal,'user_invited','user',data.id,{roles:data.roles},req);return json(res,201,{data,requestId},ch)}
  const um=u.pathname.match(/^\/api\/v1\/users\/([0-9a-f-]{36})$/i);
  if(um&&req.method==='PATCH'){const body=await readJson(req,32_768);assertOwnerRoleChangeAllowed(access,principal,await getAuthUser(um[1]),body.roles,body.status);if(um[1]===principal.id&&body.status==='inactive')throw Object.assign(new Error('CANNOT_DEACTIVATE_CURRENT_USER'),{status:409});if(Array.isArray(body.roles)&&!body.roles.includes('owner')&&applicationOwnerEmail){const target=(await listAuthUsers()).find(user=>user.id===um[1]);if(String(target?.email||'').toLowerCase()===applicationOwnerEmail)throw Object.assign(new Error('APPLICATION_OWNER_ROLE_REQUIRED'),{status:409});}const data=await updateAuthUser(um[1],{displayName:body.display_name,roles:body.roles,status:body.status});await syncApplicationUser({...data,assigned_by:principal.id});await audit(principal,'user_updated','user',data.id,{roles:data.roles,status:data.status},req);return json(res,200,{data,requestId},ch)}

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
    const caseRows=await db('cases',{query:`?id=eq.${encodeURIComponent(intakeMatch[1])}&select=*`});
    if(!caseRows.length||!canAccessCase(access,caseRows[0],'cases.view'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
    const serviceCode=intakeMatch[2].toUpperCase();
    const definition=intakeDefinition(serviceCode);
    if(!definition)return json(res,404,{error:'INTAKE_DEFINITION_NOT_FOUND',requestId},ch);
    const definitionId=stableUuid('intake:'+serviceCode+':'+definition.version);
    const rows=await db('intake_submissions',{query:`?case_id=eq.${encodeURIComponent(intakeMatch[1])}&definition_id=eq.${definitionId}&select=*`});
    return json(res,200,{data:rows[0]||null,definition,requestId},ch);
  }
  if(intakeMatch&&req.method==='POST'){
    const caseRows=await db('cases',{query:`?id=eq.${encodeURIComponent(intakeMatch[1])}&select=*`});
    if(!caseRows.length||!canAccessCase(access,caseRows[0],'cases.manage'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
    const serviceCode=intakeMatch[2].toUpperCase();
    const definition=intakeDefinition(serviceCode);
    if(!definition)return json(res,404,{error:'INTAKE_DEFINITION_NOT_FOUND',requestId},ch);
    const body=await readJson(req,600_000);
    const status=body.status==='submitted'?'submitted':'draft';
    const answers=validateIntakeAnswers(definition,body.answers,{final:status==='submitted'});
    const currentStep=Math.max(0,Math.min(Number(body.current_step||0),definition.sections.length-1));
    const definitionId=stableUuid('intake:'+serviceCode+':'+definition.version);
    const definitions=await systemDb('intake_definitions',{query:`?id=eq.${definitionId}&select=id`});
    if(!definitions.length)await systemDb('intake_definitions',{method:'POST',body:{id:definitionId,service_code:serviceCode,version:definition.version,definition,active:true,published_at:new Date().toISOString(),created_by:principal.id}});
    const existing=await db('intake_submissions',{query:`?case_id=eq.${encodeURIComponent(intakeMatch[1])}&definition_id=eq.${definitionId}&select=id,status`});
    let data;
    if(existing.length){
      data=await db('intake_submissions',{method:'PATCH',query:`?id=eq.${existing[0].id}`,body:{answers,current_step:currentStep,status,submitted_at:status==='submitted'?new Date().toISOString():null,last_saved_by:principal.id,updated_at:new Date().toISOString()}});
    }else{
      data=await db('intake_submissions',{method:'POST',body:{id:crypto.randomUUID(),case_id:intakeMatch[1],definition_id:definitionId,answers,current_step:currentStep,status,submitted_at:status==='submitted'?new Date().toISOString():null,last_saved_by:principal.id}});
    }
    await audit(principal,status==='submitted'?'intake_submitted':'intake_saved','intake',data[0]?.id||existing[0]?.id,{case_id:intakeMatch[1],client_id:caseRows[0].client_id,service_code:serviceCode,old_status:existing[0]?.status||null,new_status:status,action_source:'STAFF_ASSISTED'},req);
    return json(res,200,{data:data[0]||data,definition,requestId},ch);
  }

  if(req.method==='POST'&&u.pathname==='/api/v1/identity/ocr'){
    const contentType=String(req.headers['content-type']||'').split(';')[0].toLowerCase();
    if(!allowedIdentityTypes.has(contentType))throw Object.assign(new Error('IDENTITY_IMAGE_REQUIRED'),{status:415});
    const declared=Number(u.searchParams.get('size_bytes')||req.headers['content-length']||0);
    if(!Number.isSafeInteger(declared)||declared<1||declared>10*1024*1024)throw Object.assign(new Error('IDENTITY_IMAGE_SIZE_NOT_ALLOWED'),{status:413});
    const image=await readBuffer(req,10*1024*1024);
    if(image.length!==declared)throw Object.assign(new Error('IDENTITY_IMAGE_SIZE_MISMATCH'),{status:409});
    let result;
    try{result=await extractIdentityDocument(image)}catch(error){console.error('identity-ocr-failed',error.message);throw Object.assign(new Error('IDENTITY_OCR_FAILED'),{status:422})}
    if(!result.mrz.detected&&!Object.keys(result.fields).length)throw Object.assign(new Error('IDENTITY_NOT_RECOGNIZED'),{status:422});
    const persisted=await persistDocumentExtraction(principal,result,{sourceSha256:crypto.createHash('sha256').update(image).digest('hex')});
    await audit(principal,'identity_ocr_completed','document_extraction',persisted.run.id,{engine:result.engine,mrz_detected:result.mrz.detected,mrz_valid:result.mrz.valid,confidence:result.confidence,persistent:true},req);
    return json(res,200,{extraction_token:persisted.token,extraction_id:persisted.run.id,expires_in:900,result,requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/identity/confirm'){
    const body=await readJson(req,32_768);
    if(body.confirmed!==true)throw Object.assign(new Error('HUMAN_CONFIRMATION_REQUIRED'),{status:400});
    const extraction=await claimDocumentExtraction(body.extraction_token,principal,{errorCode:'IDENTITY_EXTRACTION_EXPIRED'});
    let targetClient=null;
    let accepted;
    try{
      if(body.client_id){
        if(!uuid(body.client_id))throw Object.assign(new Error('VALID_CLIENT_ID_REQUIRED'),{status:400});
        const rows=await db('clients',{query:`?id=eq.${encodeURIComponent(body.client_id)}&select=*`});
        // Autofill writes identity fields, so it obeys the same client boundary
        // as an ordinary client edit.
        if(!rows.length||!canAccessClient(access,rows[0],'clients.manage',{reachableClientIds:await accessibleClientIds(access,'clients.manage')}))throw Object.assign(new Error('CLIENT_NOT_FOUND'),{status:404});
        targetClient=rows[0];
      }
      accepted=normalizeReviewedIdentityFields(body.fields,{requireLegalName:!targetClient});
      const committed=await commitVerifiedIdentityExtraction(extraction,'client',targetClient?.id||null,accepted);
      const data=await db('clients',{query:`?id=eq.${encodeURIComponent(committed.subject_id)}&select=*&limit=1`});
      targetClient=data[0];
    }catch(error){await releaseDocumentExtraction(extraction);throw error}
    await audit(principal,'identity_autofill_confirmed','client',targetClient.id,{client_id:targetClient.id,extraction_id:extraction.id,engine:extraction.result.engine,mrz_valid:extraction.result.mrz.valid,human_confirmed:true,canonical_commit:true},req);
    return json(res,200,{data:targetClient,autofill:{saved:true,human_confirmed:true,canonical_commit:true,engine:extraction.result.engine,mrz_valid:extraction.result.mrz.valid,extraction_id:extraction.id},requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/clients'){
    const limit=Math.min(Math.max(Number(u.searchParams.get('limit')||100),1),250);
    const includeArchived=u.searchParams.get('archived')==='true';
    const archived=includeArchived?'':'&archived_at=is.null';
    const reachableClientIds=await accessibleClientIds(access,'clients.view');
    if(reachableClientIds&&reachableClientIds.size===0)return json(res,200,{data:[],requestId},ch);
    const scopeQuery=reachableClientIds?`&id=in.(${[...reachableClientIds].join(',')})`:access.restrictedClientIds.size?`&id=not.in.(${[...access.restrictedClientIds].join(',')})`:'';
    let data=await db('clients',{query:`?select=*&order=updated_at.desc&limit=${limit}${archived}${scopeQuery}`});
    const q=String(u.searchParams.get('q')||'').trim().toLowerCase();
    if(q)data=data.filter(client=>[client.client_number,client.legal_name,client.legal_name_ar,client.email,client.phone,client.whatsapp,client.a_number,client.uscis_account_number,client.passport_number].some(value=>String(value||'').toLowerCase().includes(q)));
    data=(data||[]).filter(client=>canAccessClient(access,client,'clients.view',{reachableClientIds}));
    return json(res,200,{data,requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/clients'){
    const body=await readJson(req);
    const record={id:crypto.randomUUID(),...normalizeClientInput(body),created_by:principal.id,updated_by:principal.id};
    const data=await db('clients',{method:'POST',body:record});
    await audit(principal,'client_created','client',record.id,{client_id:record.id},req);
    return json(res,201,{data,requestId},ch);
  }
  const verifiedClientFields=u.pathname.match(/^\/api\/v1\/clients\/([0-9a-f-]{36})\/verified-fields$/i);
  if(verifiedClientFields&&req.method==='GET'){
    const rows=await db('clients',{query:`?id=eq.${encodeURIComponent(verifiedClientFields[1])}&select=id`});
    if(!rows.length||!await reachableClient(access,verifiedClientFields[1],'clients.view'))return json(res,404,{error:'CLIENT_NOT_FOUND',requestId},ch);
    const data=await db('verified_canonical_fields',{query:`?client_id=eq.${encodeURIComponent(verifiedClientFields[1])}&status=eq.current&select=*&order=field_path`});
    return json(res,200,{data,requestId},ch);
  }
  const clientMatch=u.pathname.match(/^\/api\/v1\/clients\/([0-9a-f-]{36})$/i);
  if(clientMatch&&req.method==='GET'){
    const rows=await db('clients',{query:`?id=eq.${encodeURIComponent(clientMatch[1])}&select=*`});
    // Addressing a client by id goes through the same decision as listing it.
    // An unreachable client reports 404, so the response does not confirm the
    // id exists.
    if(!Array.isArray(rows)||!rows.length||!canAccessClient(access,rows[0],'clients.view',{reachableClientIds:await accessibleClientIds(access,'clients.view')}))return json(res,404,{error:'CLIENT_NOT_FOUND',requestId},ch);
    return json(res,200,{data:rows[0],requestId},ch);
  }
  if(clientMatch&&req.method==='PATCH'){
    const rows=await db('clients',{query:`?id=eq.${encodeURIComponent(clientMatch[1])}&select=*`});
    if(!Array.isArray(rows)||!rows.length||!canAccessClient(access,rows[0],'clients.manage',{reachableClientIds:await accessibleClientIds(access,'clients.manage')}))return json(res,404,{error:'CLIENT_NOT_FOUND',requestId},ch);
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
    if(!await reachableClient(access,clientPeopleMatch[1],'clients.view'))return json(res,404,{error:'CLIENT_NOT_FOUND',requestId},ch);
    const links=await db('client_people',{query:`?client_id=eq.${encodeURIComponent(clientPeopleMatch[1])}&select=relationship,is_primary,created_at,people(*)&order=created_at`});
    return json(res,200,{data:links,requestId},ch);
  }
  if(clientPeopleMatch&&req.method==='POST'){
    if(!await reachableClient(access,clientPeopleMatch[1],'clients.manage'))return json(res,404,{error:'CLIENT_NOT_FOUND',requestId},ch);
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
    if(!await reachableClient(access,clientAccessMatch[1],'clients.view'))return json(res,404,{error:'CLIENT_NOT_FOUND',requestId},ch);
    const data=await db('client_access',{query:`?client_id=eq.${encodeURIComponent(clientAccessMatch[1])}&select=*&order=granted_at`});
    return json(res,200,{data,requestId},ch);
  }
  if(clientAccessMatch&&req.method==='POST'){
    if(!await reachableClient(access,clientAccessMatch[1],'clients.manage'))return json(res,404,{error:'CLIENT_NOT_FOUND',requestId},ch);
    const body=await readJson(req,16_384);
    if(!uuid(body.auth_user_id))throw Object.assign(new Error('VALID_USER_ID_REQUIRED'),{status:400});
    const accessRole=String(body.access_role||'collaborator');
    if(!['owner','collaborator'].includes(accessRole))throw Object.assign(new Error('INVALID_CLIENT_ACCESS_ROLE'),{status:400});
    const existing=await db('client_access',{query:`?client_id=eq.${encodeURIComponent(clientAccessMatch[1])}&auth_user_id=eq.${encodeURIComponent(body.auth_user_id)}&select=client_id`});
    const record={access_role:accessRole,status:'active',granted_by:principal.id,granted_at:new Date().toISOString(),revoked_at:null};
    const data=existing.length?await db('client_access',{method:'PATCH',query:`?client_id=eq.${encodeURIComponent(clientAccessMatch[1])}&auth_user_id=eq.${encodeURIComponent(body.auth_user_id)}`,body:record}):await db('client_access',{method:'POST',body:{client_id:clientAccessMatch[1],auth_user_id:body.auth_user_id,...record}});
    invalidateAccessCache();await audit(principal,'client_portal_access_granted','client',clientAccessMatch[1],{client_id:clientAccessMatch[1],auth_user_id:body.auth_user_id,access_role:accessRole},req);
    return json(res,200,{data:data[0]||data,requestId},ch);
  }

  const clientAccessUserMatch=u.pathname.match(/^\/api\/v1\/clients\/([0-9a-f-]{36})\/access\/([0-9a-f-]{36})$/i);
  if(clientAccessUserMatch&&req.method==='DELETE'){
    if(!await reachableClient(access,clientAccessUserMatch[1],'clients.manage'))return json(res,404,{error:'CLIENT_NOT_FOUND',requestId},ch);
    const data=await db('client_access',{method:'PATCH',query:`?client_id=eq.${encodeURIComponent(clientAccessUserMatch[1])}&auth_user_id=eq.${encodeURIComponent(clientAccessUserMatch[2])}`,body:{status:'revoked',revoked_at:new Date().toISOString()}});
    if(!data.length)return json(res,404,{error:'CLIENT_ACCESS_NOT_FOUND',requestId},ch);
    invalidateAccessCache();await audit(principal,'client_portal_access_revoked','client',clientAccessUserMatch[1],{client_id:clientAccessUserMatch[1],auth_user_id:clientAccessUserMatch[2]},req);
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
    const data=await db('tasks',{query}),taskCases=await casesById(access,(data||[]).map(row=>row.case_id).filter(Boolean)),reachableClientIds=await accessibleClientIds(access,'clients.view');
    return json(res,200,{data:(data||[]).filter(row=>row.case_id?canAccessCase(access,taskCases.get(String(row.case_id)),'tasks.view'):canAccessClient(access,{id:row.client_id},'clients.view',{reachableClientIds})),requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/tasks'){
    const body=await readJson(req);
    const record={id:crypto.randomUUID(),...normalizeTaskInput(body),created_by:principal.id,updated_by:principal.id};
    if(!record.case_id&&!record.client_id)throw Object.assign(new Error('TASK_CASE_OR_CLIENT_REQUIRED'),{status:400});
    if(record.case_id&&!uuid(record.case_id)||record.client_id&&!uuid(record.client_id)||record.assigned_user_id&&!uuid(record.assigned_user_id))throw Object.assign(new Error('INVALID_TASK_REFERENCE'),{status:400});
    if(record.case_id){const caseRows=await db('cases',{query:`?id=eq.${encodeURIComponent(record.case_id)}&select=*&limit=1`});if(!caseRows.length||record.client_id&&String(record.client_id)!==String(caseRows[0].client_id)||!canAccessCase(access,caseRows[0],'tasks.manage'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch)}else{const reachableClientIds=await accessibleClientIds(access,'clients.manage'),clientRows=await db('clients',{query:`?id=eq.${encodeURIComponent(record.client_id)}&select=*&limit=1`});if(!clientRows.length||!canAccessClient(access,clientRows[0],'clients.manage',{reachableClientIds}))return json(res,404,{error:'CLIENT_NOT_FOUND',requestId},ch)}
    const data=await db('tasks',{method:'POST',body:record});
    await audit(principal,'task_created','task',record.id,{case_id:record.case_id,client_id:record.client_id},req);
    return json(res,201,{data,requestId},ch);
  }
  const taskMatch=u.pathname.match(/^\/api\/v1\/tasks\/([0-9a-f-]{36})$/i);
  if(taskMatch&&req.method==='PATCH'){
    const rows=await db('tasks',{query:`?id=eq.${encodeURIComponent(taskMatch[1])}&select=*`});
    if(!Array.isArray(rows)||!rows.length)return json(res,404,{error:'TASK_NOT_FOUND',requestId},ch);
    if(!await canReachClientRecord(access,rows[0],'tasks.manage'))return json(res,404,{error:'TASK_NOT_FOUND',requestId},ch);
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
    const data=await db('deadlines',{query}),deadlineCases=await casesById(access,(data||[]).map(row=>row.case_id));
    return json(res,200,{data:(data||[]).filter(row=>canAccessCase(access,deadlineCases.get(String(row.case_id)),'tasks.view')),requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/deadlines'){
    const body=await readJson(req);
    if(!uuid(body.case_id))throw Object.assign(new Error('VALID_CASE_ID_REQUIRED'),{status:400});
    const caseRows=await db('cases',{query:`?id=eq.${encodeURIComponent(body.case_id)}&select=*&limit=1`});if(!caseRows.length||!canAccessCase(access,caseRows[0],'tasks.manage'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
    const record={id:crypto.randomUUID(),case_id:body.case_id,title:cleanText(body.title,{required:true,max:200}),deadline_date:cleanDate(body.deadline_date,{required:true}),deadline_type:cleanText(body.deadline_type,{required:true,max:80}),status:'open',source:cleanText(body.source,{max:200}),notes:cleanText(body.notes,{max:5000}),created_by:principal.id,updated_by:principal.id};
    const data=await db('deadlines',{method:'POST',body:record});
    await audit(principal,'deadline_created','deadline',record.id,{case_id:record.case_id,deadline_date:record.deadline_date},req);
    return json(res,201,{data,requestId},ch);
  }

  const deadlineMatch=u.pathname.match(/^\/api\/v1\/deadlines\/([0-9a-f-]{36})$/i);
  if(deadlineMatch&&req.method==='PATCH'){
    const rows=await db('deadlines',{query:`?id=eq.${encodeURIComponent(deadlineMatch[1])}&select=*`});
    if(!rows.length)return json(res,404,{error:'DEADLINE_NOT_FOUND',requestId},ch);
    const deadlineCases=await casesById(access,[rows[0].case_id]);if(!canAccessCase(access,deadlineCases.get(String(rows[0].case_id)),'tasks.manage'))return json(res,404,{error:'DEADLINE_NOT_FOUND',requestId},ch);
    const body=await readJson(req);
    const status=body.status===undefined?rows[0].status:String(body.status);
    if(!['open','completed','cancelled'].includes(status))throw Object.assign(new Error('INVALID_DEADLINE_STATUS'),{status:400});
    const patch={title:body.title===undefined?rows[0].title:cleanText(body.title,{required:true,max:200}),deadline_date:body.deadline_date===undefined?rows[0].deadline_date:cleanDate(body.deadline_date,{required:true}),deadline_type:body.deadline_type===undefined?rows[0].deadline_type:cleanText(body.deadline_type,{required:true,max:80}),source:body.source===undefined?rows[0].source:cleanText(body.source,{max:200}),notes:body.notes===undefined?rows[0].notes:cleanText(body.notes,{max:5000}),status,completed_at:status==='completed'?(rows[0].completed_at||new Date().toISOString()):null,updated_by:principal.id,updated_at:new Date().toISOString()};
    const data=await db('deadlines',{method:'PATCH',query:`?id=eq.${encodeURIComponent(deadlineMatch[1])}`,body:patch});
    await audit(principal,status==='completed'?'deadline_completed':'deadline_updated','deadline',deadlineMatch[1],{case_id:rows[0].case_id,deadline_date:patch.deadline_date,status},req);
    return json(res,200,{data,requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/cases'){const limit=Math.min(Math.max(Number(u.searchParams.get('limit')||100),1),250);const filter=caseListFilter(access,'cases.view');if(filter?.matchesNothing)return json(res,200,{data:[],requestId},ch);let rows=await db('cases',{query:`?select=*&order=created_at.desc&limit=${limit}${filter?filter.query:''}`});
    const q=String(u.searchParams.get('q')||'').trim().toLowerCase();if(q)rows=(rows||[]).filter(item=>[item.case_number,item.case_reference,item.client_name,item.case_type,item.service_code,item.receipt_number,item.assigned_to].some(value=>String(value||'').toLowerCase().includes(q)));
    // The scope narrows the query; explicit restrictions are subtracted after,
    // since a positive union and a negative set are not one PostgREST filter.
    return json(res,200,{data:filterAccessibleCases(access,rows||[],'cases.view'),requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/cases'){
    const b=await readJson(req);
    let clientName=cleanText(b.client_name,{max:180});
    let caseClient=null;
    if(b.client_id){
      if(!uuid(b.client_id))throw Object.assign(new Error('VALID_CLIENT_ID_REQUIRED'),{status:400});
      const clients=await db('clients',{query:`?id=eq.${encodeURIComponent(b.client_id)}&archived_at=is.null&select=*`});
      if(!Array.isArray(clients)||!clients.length||!canAccessClient(access,clients[0],'clients.manage',{reachableClientIds:await accessibleClientIds(access,'clients.manage')}))throw Object.assign(new Error('CLIENT_NOT_FOUND'),{status:404});
      caseClient=clients[0];clientName=caseClient.legal_name;
    }
    const serviceCode=cleanText(b.service_code,{max:40});
    const caseType=cleanText(b.case_type,{max:180})||serviceCatalog.find(service=>service.code===serviceCode)?.name;
    if(!clientName||!caseType)throw Object.assign(new Error('CLIENT_AND_SERVICE_REQUIRED'),{status:400});
    const baseRecord={id:crypto.randomUUID(),client_name:clientName,case_type:caseType,status:String(b.status||'intake'),priority:cleanPriority(b.priority),assigned_to:cleanText(b.assigned_to,{max:180}),notes:cleanText(b.notes,{max:5000})};
    const record=b.client_id||serviceCode?{...baseRecord,client_id:b.client_id||null,service_code:serviceCode,status:'active',workflow_stage:cleanWorkflowStage(b.workflow_stage||'intake'),review_state:cleanReviewState(b.review_state||'prepared'),agency:cleanText(b.agency,{max:120}),filing_type:cleanText(b.filing_type,{max:120}),jurisdiction:cleanText(b.jurisdiction,{max:180}),receipt_number:cleanText(b.receipt_number,{max:80}),created_by:principal.id,updated_by:principal.id}:baseRecord;
    const data=await db('cases',{method:'POST',body:record});
    const created=Array.isArray(data)?data[0]:data;
    await event(record.id,'case_created',{case_number:created.case_number,case_type:record.case_type,service_code:record.service_code,priority:record.priority,client_id:record.client_id,case_id:record.id},principal,req);
    const communication=caseClient?await caseOpeningCommunication({client:caseClient,caseRecord:created,principal,req}):{status:'not_applicable',reason:'CANONICAL_CLIENT_REQUIRED'};
    return json(res,201,{data,communication,requestId},ch);
  }
  const cm=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})$/i);
  // Addressing a record by UUID goes through the same decision as listing it.
  // A record the caller may not see reports 404, not 403, so the response does
  // not confirm that the id exists.
  if(cm&&req.method==='GET'){const data=await db('cases',{query:`?id=eq.${encodeURIComponent(cm[1])}&select=*`});if(!Array.isArray(data)||!data.length||!canAccessCase(access,data[0],'cases.view'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);return json(res,200,{data:data[0],requestId},ch)}
  if(cm&&req.method==='PATCH'){
    const b=await readJson(req);
    const target=await db('cases',{query:`?id=eq.${encodeURIComponent(cm[1])}&select=*`});
    if(!target.length||!canAccessCase(access,target[0],'cases.manage'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
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
    if(patch.client_id&&String(patch.client_id)!==String(target[0].client_id)){
      const clients=await db('clients',{query:`?id=eq.${encodeURIComponent(patch.client_id)}&archived_at=is.null&select=*`});
      if(!clients.length||!canAccessClient(access,clients[0],'clients.manage',{reachableClientIds:await accessibleClientIds(access,'clients.manage')}))return json(res,404,{error:'CLIENT_NOT_FOUND',requestId},ch);
      patch.client_name=clients[0].legal_name;
    }
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
    if(!caseRows.length||!canAccessCase(access,caseRows[0],'cases.view'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
    const currentCase=caseRows[0];
    const canViewTasks=hasEffectivePermission(access,'tasks.view');
    const canViewDocuments=hasEffectivePermission(access,'documents.view');
    const canViewBilling=hasEffectivePermission(access,'billing.view');
    const canViewAudit=hasEffectivePermission(access,'audit.view');
    const canManageCase=hasEffectivePermission(access,'cases.manage');
    const [clientRows,people,assignments,tasks,deadlines,documents,requests,notes,appointments,events,intakes,messages,invoices,communications,auditRows,histories,formsData,formFindings,jobs,artifacts]=await Promise.all([
      currentCase.client_id?db('clients',{query:`?id=eq.${encodeURIComponent(currentCase.client_id)}&select=*&limit=1`}):Promise.resolve([]),
      db('case_people',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=case_role,created_at,people(*)&order=created_at`}),
      db('case_assignments',{query:`?case_id=eq.${encodeURIComponent(caseId)}&active=eq.true&select=*&order=assigned_at`}),
      canViewTasks?db('tasks',{query:`?case_id=eq.${encodeURIComponent(caseId)}&archived_at=is.null&select=*&order=due_date.asc.nullslast`}):Promise.resolve([]),
      canViewTasks?db('deadlines',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=*&order=deadline_date.asc`}):Promise.resolve([]),
      canViewDocuments?db('documents',{query:`?case_id=eq.${encodeURIComponent(caseId)}&archived_at=is.null&select=*&order=created_at.desc`}):Promise.resolve([]),
      canViewDocuments?db('document_requests',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=*&order=created_at.desc`}):Promise.resolve([]),
      db('case_notes',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=*&order=created_at.desc`}),
      db('appointments',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=*&order=starts_at.asc`}),
      db('case_events',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=*&order=created_at.desc&limit=250`}),
      db('intake_submissions',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=*&order=updated_at.desc`}),
      db('case_messages',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=*&order=created_at.asc`}),
      canViewBilling?db('invoices',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=*&order=created_at.desc`}):Promise.resolve([]),
      canManageCase?db('outbound_communications',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=id,recipient,language,template_key,template_version,subject,status,provider,provider_message_id,failure_code,queued_at,sent_at,delivered_at,created_at&order=created_at.desc`}):Promise.resolve([]),
      canViewAudit?db('audit_events',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=*&order=created_at.desc&limit=250`}):Promise.resolve([]),
      optionalDb('person_history_records',{query:`?case_id=eq.${encodeURIComponent(caseId)}&archived_at=is.null&select=*&order=starts_on.desc`}),
      optionalDb('form_instances',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=*&order=updated_at.desc`}),
      optionalDb('form_findings',{query:`?case_id=eq.${encodeURIComponent(caseId)}&status=eq.open&select=*`}),
      optionalDb('background_jobs',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=*&order=created_at.desc&limit=100`}),
      optionalDb('generated_artifacts',{query:`?case_id=eq.${encodeURIComponent(caseId)}&select=*&order=generated_at.desc`}),
    ]);
    let payments=[];
    if(canViewBilling&&invoices.length)payments=await db('payments',{query:`?invoice_id=in.(${invoices.map(item=>item.id).join(',')})&select=*&order=received_at.desc`});
    let clientProfile=clientRows[0]||null;
    if(clientProfile?.profile_object_key&&r2&&r2Bucket){
      const profilePhotoUrl=await getSignedUrl(r2,new GetObjectCommand({Bucket:r2Bucket,Key:clientProfile.profile_object_key,ResponseContentDisposition:'inline'}),{expiresIn:300}).catch(()=>null);
      clientProfile={...clientProfile,profile_photo_url:profilePhotoUrl};
    }
    const totalFee=invoices.reduce((sum,item)=>sum+Number(item.office_fee_cents||0)+Number(item.government_fee_cents||0)+Number(item.other_fee_cents||0),0);
    const paid=payments.filter(item=>item.status==='recorded').reduce((sum,item)=>sum+Number(item.amount_cents||0),0);
    return json(res,200,{data:{case:currentCase,client:clientProfile,people,assignments,tasks,deadlines,documents,document_requests:requests,notes,appointments,intakes,messages,communications,invoices,payments,histories,forms:formsData,form_findings:formFindings,background_jobs:jobs,generated_artifacts:artifacts,financial_summary:canViewBilling?{total_fee_cents:totalFee,paid_cents:paid,balance_cents:Math.max(0,totalFee-paid)}:null,timeline:events,audit:auditRows,latest_activity:events[0]||null},requestId},ch);
  }

  const caseNotesMatch=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})\/notes$/i);
  if(caseNotesMatch&&req.method==='GET'){
    const caseRows=await db('cases',{query:`?id=eq.${encodeURIComponent(caseNotesMatch[1])}&select=*&limit=1`});if(!caseRows.length||!canAccessCase(access,caseRows[0],'cases.view'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
    const data=await db('case_notes',{query:`?case_id=eq.${encodeURIComponent(caseNotesMatch[1])}&select=*&order=created_at.desc`});
    return json(res,200,{data,requestId},ch);
  }
  if(caseNotesMatch&&req.method==='POST'){
    const caseRows=await db('cases',{query:`?id=eq.${encodeURIComponent(caseNotesMatch[1])}&select=*&limit=1`});if(!caseRows.length||!canAccessCase(access,caseRows[0],'cases.manage'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
    const body=await readJson(req,32_768);const visibility=body.visibility||'internal';if(!['internal','client'].includes(visibility))throw Object.assign(new Error('INVALID_NOTE_VISIBILITY'),{status:400});
    const record={id:crypto.randomUUID(),case_id:caseNotesMatch[1],body:cleanText(body.body,{required:true,max:10000}),visibility,created_by:principal.id};
    const data=await db('case_notes',{method:'POST',body:record});
    await audit(principal,'case_note_created','case_note',record.id,{case_id:record.case_id,visibility},req);
    return json(res,201,{data:data[0]||data,requestId},ch);
  }

  const caseAssignmentsMatch=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})\/assignments$/i);
  if(caseAssignmentsMatch&&req.method==='GET'){
    const caseRows=await db('cases',{query:`?id=eq.${encodeURIComponent(caseAssignmentsMatch[1])}&select=*&limit=1`});if(!caseRows.length||!canAccessCase(access,caseRows[0],'cases.view'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
    const data=await db('case_assignments',{query:`?case_id=eq.${encodeURIComponent(caseAssignmentsMatch[1])}&active=eq.true&select=*&order=assigned_at`});
    return json(res,200,{data,requestId},ch);
  }
  if(caseAssignmentsMatch&&req.method==='POST'){
    const caseRows=await db('cases',{query:`?id=eq.${encodeURIComponent(caseAssignmentsMatch[1])}&select=*&limit=1`});if(!caseRows.length||!canAccessCase(access,caseRows[0],'cases.manage'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
    const body=await readJson(req,16_384);if(!uuid(body.auth_user_id))throw Object.assign(new Error('VALID_USER_ID_REQUIRED'),{status:400});
    const assignmentRole=String(body.assignment_role||'collaborator');if(!['lead','collaborator','reviewer','preparer'].includes(assignmentRole))throw Object.assign(new Error('INVALID_ASSIGNMENT_ROLE'),{status:400});
    const existing=await db('case_assignments',{query:`?case_id=eq.${encodeURIComponent(caseAssignmentsMatch[1])}&auth_user_id=eq.${encodeURIComponent(body.auth_user_id)}&assignment_role=eq.${assignmentRole}&select=case_id`});
    const values={active:true,assigned_by:principal.id,assigned_at:new Date().toISOString(),ended_at:null};
    const data=existing.length?await db('case_assignments',{method:'PATCH',query:`?case_id=eq.${encodeURIComponent(caseAssignmentsMatch[1])}&auth_user_id=eq.${encodeURIComponent(body.auth_user_id)}&assignment_role=eq.${assignmentRole}`,body:values}):await db('case_assignments',{method:'POST',body:{case_id:caseAssignmentsMatch[1],auth_user_id:body.auth_user_id,assignment_role:assignmentRole,...values}});
    invalidateAccessCache();await audit(principal,'case_assigned','case',caseAssignmentsMatch[1],{case_id:caseAssignmentsMatch[1],auth_user_id:body.auth_user_id,assignment_role:assignmentRole},req);
    return json(res,200,{data:data[0]||data,requestId},ch);
  }

  const caseAssignmentMatch=u.pathname.match(/^\/api\/v1\/cases\/([0-9a-f-]{36})\/assignments\/([0-9a-f-]{36})\/([a-z_]+)$/i);
  if(caseAssignmentMatch&&req.method==='DELETE'){
    const caseRows=await db('cases',{query:`?id=eq.${encodeURIComponent(caseAssignmentMatch[1])}&select=*&limit=1`});if(!caseRows.length||!canAccessCase(access,caseRows[0],'cases.manage'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);
    const data=await db('case_assignments',{method:'PATCH',query:`?case_id=eq.${encodeURIComponent(caseAssignmentMatch[1])}&auth_user_id=eq.${encodeURIComponent(caseAssignmentMatch[2])}&assignment_role=eq.${encodeURIComponent(caseAssignmentMatch[3])}`,body:{active:false,ended_at:new Date().toISOString()}});
    if(!data.length)return json(res,404,{error:'CASE_ASSIGNMENT_NOT_FOUND',requestId},ch);
    invalidateAccessCache();await audit(principal,'case_unassigned','case',caseAssignmentMatch[1],{case_id:caseAssignmentMatch[1],auth_user_id:caseAssignmentMatch[2],assignment_role:caseAssignmentMatch[3]},req);
    return json(res,200,{data:data[0],requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/document-requests'){
    const caseId=u.searchParams.get('case_id');
    let query='?select=*&order=created_at.desc&limit=250';
    if(caseId){if(!uuid(caseId))throw Object.assign(new Error('INVALID_CASE_ID'),{status:400});query+=`&case_id=eq.${encodeURIComponent(caseId)}`;}
    const data=await db('document_requests',{query}),requestCases=await casesById(access,(data||[]).map(row=>row.case_id));
    return json(res,200,{data:(data||[]).filter(row=>canAccessCase(access,requestCases.get(String(row.case_id)),'documents.view')),requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/document-requests'){
    const body=await readJson(req);
    if(!uuid(body.case_id))throw Object.assign(new Error('VALID_CASE_ID_REQUIRED'),{status:400});
    if(body.client_id&&!uuid(body.client_id)||body.person_id&&!uuid(body.person_id))throw Object.assign(new Error('INVALID_DOCUMENT_OWNER'),{status:400});
    const caseRows=await db('cases',{query:`?id=eq.${encodeURIComponent(body.case_id)}&select=*&limit=1`});if(!caseRows.length||!canAccessCase(access,caseRows[0],'documents.manage'))return json(res,404,{error:'CASE_NOT_FOUND',requestId},ch);if(body.client_id&&String(body.client_id)!==String(caseRows[0].client_id))throw Object.assign(new Error('DOCUMENT_CLIENT_MISMATCH'),{status:409});if(body.person_id){const links=await db('case_people',{query:`?case_id=eq.${encodeURIComponent(body.case_id)}&person_id=eq.${encodeURIComponent(body.person_id)}&select=person_id&limit=1`});if(!links.length)throw Object.assign(new Error('DOCUMENT_PERSON_NOT_IN_CASE'),{status:409})}
    const record={id:crypto.randomUUID(),case_id:body.case_id,client_id:body.client_id||null,person_id:body.person_id||null,category:cleanText(body.category,{required:true,max:100}),title:cleanText(body.title,{required:true,max:200}),instructions:cleanText(body.instructions,{max:5000}),required:body.required!==false,due_date:cleanDate(body.due_date),status:'missing',requested_by:principal.id};
    const data=await db('document_requests',{method:'POST',body:record});
    await audit(principal,'document_requested','document_request',record.id,{case_id:record.case_id,client_id:record.client_id},req);
    return json(res,201,{data,requestId},ch);
  }
  const requestMatch=u.pathname.match(/^\/api\/v1\/document-requests\/([0-9a-f-]{36})$/i);
  if(requestMatch&&req.method==='PATCH'){
    const body=await readJson(req);
    const existing=await db('document_requests',{query:`?id=eq.${encodeURIComponent(requestMatch[1])}&select=*&limit=1`});if(!existing.length)return json(res,404,{error:'DOCUMENT_REQUEST_NOT_FOUND',requestId},ch);const requestCases=await casesById(access,[existing[0].case_id]);if(!canAccessCase(access,requestCases.get(String(existing[0].case_id)),'documents.manage'))return json(res,404,{error:'DOCUMENT_REQUEST_NOT_FOUND',requestId},ch);
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

  if(req.method==='GET'&&u.pathname==='/api/v1/documents'){const cid=u.searchParams.get('case_id');if(cid!==null&&!uuid(cid))throw Object.assign(new Error('VALID_CASE_ID_REQUIRED'),{status:400});const query=cid?`?case_id=eq.${encodeURIComponent(cid)}&select=*&archived_at=is.null&order=created_at.desc`:'?select=*&archived_at=is.null&order=created_at.desc&limit=1000';let data;try{data=await db('documents',{query})}catch(error){if(error.status!==400)throw error;const legacyQuery=cid?`?case_id=eq.${encodeURIComponent(cid)}&select=*&order=created_at.desc`:'?select=*&order=created_at.desc&limit=1000';data=await db('documents',{query:legacyQuery})}
    // Documents carry their own module scope, evaluated against the case each
    // one belongs to, so document access can be widened or narrowed on its own.
    const docCases=await casesById(access,(data||[]).map(row=>row.case_id));
    const term=String(u.searchParams.get('q')||'').trim().toLowerCase(),category=String(u.searchParams.get('category')||''),review=String(u.searchParams.get('review_status')||''),clientId=String(u.searchParams.get('client_id')||''),personId=String(u.searchParams.get('person_id')||'');
    const visible=(data||[]).filter(row=>!row.archived_at&&row.status!=='deleted'&&canAccessDocument(access,row,docCases.get(String(row.case_id)),'documents.view')&&(!term||[row.file_name,row.category,row.content_type].some(value=>String(value||'').toLowerCase().includes(term)))&&(!category||row.category===category)&&(!review||row.review_status===review)&&(!clientId||String(row.client_id)===clientId)&&(!personId||String(row.person_id)===personId));
    return json(res,200,{data:visible,requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/documents/upload'){
    if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});
    const contentType=String(req.headers['content-type']||'').split(';')[0].toLowerCase();
    const input=documentInput({case_id:u.searchParams.get('case_id'),filename:u.searchParams.get('filename'),content_type:contentType,size_bytes:Number(u.searchParams.get('size_bytes')||req.headers['content-length']||0)});
    const caseRows=await db('cases',{query:`?id=eq.${encodeURIComponent(input.caseId)}&select=*`});
    if(!caseRows.length||!canAccessCase(access,caseRows[0],'documents.manage'))throw Object.assign(new Error('CASE_NOT_FOUND'),{status:404});
    const file=await readBuffer(req,25*1024*1024);
    if(file.length!==input.sizeBytes)throw Object.assign(new Error('DOCUMENT_SIZE_MISMATCH'),{status:409});
    const checksum=crypto.createHash('sha256').update(file).digest('hex');
    const duplicates=await db('documents',{query:`?case_id=eq.${encodeURIComponent(input.caseId)}&content_checksum=eq.${checksum}&archived_at=is.null&select=id`});
    if(duplicates.length)throw Object.assign(new Error('DUPLICATE_DOCUMENT'),{status:409});
    const filename=safeKey(input.fileName).split('/').pop();
    const key=safeKey(`cases/${input.caseId}/${crypto.randomUUID()}-${filename}`);
    await r2.send(new PutObjectCommand({Bucket:r2Bucket,Key:key,Body:file,ContentType:input.contentType,ContentLength:file.length,Metadata:{case_id:input.caseId}}));
    try{
      const stored=await r2.send(new HeadObjectCommand({Bucket:r2Bucket,Key:key}));
      if(Number(stored.ContentLength)!==file.length||String(stored.ContentType||'').toLowerCase()!==input.contentType)throw Object.assign(new Error('UPLOADED_OBJECT_MISMATCH'),{status:409});
      const linkage=await canonicalDocumentLinkage(caseRows[0],{client_id:u.searchParams.get('client_id'),person_id:u.searchParams.get('person_id'),request_id:u.searchParams.get('request_id'),replaces_document_id:u.searchParams.get('replaces_document_id'),category:u.searchParams.get('category')});
      const record={id:crypto.randomUUID(),case_id:input.caseId,client_id:linkage.client_id,person_id:linkage.person_id,request_id:linkage.request_id,object_key:key,file_name:input.fileName,content_type:input.contentType,size_bytes:file.length,content_checksum:checksum,object_etag:String(stored.ETag||'').replace(/^"|"$/g,'')||null,status:'uploaded',category:linkage.category,review_status:linkage.review_status,replaces_document_id:linkage.replaces_document_id,version:linkage.version,uploaded_by:principal.id};
      const data=await systemDb('documents',{method:'POST',body:record});
      if(linkage.replacement)await db('documents',{method:'PATCH',query:`?id=eq.${encodeURIComponent(linkage.replacement.id)}&archived_at=is.null`,body:{archived_at:new Date().toISOString()}});
      if(record.request_id)await db('document_requests',{method:'PATCH',query:`?id=eq.${encodeURIComponent(record.request_id)}&case_id=eq.${encodeURIComponent(input.caseId)}`,body:{status:'received',updated_at:new Date().toISOString()}});
      await event(record.case_id,'document_uploaded',{document_id:record.id,file_name:record.file_name,client_id:record.client_id,case_id:record.case_id,storage:'r2'},principal,req);
      return json(res,201,{data,storage:'r2',linked:{case_id:record.case_id,client_id:record.client_id},preview_available:['application/pdf','image/jpeg','image/png','image/webp'].includes(record.content_type),requestId},ch);
    }catch(error){await r2.send(new DeleteObjectCommand({Bucket:r2Bucket,Key:key})).catch(()=>{});throw error}
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/documents/presign'){if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});const b=await readJson(req,32_768);const input=documentInput(b);const caseRows=await db('cases',{query:`?id=eq.${encodeURIComponent(input.caseId)}&select=*`});if(!Array.isArray(caseRows)||!caseRows.length||!canAccessCase(access,caseRows[0],'documents.manage'))throw Object.assign(new Error('CASE_NOT_FOUND'),{status:404});const filename=safeKey(input.fileName).split('/').pop();const key=safeKey(`cases/${input.caseId}/${crypto.randomUUID()}-${filename}`);const uploadUrl=await getSignedUrl(r2,new PutObjectCommand({Bucket:r2Bucket,Key:key,ContentType:input.contentType,ContentLength:input.sizeBytes,Metadata:{case_id:input.caseId}}),{expiresIn:900});return json(res,200,{key,upload_url:uploadUrl,expires_in:900,required_headers:{'content-type':input.contentType},requestId},ch)}
  if(req.method==='POST'&&u.pathname==='/api/v1/documents/confirm'){
    if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});
    const b=await readJson(req,32_768),input=documentInput(b),key=safeKey(b.key);
    if(!key.startsWith(`cases/${input.caseId}/`))throw Object.assign(new Error('DOCUMENT_CASE_MISMATCH'),{status:403});
    const cases=await db('cases',{query:`?id=eq.${encodeURIComponent(input.caseId)}&select=*`});
    if(!cases.length||!canAccessCase(access,cases[0],'documents.manage'))throw Object.assign(new Error('CASE_NOT_FOUND'),{status:404});
    const verified=await verifiedStoredDocument(key,input,b.content_checksum);
    const duplicates=await db('documents',{query:`?case_id=eq.${encodeURIComponent(input.caseId)}&content_checksum=eq.${verified.checksum}&archived_at=is.null&select=id`});if(duplicates.length){await r2.send(new DeleteObjectCommand({Bucket:r2Bucket,Key:key}));throw Object.assign(new Error('DUPLICATE_DOCUMENT'),{status:409})}
    try{
      const linkage=await canonicalDocumentLinkage(cases[0],b);
      const record={id:crypto.randomUUID(),case_id:input.caseId,object_key:key,file_name:input.fileName,content_type:input.contentType,size_bytes:input.sizeBytes,content_checksum:verified.checksum,object_etag:verified.etag,status:'uploaded',client_id:linkage.client_id,person_id:linkage.person_id,request_id:linkage.request_id,category:linkage.category,review_status:linkage.review_status,replaces_document_id:linkage.replaces_document_id,version:linkage.version,uploaded_by:principal.id};
      const data=await systemDb('documents',{method:'POST',body:record});
      if(linkage.replacement)await db('documents',{method:'PATCH',query:`?id=eq.${encodeURIComponent(linkage.replacement.id)}&archived_at=is.null`,body:{archived_at:new Date().toISOString()}});
      if(record.request_id)await db('document_requests',{method:'PATCH',query:`?id=eq.${encodeURIComponent(record.request_id)}&case_id=eq.${encodeURIComponent(input.caseId)}`,body:{status:'received',updated_at:new Date().toISOString()}});
      await event(record.case_id,'document_uploaded',{document_id:record.id,file_name:record.file_name,client_id:record.client_id,case_id:record.case_id,person_id:record.person_id,request_id:record.request_id,storage:'r2'},principal,req);
      return json(res,201,{data,storage:'r2',linked:{case_id:record.case_id,client_id:record.client_id,person_id:record.person_id,request_id:record.request_id},preview_available:['application/pdf','image/jpeg','image/png','image/webp'].includes(record.content_type),requestId},ch);
    }catch(error){await r2.send(new DeleteObjectCommand({Bucket:r2Bucket,Key:key})).catch(()=>{});throw error}
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/documents/download-url'){if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});const b=await readJson(req,16_384);let rows=[];if(uuid(b.document_id))rows=await db('documents',{query:`?id=eq.${encodeURIComponent(b.document_id)}&select=*`});else if(principal?.authType==='internal'&&b.key)rows=await db('documents',{query:`?object_key=eq.${encodeURIComponent(safeKey(b.key))}&select=*`});else throw Object.assign(new Error('VALID_DOCUMENT_ID_REQUIRED'),{status:400});if(!Array.isArray(rows)||!rows.length)throw Object.assign(new Error('DOCUMENT_NOT_FOUND'),{status:404});const doc=rows[0];
    // A signed URL is a bearer capability that outlives this request, so the
    // effective model is enforced before one is minted. A soft-deleted record
    // keeps its row for the audit trail but its object is gone from R2.
    if(doc.status==='deleted'||doc.archived_at)throw Object.assign(new Error('DOCUMENT_NOT_FOUND'),{status:404});
    const dlCases=await casesById(access,[doc.case_id]);
    if(!canAccessDocument(access,doc,dlCases.get(String(doc.case_id)),'documents.view'))throw Object.assign(new Error('DOCUMENT_NOT_FOUND'),{status:404});
    const inline=b.disposition==='inline'&&['application/pdf','image/jpeg','image/png','image/webp'].includes(doc.content_type);const disposition=inline?'inline':'attachment';const downloadUrl=await getSignedUrl(r2,new GetObjectCommand({Bucket:r2Bucket,Key:doc.object_key,ResponseContentDisposition:`${disposition}; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`,ResponseContentType:doc.content_type}),{expiresIn:300});await event(doc.case_id,inline?'document_previewed':'document_downloaded',{document_id:doc.id},principal,req);return json(res,200,{download_url:downloadUrl,preview_url:inline?downloadUrl:null,disposition,expires_in:300,requestId},ch)}
  const documentOcrMatch=u.pathname.match(/^\/api\/v1\/documents\/([0-9a-f-]{36})\/ocr(?:\/(confirm))?$/i);
  if(documentOcrMatch&&req.method==='GET'&&!documentOcrMatch[2]){const rows=await db('documents',{query:`?id=eq.${encodeURIComponent(documentOcrMatch[1])}&archived_at=is.null&select=*&limit=1`});if(!rows.length)return json(res,404,{error:'DOCUMENT_NOT_FOUND',requestId},ch);const document=rows[0],ocrCases=await casesById(access,[document.case_id]);if(!canAccessDocument(access,document,ocrCases.get(String(document.case_id)),'documents.manage'))return json(res,404,{error:'DOCUMENT_NOT_FOUND',requestId},ch);const runs=await db('document_extractions',{query:`?document_id=eq.${document.id}&select=*&order=created_at.desc&limit=50`}),fields=runs.length?await db('document_extracted_fields',{query:`?extraction_id=in.(${runs.map(run=>run.id).join(',')})&select=*`}):[];return json(res,200,{data:runs.map(run=>({...run,fields:fields.filter(field=>field.extraction_id===run.id)})),requestId},ch);}
  if(documentOcrMatch&&req.method==='POST'){
    if(!r2||!r2Bucket)throw Object.assign(new Error('R2_NOT_CONFIGURED'),{status:503});
    const rows=await db('documents',{query:`?id=eq.${encodeURIComponent(documentOcrMatch[1])}&archived_at=is.null&select=*&limit=1`});if(!rows.length)return json(res,404,{error:'DOCUMENT_NOT_FOUND',requestId},ch);const document=rows[0],ocrCases=await casesById(access,[document.case_id]);if(!canAccessDocument(access,document,ocrCases.get(String(document.case_id)),'documents.manage'))return json(res,404,{error:'DOCUMENT_NOT_FOUND',requestId},ch);
    if(documentOcrMatch[2]){const body=await readJson(req,32_768);if(body.confirmed!==true)throw Object.assign(new Error('HUMAN_CONFIRMATION_REQUIRED'),{status:400});const review=await claimDocumentExtraction(body.review_token,principal,{documentId:document.id,errorCode:'DOCUMENT_OCR_REVIEW_EXPIRED'});const patch={category:cleanText(body.category||document.category||'identity',{required:true,max:100}),review_status:'under_review'};if(body.person_id){if(!uuid(body.person_id))throw Object.assign(new Error('INVALID_DOCUMENT_METADATA'),{status:400});const links=await db('case_people',{query:`?case_id=eq.${encodeURIComponent(document.case_id)}&person_id=eq.${encodeURIComponent(body.person_id)}&select=person_id&limit=1`});if(!links.length){await releaseDocumentExtraction(review);throw Object.assign(new Error('DOCUMENT_PERSON_NOT_IN_CASE'),{status:409})}patch.person_id=body.person_id}let updated,canonical;try{const accepted=normalizeReviewedIdentityFields(body.fields);updated=await db('documents',{method:'PATCH',query:`?id=eq.${encodeURIComponent(document.id)}`,body:patch});canonical=await commitVerifiedIdentityExtraction(review,patch.person_id?'person':'client',patch.person_id||document.client_id,accepted);}catch(error){await releaseDocumentExtraction(review);throw error}await event(document.case_id,'document_ocr_confirmed',{case_id:document.case_id,client_id:document.client_id,document_id:document.id,extraction_id:review.id,person_id:patch.person_id||document.person_id||null,engine:review.result.engine,mrz_valid:review.result.mrz.valid,human_confirmed:true,canonical_commit:true,committed_fields:canonical.committed_fields,confirmed_fields:Object.keys(body.fields&&typeof body.fields==='object'?body.fields:{})},principal,req);return json(res,200,{data:updated[0]||updated,ocr:{engine:review.result.engine,mrz_valid:review.result.mrz.valid,human_confirmed:true,canonical_commit:true,committed_fields:canonical.committed_fields,source_document_id:document.id,extraction_id:review.id},requestId},ch)}
    if(!allowedIdentityTypes.has(String(document.content_type||'').toLowerCase()))throw Object.assign(new Error('DOCUMENT_OCR_IMAGE_REQUIRED'),{status:415});const object=await r2.send(new GetObjectCommand({Bucket:r2Bucket,Key:document.object_key})),bytes=Buffer.from(await object.Body.transformToByteArray());let result;try{result=await extractIdentityDocument(bytes)}catch{throw Object.assign(new Error('DOCUMENT_OCR_FAILED'),{status:422})}if(!result.mrz.detected&&!Object.keys(result.fields).length)throw Object.assign(new Error('DOCUMENT_NOT_RECOGNIZED'),{status:422});const persisted=await persistDocumentExtraction(principal,result,{document,sourceSha256:crypto.createHash('sha256').update(bytes).digest('hex')});await event(document.case_id,'document_ocr_review_required',{case_id:document.case_id,client_id:document.client_id,document_id:document.id,extraction_id:persisted.run.id,engine:result.engine,mrz_detected:result.mrz.detected,mrz_valid:result.mrz.valid,human_confirmation_required:true},principal,req);return json(res,200,{review_token:persisted.token,extraction_id:persisted.run.id,expires_in:900,result,source_document_id:document.id,human_confirmation_required:true,requestId},ch);
  }
  const reviewMatch=u.pathname.match(/^\/api\/v1\/documents\/([0-9a-f-]{36})\/review$/i);
  if(reviewMatch&&req.method==='POST'){
    const body=await readJson(req,32_768);
    if(!['approved','rejected'].includes(body.status))throw Object.assign(new Error('INVALID_DOCUMENT_REVIEW_STATUS'),{status:400});
    const patch={review_status:body.status,reviewer_notes:cleanText(body.reviewer_notes,{max:5000}),reviewed_by:principal.id,reviewed_at:new Date().toISOString()};
    // Every other /documents route resolves the record before touching it. The
    // review decision is evidentiary, so it gets the same boundary: a reviewer
    // the Owner has narrowed must not sign off a document they cannot reach.
    const existingReview=await db('documents',{query:`?id=eq.${encodeURIComponent(reviewMatch[1])}&select=*&limit=1`});
    if(!existingReview.length)return json(res,404,{error:'DOCUMENT_NOT_FOUND',requestId},ch);
    const reviewCases=await casesById(access,[existingReview[0].case_id]);
    if(!canAccessDocument(access,existingReview[0],reviewCases.get(String(existingReview[0].case_id)),'documents.review'))return json(res,404,{error:'DOCUMENT_NOT_FOUND',requestId},ch);
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
    const existingDoc=await db('documents',{query:`?id=eq.${encodeURIComponent(dm[1])}&select=*`});
    if(!existingDoc.length)return json(res,404,{error:'DOCUMENT_NOT_FOUND',requestId},ch);
    const patchCases=await casesById(access,[existingDoc[0].case_id]);
    if(!canAccessDocument(access,existingDoc[0],patchCases.get(String(existingDoc[0].case_id)),'documents.manage'))return json(res,404,{error:'DOCUMENT_NOT_FOUND',requestId},ch);
    const data=await db('documents',{method:'PATCH',query:`?id=eq.${encodeURIComponent(dm[1])}`,body:patch});
    if(!data.length)return json(res,404,{error:'DOCUMENT_NOT_FOUND',requestId},ch);
    await event(data[0].case_id,'document_updated',{document_id:dm[1],case_id:data[0].case_id,client_id:data[0].client_id},principal,req);
    return json(res,200,{data,requestId},ch);
  }
  if(dm&&req.method==='DELETE'){const rows=await db('documents',{query:`?id=eq.${encodeURIComponent(dm[1])}&select=*`});if(!Array.isArray(rows)||!rows.length)return json(res,404,{error:'DOCUMENT_NOT_FOUND',requestId},ch);const doc=rows[0];const delCases=await casesById(access,[doc.case_id]);if(!canAccessDocument(access,doc,delCases.get(String(doc.case_id)),'documents.manage'))return json(res,404,{error:'DOCUMENT_NOT_FOUND',requestId},ch);const holds=await db('legal_holds',{query:`?active=eq.true&or=(case_id.eq.${encodeURIComponent(doc.case_id)},client_id.eq.${encodeURIComponent(doc.client_id||'00000000-0000-0000-0000-000000000000')})&select=id`});if(holds.length)throw Object.assign(new Error('DOCUMENT_UNDER_LEGAL_HOLD'),{status:409});await db('documents',{method:'PATCH',query:`?id=eq.${encodeURIComponent(dm[1])}`,body:{archived_at:new Date().toISOString()}});await event(doc.case_id,'document_archived',{document_id:doc.id,file_name:doc.file_name,case_id:doc.case_id,client_id:doc.client_id},principal,req);return json(res,200,{deleted:true,recoverable:true,requestId},ch)}

  // ---- Owner access management ---------------------------------------------
  // Everything the model reads is editable here, so the Owner can grant,
  // revoke, restrict, expand or override access from the UI without a code
  // change or a schema change.
  if(req.method==='GET'&&u.pathname==='/api/v1/access'){
    const [policies,recordGrants,teams,teamMembers,clients,clientAccess,appUsers,userRoles]=await Promise.all([
      db('access_policies',{query:'?select=*&order=subject_type.asc'}),
      db('record_access_grants',{query:'?select=*&order=created_at.desc&limit=500'}),
      db('teams',{query:'?select=*&order=name.asc'}),
      db('team_members',{query:'?select=*'}),
      db('clients',{query:'?select=id,legal_name&order=legal_name.asc&limit=500'}),
      db('client_access',{query:'?select=*'}),
      db('app_users',{query:'?status=eq.active&select=auth_user_id,email,display_name,status'}),
      db('user_roles',{query:'?select=auth_user_id,role_code'}),
    ]);
    const excludedDiagnosticRoles=new Set(['owner','client_owner','client_collaborator','employer_portal','beneficiary_portal']);
    const staff=appUsers.filter(user=>userRoles.some(role=>String(role.auth_user_id)===String(user.auth_user_id)&&!excludedDiagnosticRoles.has(role.role_code))&&!userRoles.some(role=>String(role.auth_user_id)===String(user.auth_user_id)&&role.role_code==='owner'));
    const unconfiguredGlobalStaff=staff.filter(user=>!policies.some(policy=>policy.subject_type==='user'&&String(policy.subject_id)===String(user.auth_user_id))).map(user=>({id:user.auth_user_id,email:user.email,display_name:user.display_name,posture:'unconfigured_global'}));
    const intentionallyGlobalStaff=staff.filter(user=>policies.some(policy=>policy.subject_type==='user'&&String(policy.subject_id)===String(user.auth_user_id)&&Object.values(policy.scopes||{}).length>0&&Object.values(policy.scopes||{}).every(scope=>scope==='global'))).map(user=>({id:user.auth_user_id,email:user.email,display_name:user.display_name,posture:'explicit_global'}));
    return json(res,200,{data:{modules:accessModules,scopes:accessScopes,permissions:permissionCatalogue(),roles:Object.keys(roleDefinitions),
      defaults:{staff:'global',client:'client_self'},
      recordTargets:['case','client','category','service'],
      categories:[...new Set(serviceCatalog.map(service=>service.category))].sort(),
      services:serviceCatalog.map(service=>({code:service.code,name:service.name,category:service.category})),
      policies:policies||[],recordGrants:recordGrants||[],teams:teams||[],
      teamMembers:teamMembers||[],clients:clients||[],clientAccess:clientAccess||[],diagnostics:{unconfigured_global_staff:unconfiguredGlobalStaff,intentionally_global_staff:intentionallyGlobalStaff}},requestId},ch);
  }
  if(req.method==='PUT'&&u.pathname==='/api/v1/access/policies'){
    const policy=validateAccessPolicy(await readJson(req,65_536));
    await assertPolicyReferences(policy);
    const existing=await db('access_policies',{query:`?subject_type=eq.${encodeURIComponent(policy.subject_type)}&subject_id=eq.${encodeURIComponent(policy.subject_id)}&select=*`});
    const payload={...policy,updated_by:principal?.id||null,updated_at:new Date().toISOString()};
    const data=existing.length
      ?await db('access_policies',{method:'PATCH',query:`?id=eq.${encodeURIComponent(existing[0].id)}`,body:payload})
      :await db('access_policies',{method:'POST',body:{id:crypto.randomUUID(),...payload}});
    invalidateAccessCache();
    await audit(principal,'access_policy_set','access_policy',Array.isArray(data)&&data.length?data[0].id:null,{subject_type:policy.subject_type,subject_id:policy.subject_id,previous_state:existing[0]||null,new_state:policy},req);
    return json(res,200,{data:Array.isArray(data)?data[0]:data,requestId},ch);
  }
  const policyMatch=u.pathname.match(/^\/api\/v1\/access\/policies\/(role|team|user)\/([^/]+)$/);
  if(policyMatch&&req.method==='DELETE'){
    const subjectId=decodeURIComponent(policyMatch[2]);
    await db('access_policies',{method:'DELETE',query:`?subject_type=eq.${encodeURIComponent(policyMatch[1])}&subject_id=eq.${encodeURIComponent(subjectId)}`});
    invalidateAccessCache();
    await audit(principal,'access_policy_cleared','access_policy',null,{subject_type:policyMatch[1],subject_id:subjectId},req);
    // Clearing a policy returns the subject to defaults, which for staff is
    // global scope with their role's permissions.
    return json(res,200,{cleared:true,requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/access/record-grants'){
    const grant=validateRecordGrant(await readJson(req,32_768));
    await assertGrantReferences(grant);
    const data=await db('record_access_grants',{method:'POST',body:{id:crypto.randomUUID(),...grant,created_by:principal?.id||null}});
    invalidateAccessCache();
    await audit(principal,`record_access_${grant.effect}ed`,'record_access_grant',Array.isArray(data)&&data.length?data[0].id:null,grant,req);
    return json(res,201,{data:Array.isArray(data)?data[0]:data,requestId},ch);
  }
  const grantMatch=u.pathname.match(/^\/api\/v1\/access\/record-grants\/([0-9a-f-]{36})$/i);
  if(grantMatch&&req.method==='DELETE'){
    if(!uuid(grantMatch[1]))throw Object.assign(new Error('INVALID_GRANT_ID'),{status:400});
    const rows=await db('record_access_grants',{query:`?id=eq.${encodeURIComponent(grantMatch[1])}&select=*`});
    if(!rows.length)return json(res,404,{error:'GRANT_NOT_FOUND',requestId},ch);
    await db('record_access_grants',{method:'DELETE',query:`?id=eq.${encodeURIComponent(grantMatch[1])}`});
    invalidateAccessCache();
    await audit(principal,'record_access_revoked','record_access_grant',grantMatch[1],rows[0],req);
    return json(res,200,{revoked:true,requestId},ch);
  }
  // Preview what a given user may actually do, resolved through the same
  // engine the request path uses, so the Owner can confirm a change landed.
  const effectiveMatch=u.pathname.match(/^\/api\/v1\/access\/effective\/([0-9a-f-]{36})$/i);
  if(effectiveMatch&&req.method==='GET'){
    if(!uuid(effectiveMatch[1]))throw Object.assign(new Error('INVALID_USER_ID'),{status:400});
    const target=(await listAuthUsers()).find(entry=>entry.id===effectiveMatch[1]);
    if(!target)return json(res,404,{error:'USER_NOT_FOUND',requestId},ch);
    const resolved=await accessFor({id:target.id,email:target.email,displayName:target.display_name,roles:target.roles,permissions:new Set(),authType:'session'});
    return json(res,200,{data:describeAccess(resolved),requestId},ch);
  }
  if(req.method==='POST'&&u.pathname==='/api/v1/teams'){
    const body=await readJson(req,16_384);
    const name=cleanText(body.name,{required:true,max:120});
    const data=await db('teams',{method:'POST',body:{id:crypto.randomUUID(),name,description:cleanText(body.description,{max:400})}});
    invalidateAccessCache();
    await audit(principal,'team_created','team',Array.isArray(data)&&data.length?data[0].id:null,{name},req);
    return json(res,201,{data:Array.isArray(data)?data[0]:data,requestId},ch);
  }
  const teamMembersMatch=u.pathname.match(/^\/api\/v1\/teams\/([0-9a-f-]{36})\/members$/i);
  if(teamMembersMatch&&req.method==='POST'){
    if(!uuid(teamMembersMatch[1]))throw Object.assign(new Error('INVALID_TEAM_ID'),{status:400});
    const body=await readJson(req,16_384);
    if(!uuid(body.user_id))throw Object.assign(new Error('INVALID_USER_ID'),{status:400});
    const data=await db('team_members',{method:'POST',body:{team_id:teamMembersMatch[1],user_id:body.user_id}});
    invalidateAccessCache();
    await audit(principal,'team_member_added','team_member',teamMembersMatch[1],{user_id:body.user_id},req);
    return json(res,201,{data:Array.isArray(data)?data[0]:data,requestId},ch);
  }
  const teamMemberMatch=u.pathname.match(/^\/api\/v1\/teams\/([0-9a-f-]{36})\/members\/([0-9a-f-]{36})$/i);
  if(teamMemberMatch&&req.method==='DELETE'){
    if(!uuid(teamMemberMatch[1])||!uuid(teamMemberMatch[2]))throw Object.assign(new Error('INVALID_TEAM_ID'),{status:400});
    await db('team_members',{method:'DELETE',query:`?team_id=eq.${encodeURIComponent(teamMemberMatch[1])}&user_id=eq.${encodeURIComponent(teamMemberMatch[2])}`});
    invalidateAccessCache();
    await audit(principal,'team_member_removed','team_member',teamMemberMatch[1],{user_id:teamMemberMatch[2]},req);
    return json(res,200,{removed:true,requestId},ch);
  }

  if(req.method==='GET'&&u.pathname==='/api/v1/audit'){let data;try{data=await db('audit_events',{query:'?select=*&order=created_at.desc&limit=250'})}catch(error){if(error.status!==404)throw error;data=(await db('case_events',{query:'?select=*&order=created_at.desc&limit=150'})).map(item=>({...item,action:item.event_type,entity_id:item.case_id,actor_label:item.actor}))}
    // The audit trail is scoped by its own module, so an auditor can be given
    // firm-wide history while a case manager sees only their own cases'.
    if(!access.isOwner&&scopeFor(access,'audit')!=='global'){
      const auditCases=await casesById(access,(data||[]).map(row=>row.case_id));
      // A narrowed audit scope also withholds firm-level rows that belong to no
      // case (sign-ins, user administration): those are not this caller's to
      // read either once the Owner has scoped them down.
      data=(data||[]).filter(row=>row.case_id&&canAccessCase(access,auditCases.get(String(row.case_id))||{id:row.case_id},'audit.view'));
    }
    return json(res,200,{data,requestId},ch)}
  return json(res,404,{error:'NOT_FOUND',requestId},ch);
}

export function respondToError(req,res,err){
  const status=Number(err.status||500);
  if(status>=500)console.error(err.message,err.internalDetails||err.stack||'');
  else if(err.internalDetails)console.warn(err.message,err.internalDetails);
  const body={error:status>=500?'INTERNAL_ERROR':(err.message||'INTERNAL_ERROR'),requestId:res.getHeader('x-request-id')||crypto.randomUUID()};
  // Only detail this service produced is echoed back. Upstream database and
  // storage payloads name tables, columns and constraints, and stay in logs.
  if(err.fields)body.fields=err.fields;
  if(status<500&&err.details)body.details=err.details;
  try{json(res,status,body,cors(req))}catch{res.destroy()}
}

export function createServer(){
  ensureConfiguredOwnerInvitation()
    .then(result=>{if(result.invited||result.resent)console.log('Configured Owner activation sent')})
    .catch(error=>console.error('owner-invitation-failed',error.message));
  wakeBackgroundWorker();
  const server=http.createServer((req,res)=>handle(req,res).catch(err=>respondToError(req,res,err)));
  server.requestTimeout=30_000;server.headersTimeout=35_000;server.keepAliveTimeout=5_000;
  const workerPoll=setInterval(wakeBackgroundWorker,2_000);workerPoll.unref();server.on('close',()=>clearInterval(workerPoll));
  if(productionVerification.enabled)setTimeout(()=>withSystemDatabase(()=>runProductionVerification()).catch(error=>{productionVerification.status='failed';productionVerification.errors.unexpected=error.message}),250).unref();
  return server;
}

const handle=(req,res)=>withSystemDatabase(()=>handleRaw(req,res));
export {handle,requiredPermission};

// Only bind a port when started as a program, so tests can drive the handler
// without a listening socket or a process-wide side effect.
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href){
  createServer().listen(port,'0.0.0.0',()=>console.log(`Alhijrah Caseflow ${version} listening on ${port}`));
}
