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
const US_CITY_STATE_ZIP_RE = /^\s*([A-Za-z .'-]{2,}),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/i;
const STREET_RE = /^\s*\d{1,6}\s+[A-Za-z0-9 .#'/-]{2,}(?:\b(?:ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|BLVD|BOULEVARD|LN|LANE|CT|COURT|PKWY|PARKWAY|HWY|HIGHWAY|WAY|PL|PLACE|TER|TERRACE)\b.*)$/i;

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
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
    const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
    if (y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    return null;
  }
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!m) return null;
  const mo = Number(m[1]); const d = Number(m[2]); const y = Number(m[3]);
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function labeled(lines: string[], aliases: string[]) {
  const escaped = aliases.map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`^(?:${escaped})\\s*[:：-]\\s*(.+)$`, "i");
  for (const line of lines) {
    const match = line.match(re);
    if (match?.[1]) return clean(match[1]);
  }
  return null;
}

function likelyNameLine(lines: string[]) {
  for (const line of lines.slice(0, 5)) {
    const candidate = clean(line);
    if (candidate.length < 4 || candidate.length > 120) continue;
    if (/[@\d:]/.test(candidate)) continue;
    if (/^(client|customer|phone|mobile|email|dob|date of birth|address|street|city|state|zip|notes?|shift|site)\b/i.test(candidate)) continue;
    const tokens = candidate.split(/\s+/);
    if (tokens.length >= 2 && tokens.length <= 8) return candidate;
  }
  return null;
}

function add(row: IntakeRow, evidence: LocalEvidence[], field: keyof IntakeRow, value: string | null, strength: LocalStrength, ref: string | null) {
  if (!value) return;
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

export function extractDeterministicClient(raw: string): LocalExtraction {
  const text = raw.replace(/\r/g, "").trim();
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const row: IntakeRow = {};
  const evidence: LocalEvidence[] = [];
  if (!text) return { row, evidence, display_name: null };

  const name = labeled(lines, ["full name", "name", "client name", "الاسم", "الاسم الكامل"]) ?? likelyNameLine(lines);
  add(row, evidence, "full_name", name, labeled(lines, ["full name", "name", "client name", "الاسم", "الاسم الكامل"]) ? "HIGH" : "MEDIUM", name);

  const labeledPhone = labeled(lines, ["phone", "mobile", "cell", "telephone", "رقم الهاتف", "الهاتف"]);
  const phoneMatch = labeledPhone?.match(PHONE_RE)?.[0] ?? text.match(PHONE_RE)?.[0] ?? null;
  const phone = phoneMatch ? normalizeUsPhone(phoneMatch) : null;
  add(row, evidence, "phone", phone, labeledPhone ? "HIGH" : "MEDIUM", phoneMatch);

  const labeledEmail = labeled(lines, ["email", "e-mail", "البريد", "البريد الإلكتروني", "ايميل", "إيميل"]);
  const emailMatch = labeledEmail?.match(EMAIL_RE)?.[0] ?? text.match(EMAIL_RE)?.[0] ?? null;
  add(row, evidence, "email", emailMatch ? normalizeEmail(emailMatch) : null, labeledEmail ? "HIGH" : "MEDIUM", emailMatch);

  const dobRaw = labeled(lines, ["dob", "date of birth", "birth date", "تاريخ الميلاد"]);
  const dob = dobRaw ? parseDate(dobRaw) : null;
  add(row, evidence, "date_of_birth", dob, dob ? "HIGH" : "REVIEW", dobRaw);

  const streetLabeled = labeled(lines, ["street", "address", "street address", "العنوان"]);
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

  add(row, evidence, "preferred_language", labeled(lines, ["preferred language", "language", "اللغة"]), "HIGH", null);
  add(row, evidence, "appointment_availability", labeled(lines, ["appointment availability", "availability", "available", "المواعيد", "موعد"]), "MEDIUM", null);
  add(row, evidence, "site_code", labeled(lines, ["site", "site code", "preferred location", "location", "الموقع"]), "REVIEW", null);
  add(row, evidence, "job_id", labeled(lines, ["job id", "job", "amazon job id"]), "REVIEW", null);
  add(row, evidence, "shift_code", labeled(lines, ["shift", "desired shift", "الشفت", "الوردية"]), "REVIEW", null);
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
