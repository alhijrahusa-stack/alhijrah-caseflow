/** Conservative, deterministic identity parsing: missing/unverified facts remain blank. */
import { parseMrz } from "@/lib/mrz";
export type OcrLine = { text: string; score: number };
export type OcrCandidate = { row: Record<string, string>; confidence: Record<string, number>; provenance: Record<string, string> };
const compact = (v: string) => v.replace(/\s+/g, " ").trim();
const nameText = (v: string) => /^[A-Za-z][A-Za-z ,.'-]{1,100}$/.test(v) && !/^(USCIS|USA|UNITED STATES|PERMANENT RESIDENT|CARD|IDENTIFICATION|DOCUMENT)$/i.test(v);
function isoDate(value: string): string | null {
  const v = value.trim();
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
  const y = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(v);
  if (!m && !y) return null;
  const yy=Number(y ? y[1]:m![3]), mm=Number(y ? y[2]:m![1]), dd=Number(y ? y[3]:m![2]);
  const date=new Date(Date.UTC(yy,mm-1,dd));
  return date.getUTCFullYear()===yy && date.getUTCMonth()===mm-1 && date.getUTCDate()===dd
    ? [String(yy).padStart(4,"0"),String(mm).padStart(2,"0"),String(dd).padStart(2,"0")].join("-") : null;
}
export function parseIdentityLines(lines: readonly OcrLine[]): OcrCandidate {
  const row: Record<string,string>={}, confidence: Record<string,number>={}, provenance: Record<string,string>={};
  const normalized=lines.map(l=>({text:compact(l.text),score:Math.max(0,Math.min(1,l.score))})).filter(l=>l.text);
  function set(key:string,value:string|null,source:string,score:number) {
    if(!value || row[key] || score < 0.5 || value.length>150) return;
    row[key]=value; confidence[key]=score; provenance[key]=source;
  }

  /*
   * The machine readable zone first.
   *
   * A passport, a Permanent Resident Card and an Employment Authorization Document
   * carry their key facts in an MRZ band with a check digit over every field and one
   * over the record. The label patterns below cannot read those documents at all —
   * the band has no printed labels — and a check digit is arithmetic rather than a
   * confidence score, so a band that verifies is the best evidence on the page.
   *
   * It runs before every other rule because `set` keeps the first value it is given,
   * and a verified field must not lose to a label guess. A band whose check digits
   * fail contributes nothing: it is reported by the caller, never repaired here.
   */
  const mrz = parseMrz(normalized.map(l=>l.text).join("\n"));
  if (mrz && mrz.verified) {
    const band = `${mrz.format} machine readable zone, check digits verified`;
    // Confidence 1 records that arithmetic established this, not that a model was
    // confident. Only fields the band's own check digits cover are set this way.
    if (mrz.full_name) set("full_name", mrz.full_name, band, 1);
    if (mrz.verified_fields.includes("date_of_birth") && mrz.date_of_birth) {
      set("date_of_birth", mrz.date_of_birth, band, 1);
    }
    if (mrz.verified_fields.includes("expiration_date") && mrz.expiration_date) {
      set("expiration_date", mrz.expiration_date, band, 1);
    }
  }
  const labels: Record<string,RegExp> = {
    full_name:/^(?:FULL\s*NAME|CARDHOLDER(?:\s+NAME)?|NAME)\s*[:#-]\s*([A-Za-z][A-Za-z ,.'-]{1,100})$/i,
    date_of_birth:/^(?:DATE\s+OF\s+BIRTH|BIRTH\s*DATE|DOB|DBB)\s*[:#-]?\s*([\d/-]{8,10})$/i,
    expiration_date:/^(?:CARD\s*EXPIRES|EXPIRATION\s*DATE|EXPIRY\s*DATE|EXPIRES|EXP)\s*[:#-]?\s*([\d/-]{8,10})$/i,
    document_number:/^(?:DOCUMENT\s*(?:NO|NUMBER|#)|CARD\s*(?:NO|NUMBER|#)|PASSPORT\s*(?:NO|NUMBER|#))\s*[:#-]?\s*([A-Z0-9]{6,15})$/i,
    street:/^(?:STREET|ADDRESS)\s*[:#-]\s*(\d{1,7}\s+.{3,90})$/i,
    city:/^CITY\s*[:#-]\s*([A-Za-z '-]{2,60})$/i,
    state:/^STATE\s*[:#-]\s*([A-Z]{2})$/i,
    zip:/^(?:ZIP|POSTAL\s*CODE)\s*[:#-]\s*(\d{5}(?:-\d{4})?)$/i,
  };
  for(const l of normalized) for(const [key,regex] of Object.entries(labels)) {
    const match=regex.exec(l.text); if(!match) continue;
    const value = key.endsWith("date") || key==="date_of_birth" ? isoDate(match[1]) : compact(match[1]);
    set(key, key==="full_name" && value && !nameText(value) ? null : value, l.text, l.score);
  }
  const aliases:Record<string,RegExp> = {
    last:/^(?:SURNAME|LAST\s*NAME|FAMILY\s*NAME)\s*[:#-]?$/i,
    first:/^(?:GIVEN\s*NAMES?|FIRST\s*NAME)\s*[:#-]?$/i,
    dob:/^(?:DATE\s*OF\s*BIRTH|BIRTH\s*DATE|DOB|DBB)\s*[:#-]?$/i,
    exp:/^(?:EXPIRES|EXPIRATION\s*DATE|CARD\s*EXPIRES|EXP)\s*[:#-]?$/i,
  };
  const values:Record<string,{value:string;score:number;source:string}|undefined>={};
  for(let i=0;i<normalized.length-1;i++) {
    const label=normalized[i], next=normalized[i+1];
    for(const [key,regex] of Object.entries(aliases)) {
      if(!regex.test(label.text)) continue;
      const value=key==="dob"||key==="exp" ? isoDate(next.text) : nameText(next.text)?next.text:null;
      if(value && next.score>=0.5) values[key] ??= {value,score:Math.min(label.score,next.score),source:label.text+" → "+next.text};
    }
  }
  if(values.first && values.last) set("full_name",values.first.value+" "+values.last.value,values.first.source+"; "+values.last.source,Math.min(values.first.score,values.last.score));
  if(values.dob) set("date_of_birth",values.dob.value,values.dob.source,values.dob.score);
  if(values.exp) set("expiration_date",values.exp.value,values.exp.source,values.exp.score);
  return {row,confidence,provenance};
}
