import type { IntakeRow } from "@/lib/intake-file";

export type LocalStrength = "HIGH" | "MEDIUM" | "REVIEW";
export type LocalEvidence = {
  field_key: string;
  value: string;
  source_type: "local_text";
  verification_state: "MATCHED" | "REVIEW";
  strength: LocalStrength;
  source_text_reference: string | null;
};

export type LocalExtraction = {
  row: IntakeRow;
  evidence: LocalEvidence[];
  display_name: string | null;
};

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_RE = /(?:\+?1[\s().-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}\b/;
const ZIP_RE = /\b\d{5}(?:-\d{4})?\b/;
const DATE_TOKEN_RE = /\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})\b/;
const US_CITY_STATE_ZIP_RE = /^\s*([A-Za-z .'-]{2,}),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/i;
const STREET_RE = /^\s*\d{1,6}\s+[A-Za-z0-9 .#'/-]{2,}(?:\b(?:ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|BLVD|BOULEVARD|LN|LANE|CT|COURT|PKWY|PARKWAY|HWY|HIGHWAY|WAY|PL|PLACE|TER|TERRACE|CIR|CIRCLE)\b.*)$/i;
const URL_RE = /(?:https?:\/\/|www\.|wa\.me\/)/i;
const NON_NAME_TERMS_RE = /\b(?:night|morning|evening|afternoon|available|availability|english|arabic|spanish|yes|no|true|false|amazon|warehouse|shift|site|job|client|customer|application|resume|passport|license|address|street|city|state|zip|phone|email)\b/i;
const LABEL_PREFIX_RE = /^(?:full\s*name|name|client\s*name|phone|mobile|cell|telephone|email|e-mail|dob|date\s*of\s*birth|birth\s*date|street|address|street\s*address|city|state|zip|zip\s*code|postal\s*code|preferred\s*language|language|english\s*(?:proficiency|level)|appointment\s*availability|availability|available|site|site\s*code|preferred\s*location|location|job|job\s*id|amazon\s*job\s*id|shift|desired\s*shift|shift\s*days|shift\s*start|shift\s*end|backup\s*site|backup\s*location|backup\s*job\s*id|backup\s*shift|amazon\s*application\s*email|amazon\s*worked\s*before|amazon\s*applied\s*before|currently\s*amazon|via\s*agency|company|employer|job\s*title|employment\s*from|employment\s*to|employment\s*kind|notes?|الاسم|الاسم\s*الكامل|رقم\s*الهاتف|الهاتف|البريد|البريد\s*الإلكتروني|ايميل|إيميل|تاريخ\s*الميلاد|العنوان|المدينة|الولاية|الرمز\s*البريدي|اللغة|مستوى\s*الإنجليزية|مستوى\s*الانجليزية|المواعيد|موعد|الموقع|الشفت|الوردية|أيام\s*الشفت|ايام\s*الشفت|بداية\s*الشفت|نهاية\s*الشفت)\b/i;

function clean(value: string) {
  return value.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

function normalizeUsPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length === 10 ? digits : null;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function parseDate(value: string) {
  const v = value.trim();
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (y >= 1900 && y <= 2100 && date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d) {
      return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    return null;
  }
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  const y = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1900 || y > 2100 || date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function explodeSource(raw: string) {
  return raw
    .replace(/\r/g, "\n")
    .split(/\n|\s*[|•·]\s*|\s+;\s+/)
    .map(clean)
    .filter(Boolean);
}

function labeled(lines: string[], aliases: string[]) {
  const escaped = aliases.map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`^(?:${escaped})\\s*[:：=\\-]\\s*(.+)$`, "i");
  for (const line of lines) {
    const match = line.match(re);
    if (match?.[1]) return clean(match[1]);
  }
  return null;
}

function scoreNameCandidate(line: string, index: number) {
  const candidate = clean(line);
  if (candidate.length < 4 || candidate.length > 120) return -1;
  if (EMAIL_RE.test(candidate) || PHONE_RE.test(candidate) || DATE_TOKEN_RE.test(candidate) || ZIP_RE.test(candidate)) return -1;
  if (STREET_RE.test(candidate) || US_CITY_STATE_ZIP_RE.test(candidate) || URL_RE.test(candidate)) return -1;
  if (LABEL_PREFIX_RE.test(candidate) || NON_NAME_TERMS_RE.test(candidate)) return -1;
  if (/[:=@]/.test(candidate) || /\d/.test(candidate)) return -1;
  if (!/^[\p{L} .'-]+$/u.test(candidate)) return -1;

  const tokens = candidate.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 8) return -1;

  let score = 0;
  score += Math.min(tokens.length, 5) * 10;
  if (tokens.length >= 3 && tokens.length <= 6) score += 25;
  if (candidate === candidate.toUpperCase() && /[A-Z]/.test(candidate)) score += 12;
  if (tokens.every((token) => token.length >= 2)) score += 10;
  if (candidate.length >= 8 && candidate.length <= 70) score += 8;
  if (index <= 2) score += 4;
  if (/[A-Za-z]/.test(candidate) && /^[A-Za-z .'-]+$/.test(candidate)) score += 4;
  return score;
}

function likelyNameLine(lines: string[]) {
  const ranked = lines
    .map((line, index) => ({ line: clean(line), index, score: scoreNameCandidate(line, index) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index || a.line.length - b.line.length);
  return ranked[0]?.line ?? null;
}

function uniqueDateFromText(lines: string[]) {
  const candidates = new Set<string>();
  for (const line of lines) {
    for (const match of line.matchAll(new RegExp(DATE_TOKEN_RE.source, "gi"))) {
      const parsed = parseDate(match[0]);
      if (parsed) candidates.add(parsed);
    }
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

function standaloneLanguage(lines: string[]) {
  for (const line of lines) {
    const v = clean(line).toLowerCase();
    if (["english", "en", "الانجليزية", "الإنجليزية"].includes(v)) return "en";
    if (["arabic", "ar", "عربي", "العربية"].includes(v)) return "ar";
    if (["spanish", "es", "español"].includes(v)) return "es";
  }
  return null;
}

function add(row: IntakeRow, evidence: LocalEvidence[], field: keyof IntakeRow, value: string | null, strength: LocalStrength, ref: string | null) {
  if (!value || (typeof row[field] === "string" && String(row[field]).trim())) return;
  row[field] = value;
  evidence.push({
    field_key: String(field),
    value,
    source_type: "local_text",
    verification_state: strength === "HIGH" ? "MATCHED" : "REVIEW",
    strength,
    source_text_reference: ref,
  });
}

function firstMatch(lines: string[], re: RegExp) {
  for (const line of lines) {
    const match = line.match(re)?.[0];
    if (match) return match;
  }
  return null;
}

export function extractDeterministicClient(raw: string): LocalExtraction {
  const text = raw.replace(/\r/g, "\n").trim();
  const lines = explodeSource(text);
  const row: IntakeRow = {};
  const evidence: LocalEvidence[] = [];
  if (!text) return { row, evidence, display_name: null };

  const labeledName = labeled(lines, ["full name", "name", "client name", "applicant name", "candidate name", "الاسم", "الاسم الكامل"]);
  const name = labeledName ?? likelyNameLine(lines);
  add(row, evidence, "full_name", name, labeledName ? "HIGH" : name ? "MEDIUM" : "REVIEW", name);

  const labeledPhone = labeled(lines, ["phone", "mobile", "cell", "telephone", "phone number", "mobile number", "رقم الهاتف", "الهاتف"]);
  const phoneMatch = labeledPhone?.match(PHONE_RE)?.[0] ?? firstMatch(lines, PHONE_RE);
  const phone = phoneMatch ? normalizeUsPhone(phoneMatch) : null;
  add(row, evidence, "phone", phone, labeledPhone && phone ? "HIGH" : phone ? "MEDIUM" : "REVIEW", phoneMatch);

  const labeledEmail = labeled(lines, ["email", "e-mail", "email address", "البريد", "البريد الإلكتروني", "ايميل", "إيميل"]);
  const emailMatch = labeledEmail?.match(EMAIL_RE)?.[0] ?? firstMatch(lines, EMAIL_RE);
  add(row, evidence, "email", emailMatch ? normalizeEmail(emailMatch) : null, labeledEmail && emailMatch ? "HIGH" : emailMatch ? "MEDIUM" : "REVIEW", emailMatch);

  const dobRaw = labeled(lines, ["dob", "date of birth", "birth date", "birthday", "تاريخ الميلاد"]);
  const dob = dobRaw ? parseDate(dobRaw.match(DATE_TOKEN_RE)?.[0] ?? dobRaw) : uniqueDateFromText(lines);
  add(row, evidence, "date_of_birth", dob, dobRaw && dob ? "HIGH" : dob ? "MEDIUM" : "REVIEW", dobRaw ?? dob);

  const streetLabeled = labeled(lines, ["street", "address", "street address", "home address", "العنوان"]);
  const street = streetLabeled ?? lines.find((line) => STREET_RE.test(line)) ?? null;
  add(row, evidence, "street", street ? clean(street) : null, streetLabeled ? "HIGH" : street ? "MEDIUM" : "REVIEW", street);

  const cityLabeled = labeled(lines, ["city", "المدينة"]);
  const stateLabeled = labeled(lines, ["state", "الولاية"]);
  const zipLabeled = labeled(lines, ["zip", "zip code", "postal code", "الرمز البريدي"]);
  let city = cityLabeled;
  let state = stateLabeled?.toUpperCase() ?? null;
  let zip = zipLabeled?.match(ZIP_RE)?.[0] ?? null;
  if (!city || !state || !zip) {
    const cityLine = lines.map((line) => line.match(US_CITY_STATE_ZIP_RE)).find(Boolean) as RegExpMatchArray | undefined;
    if (cityLine) {
      city ||= clean(cityLine[1]);
      state ||= cityLine[2].toUpperCase();
      zip ||= cityLine[3];
    }
  }
  add(row, evidence, "city", city, cityLabeled ? "HIGH" : city ? "MEDIUM" : "REVIEW", city);
  add(row, evidence, "state", state, stateLabeled ? "HIGH" : state ? "MEDIUM" : "REVIEW", state);
  add(row, evidence, "zip", zip, zipLabeled ? "HIGH" : zip ? "MEDIUM" : "REVIEW", zip);

  const language = labeled(lines, ["preferred language", "language", "اللغة"]) ?? standaloneLanguage(lines);
  add(row, evidence, "preferred_language", language, language ? "HIGH" : "REVIEW", language);
  const proficiency = labeled(lines, ["english proficiency", "english level", "مستوى الانجليزية", "مستوى الإنجليزية"]);
  add(row, evidence, "english_proficiency", proficiency, proficiency ? "HIGH" : "REVIEW", proficiency);
  add(row, evidence, "appointment_availability", labeled(lines, ["appointment availability", "availability", "available", "schedule", "المواعيد", "موعد"]), "MEDIUM", null);
  add(row, evidence, "amazon_worked_before", labeled(lines, ["amazon worked before", "worked at amazon before", "previous amazon"]), "REVIEW", null);
  add(row, evidence, "amazon_worked_from", labeled(lines, ["amazon worked from", "worked from"]), "REVIEW", null);
  add(row, evidence, "amazon_worked_to", labeled(lines, ["amazon worked to", "worked to"]), "REVIEW", null);
  add(row, evidence, "amazon_applied_before", labeled(lines, ["amazon applied before", "applied to amazon before", "applied before"]), "REVIEW", null);
  add(row, evidence, "amazon_application_email", labeled(lines, ["amazon application email", "amazon email"]), "MEDIUM", null);
  add(row, evidence, "currently_amazon", labeled(lines, ["currently amazon", "currently at amazon"]), "REVIEW", null);
  add(row, evidence, "via_agency", labeled(lines, ["via agency", "agency"]), "REVIEW", null);
  add(row, evidence, "employment_kind", labeled(lines, ["employment kind", "employment type"]), "REVIEW", null);
  add(row, evidence, "company", labeled(lines, ["company", "employer", "company name"]), "MEDIUM", null);
  add(row, evidence, "job_title", labeled(lines, ["job title", "title", "position"]), "MEDIUM", null);
  add(row, evidence, "employment_from", labeled(lines, ["employment from", "job from"]), "REVIEW", null);
  add(row, evidence, "employment_to", labeled(lines, ["employment to", "job to"]), "REVIEW", null);
  add(row, evidence, "site_code", labeled(lines, ["site", "site code", "preferred location", "location", "warehouse", "الموقع"]), "REVIEW", null);
  add(row, evidence, "job_id", labeled(lines, ["job id", "job", "amazon job id", "requisition id"]), "REVIEW", null);
  add(row, evidence, "shift_code", labeled(lines, ["shift", "desired shift", "schedule shift", "الشفت", "الوردية"]), "REVIEW", null);
  add(row, evidence, "shift_days", labeled(lines, ["shift days", "work days", "schedule days", "أيام الشفت", "ايام الشفت"]), "REVIEW", null);
  add(row, evidence, "shift_start_time", labeled(lines, ["shift start", "shift start time", "start time", "بداية الشفت"]), "REVIEW", null);
  add(row, evidence, "shift_end_time", labeled(lines, ["shift end", "shift end time", "end time", "نهاية الشفت"]), "REVIEW", null);
  add(row, evidence, "backup_site_code", labeled(lines, ["backup site", "backup location", "location option 2"]), "REVIEW", null);
  add(row, evidence, "backup_job_id", labeled(lines, ["backup job id", "job option 2"]), "REVIEW", null);
  add(row, evidence, "backup_shift_code", labeled(lines, ["backup shift", "shift option 2"]), "REVIEW", null);

  return { row, evidence, display_name: typeof row.full_name === "string" && row.full_name.trim() ? row.full_name.trim() : null };
}

export function localDisplayIdentity(raw: string) {
  const extracted = extractDeterministicClient(raw);
  return extracted.display_name
    ?? (typeof extracted.row.email === "string" ? extracted.row.email : null)
    ?? (typeof extracted.row.phone === "string" ? extracted.row.phone : null);
}
