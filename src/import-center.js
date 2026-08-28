import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';

export const importFields = Object.freeze([
  'first_name','middle_name','last_name','legal_name','legal_name_ar','date_of_birth','gender','nationality','place_of_birth',
  'passport_number','a_number','uscis_account_number','receipt_number','email','phone','whatsapp','physical_address',
  'preferred_language','service_code','workflow_stage','assigned_user_id','priority','operational_notes',
]);

const aliases = Object.freeze({
  first_name:['first name','given name','الاسم الأول'],middle_name:['middle name','الاسم الأوسط'],last_name:['last name','surname','family name','اسم العائلة'],
  legal_name:['full name','full name english','legal name','client name','الاسم بالإنجليزية'],legal_name_ar:['full name arabic','arabic name','الاسم الكامل','الاسم بالعربية'],
  date_of_birth:['dob','date of birth','birth date','تاريخ الميلاد'],gender:['gender','sex','الجنس'],nationality:['nationality','citizenship','الجنسية'],place_of_birth:['country of birth','place of birth','مكان الميلاد','بلد الميلاد'],
  passport_number:['passport number','passport no','passport','رقم الجواز','رقم جواز السفر'],a_number:['a-number','a number','alien number','رقم الأجنبي'],uscis_account_number:['uscis account number','uscis number','رقم حساب uscis'],receipt_number:['receipt number','uscis receipt','رقم الإيصال'],
  email:['email','email address','البريد الإلكتروني'],phone:['phone','mobile','telephone','الهاتف','الجوال'],whatsapp:['whatsapp','واتساب'],physical_address:['address','physical address','العنوان'],
  preferred_language:['preferred language','language','اللغة المفضلة','اللغة'],service_code:['service','case type','service type','الخدمة','نوع الخدمة','نوع الملف'],workflow_stage:['status','case status','الحالة'],assigned_user_id:['assigned staff','assigned to','الموظف المسؤول'],priority:['priority','الأولوية'],operational_notes:['notes','comments','ملاحظات'],
});

const compact = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g,' ');
const key = value => compact(value).toLocaleLowerCase('en-US').replace(/[_.-]+/g,' ');
const only = value => compact(value).toUpperCase().replace(/[^A-Z0-9]/g,'');
const phone = value => { const v=compact(value); if(!v)return null; const digits=v.replace(/\D/g,''); return `${v.startsWith('+')?'+':''}${digits}` || null; };
const date = value => {
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);
  const v=compact(value); if(!v)return null;
  if(/^\d{4}-\d{2}-\d{2}T/.test(v))return validDate(v.slice(0,4),v.slice(5,7),v.slice(8,10));
  let match=v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/); if(match)return validDate(match[1],match[2],match[3]);
  match=v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); if(match)return validDate(match[3],match[1],match[2]);
  return null;
};
function validDate(y,m,d){const text=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const parsed=new Date(`${text}T00:00:00Z`);return Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==text?null:text;}

export function detectMapping(headers){const result={};for(const header of headers){const normalized=key(header);const field=Object.entries(aliases).find(([,values])=>values.some(alias=>key(alias)===normalized))?.[0];if(field&&!result[field])result[field]=header;}return result;}
function cellValue(value){if(value&&typeof value==='object'){if(value.text!==undefined)return value.text;if(value.result!==undefined)return value.result;if(Array.isArray(value.richText))return value.richText.map(item=>item.text).join('');}return value instanceof Date?value:compact(value);}
export async function parseImportFile(buffer,filename){
  const extension=String(filename||'').toLowerCase().split('.').pop();const workbook=new ExcelJS.Workbook();
  if(extension==='csv')await workbook.csv.read(Readable.from(buffer),{parserOptions:{skipEmptyLines:true}});else if(extension==='xlsx')await workbook.xlsx.load(buffer);else throw Object.assign(new Error('IMPORT_FILE_TYPE_NOT_SUPPORTED'),{status:415});
  const sheet=workbook.worksheets[0];if(!sheet)throw Object.assign(new Error('IMPORT_WORKSHEET_EMPTY'),{status:400});const headers=[];sheet.getRow(1).eachCell({includeEmpty:true},(cell,column)=>headers[column-1]=compact(cellValue(cell.value))||`Column ${column}`);
  const rows=[];sheet.eachRow({includeEmpty:false},(row,rowNumber)=>{if(rowNumber===1)return;const source={};headers.forEach((header,index)=>source[header]=cellValue(row.getCell(index+1).value));if(Object.values(source).some(value=>compact(value)))rows.push({source_row_number:rowNumber,source});});
  if(!headers.length||!rows.length)throw Object.assign(new Error('IMPORT_FILE_HAS_NO_DATA_ROWS'),{status:400});if(rows.length>10000)throw Object.assign(new Error('IMPORT_ROW_LIMIT_EXCEEDED'),{status:413});return {headers,rows,mapping:detectMapping(headers)};
}
export function normalizeImportRow(source,mapping,services){
  const raw=Object.fromEntries(importFields.map(field=>[field,source[mapping[field]]]).filter(([,value])=>value!==undefined));const first=compact(raw.first_name),middle=compact(raw.middle_name),last=compact(raw.last_name);const legalName=compact(raw.legal_name)||[first,middle,last].filter(Boolean).join(' ');const serviceValue=compact(raw.service_code);const service=services.find(item=>[item.code,item.name].some(value=>key(value)===key(serviceValue)));
  const normalized={legal_name:legalName||null,legal_name_ar:compact(raw.legal_name_ar)||null,date_of_birth:date(raw.date_of_birth),gender:compact(raw.gender)||null,nationality:compact(raw.nationality)||null,place_of_birth:compact(raw.place_of_birth)||null,passport_number:only(raw.passport_number)||null,a_number:only(raw.a_number)||null,uscis_account_number:only(raw.uscis_account_number)||null,receipt_number:only(raw.receipt_number)||null,email:compact(raw.email).toLowerCase()||null,phone:phone(raw.phone),whatsapp:phone(raw.whatsapp),physical_address:compact(raw.physical_address)||null,preferred_language:/^(arabic|ar|العربية)$/i.test(compact(raw.preferred_language))?'Arabic':'English',service_code:service?.code||null,service_name:service?.name||null,unmapped_service:serviceValue&&!service?serviceValue:null,workflow_stage:normalizeStatus(raw.workflow_stage),assigned_user_id:compact(raw.assigned_user_id)||null,priority:normalizePriority(raw.priority),operational_notes:compact(raw.operational_notes)||null};
  const errors=[],warnings=[];if(!normalized.legal_name&&!normalized.legal_name_ar)errors.push('CLIENT_NAME_REQUIRED');if(raw.date_of_birth&&!normalized.date_of_birth)errors.push('INVALID_DATE_OF_BIRTH');if(normalized.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email))errors.push('INVALID_EMAIL');if(normalized.unmapped_service)errors.push('UNMAPPED_SERVICE');if(normalized.assigned_user_id&&!/^[0-9a-f-]{36}$/i.test(normalized.assigned_user_id)){warnings.push('ASSIGNED_STAFF_REQUIRES_REVIEW');normalized.assigned_user_id=null;}return {normalized,errors,warnings};
}
function normalizeStatus(value){const v=key(value);return ({active:'intake',intake:'intake','قيد الاستقبال':'intake',review:'internal_review','قيد المراجعة':'internal_review',filed:'filed','تم التقديم':'filed',closed:'closed',مغلق:'closed'})[v]||'intake';}
function normalizePriority(value){const v=key(value);return ({low:'low',منخفضة:'low',normal:'normal',عادية:'normal',high:'high',عالية:'high',urgent:'urgent',عاجلة:'urgent'})[v]||'normal';}
const same=(left,right)=>Boolean(left&&right&&key(left)===key(right));
export function classifyDuplicate(row,clients,cases){const n=row.normalized;const exact=clients.find(client=>(n.a_number&&only(client.a_number)===n.a_number)||(n.passport_number&&only(client.passport_number)===n.passport_number)||(n.uscis_account_number&&only(client.uscis_account_number)===n.uscis_account_number));const receipt=n.receipt_number&&cases.find(item=>only(item.receipt_number)===n.receipt_number);if(exact||receipt)return {classification:'exact',client_id:exact?.id||receipt?.client_id||null,case_id:receipt?.id||null,reasons:[exact?'STRONG_CLIENT_IDENTIFIER':'RECEIPT_NUMBER']};const possible=clients.filter(client=>(n.email&&same(client.email,n.email))||(n.phone&&phone(client.phone)===n.phone)||(n.date_of_birth&&client.date_of_birth===n.date_of_birth&&(same(client.legal_name,n.legal_name)||same(client.legal_name_ar,n.legal_name_ar))));return possible.length?{classification:'possible',client_id:null,candidates:possible.slice(0,10).map(item=>({id:item.id,client_number:item.client_number,legal_name:item.legal_name,legal_name_ar:item.legal_name_ar})),reasons:['CONTACT_OR_NAME_DOB']}:{classification:'new',client_id:null,reasons:[]};}
export function analyzeImportRows(rows,mapping,{services,clients,cases}){return rows.map(row=>{const analysis=normalizeImportRow(row.source,mapping,services);const duplicate=classifyDuplicate(analysis,clients,cases);if(duplicate.classification==='possible')analysis.errors.push('POSSIBLE_DUPLICATE_REQUIRES_REVIEW');return {...row,...analysis,duplicate};});}
export function importSummary(rows){return {total:rows.length,valid:rows.filter(row=>!row.validation_errors?.length).length,invalid:rows.filter(row=>row.validation_errors?.length).length,new_clients:rows.filter(row=>row.duplicate_classification==='new').length,existing_clients:rows.filter(row=>row.duplicate_classification==='exact').length,possible_duplicates:rows.filter(row=>row.duplicate_classification==='possible').length,cases_to_create:rows.filter(row=>row.normalized_row?.service_code&&!row.validation_errors?.length).length,unmapped_services:rows.filter(row=>row.normalized_row?.unmapped_service).length};}
export async function buildImportReport(rows,format='csv'){const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('Import Results');sheet.columns=[['Source Row','source_row_number'],['Result','result_status'],['Client Number','client_number'],['Case Number','case_number'],['Warning/Error','message'],['Duplicate/Merge Decision','duplicate_decision'],['Final Service Mapping','service_code']].map(([header,key])=>({header,key,width:26}));rows.forEach(row=>sheet.addRow({source_row_number:row.source_row_number,result_status:row.result_status||row.row_status,client_number:row.result_client_number,case_number:row.result_case_number,message:[...(row.validation_errors||[]),...(row.warnings||[]),row.error_message].filter(Boolean).join('; '),duplicate_decision:row.review_action||row.duplicate_classification,service_code:row.normalized_row?.service_code}));return format==='xlsx'?Buffer.from(await workbook.xlsx.writeBuffer()):Buffer.from(await workbook.csv.writeBuffer());}

export async function verifyImportRuntime(services){
  const csv=Buffer.from('\ufeffFull Name English,الاسم الكامل,DOB,نوع الخدمة,اللغة\nSynthetic Verification,تحقق اصطناعي,1990-01-02,N-400,العربية\n');
  const parsedCsv=await parseImportFile(csv,'synthetic-verification.csv');
  const csvRows=analyzeImportRows(parsedCsv.rows,parsedCsv.mapping,{services,clients:[],cases:[]});
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet('Synthetic');
  sheet.addRow(['Full Name English','الاسم الكامل','DOB','Service','Language']);
  sheet.addRow(['Synthetic XLSX','اختبار إكسل','1991-02-03','I-130','Arabic']);
  const parsedXlsx=await parseImportFile(Buffer.from(await workbook.xlsx.writeBuffer()),'synthetic-verification.xlsx');
  const xlsxRows=analyzeImportRows(parsedXlsx.rows,parsedXlsx.mapping,{services,clients:[],cases:[]});
  const csvOk=csvRows.length===1&&csvRows[0].normalized.service_code==='N-400';
  const xlsxOk=xlsxRows.length===1&&xlsxRows[0].normalized.service_code==='I-130';
  const arabicOk=csvRows[0]?.normalized.legal_name_ar==='تحقق اصطناعي'&&xlsxRows[0]?.normalized.legal_name_ar==='اختبار إكسل'&&csvRows[0]?.normalized.preferred_language==='Arabic';
  if(!csvOk||!xlsxOk||!arabicOk)throw new Error('IMPORT_RUNTIME_VERIFICATION_FAILED');
  return {csv:csvOk,xlsx:xlsxOk,arabic:arabicOk,serviceMapping:true,dryRun:true,canonicalWrites:0};
}
