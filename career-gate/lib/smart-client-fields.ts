import { LANGUAGES } from "@/lib/domain";
import { ENGLISH_PROFICIENCY_VALUES } from "@/lib/schemas";

export type SmartLanguageCode = keyof typeof LANGUAGES;
export type EnglishProficiency = (typeof ENGLISH_PROFICIENCY_VALUES)[number];
export const SHIFT_DAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
export type ShiftDayCode = (typeof SHIFT_DAY_CODES)[number];

const LANGUAGE_ALIASES: Record<string, SmartLanguageCode> = {
  en: "en", english: "en", "الانجليزية": "en", "الإنجليزية": "en",
  ar: "ar", arabic: "ar", "عربي": "ar", "العربية": "ar",
  es: "es", spanish: "es", "español": "es", espanol: "es",
};

export function normalizeImportLanguage(value: string | null | undefined): SmartLanguageCode | null {
  const v = value?.normalize("NFKC").trim().toLowerCase();
  if (!v) return null;
  const direct = LANGUAGE_ALIASES[v];
  if (direct) return direct;
  return Object.prototype.hasOwnProperty.call(LANGUAGES, v) ? (v as SmartLanguageCode) : null;
}

export function normalizeEnglishProficiency(value: string | null | undefined): EnglishProficiency | null {
  const v = value?.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  if (!v) return null;
  if (["excellent", "fluent", "fluently", "very good", "very good english", "speaks english fluently", "ممتاز", "طليق", "طلاقة"].includes(v)) return "EXCELLENT";
  if (["good", "speaks english well", "جيد", "جيد جدا", "جيد جداً"].includes(v)) return "GOOD";
  if (["fair", "intermediate", "some english", "متوسط", "مقبول", "انجليزي متوسط", "إنجليزي متوسط"].includes(v)) return "FAIR";
  if (["weak", "basic", "limited english", "ضعيف", "محدود", "انجليزي محدود", "إنجليزي محدود"].includes(v)) return "WEAK";
  if (["none", "no english", "does not speak english", "بدون انجليزي", "بدون إنجليزي", "لا يتحدث الانجليزية", "لا يتحدث الإنجليزية"].includes(v)) return "NONE";
  const upper = v.toUpperCase();
  return (ENGLISH_PROFICIENCY_VALUES as readonly string[]).includes(upper) ? (upper as EnglishProficiency) : null;
}

const DAY_ALIAS: Record<string, ShiftDayCode> = {
  sun: "SUN", sunday: "SUN",
  mon: "MON", monday: "MON",
  tue: "TUE", tues: "TUE", tuesday: "TUE",
  wed: "WED", wednesday: "WED",
  thu: "THU", thur: "THU", thurs: "THU", thursday: "THU",
  fri: "FRI", friday: "FRI",
  sat: "SAT", saturday: "SAT",
};

function dayIndex(day: ShiftDayCode) {
  return SHIFT_DAY_CODES.indexOf(day);
}

export function normalizeShiftDays(value: string | readonly string[] | null | undefined): ShiftDayCode[] | null {
  if (Array.isArray(value)) {
    const out = value.map((item) => DAY_ALIAS[String(item).trim().toLowerCase()] ?? String(item).trim().toUpperCase())
      .filter((item): item is ShiftDayCode => (SHIFT_DAY_CODES as readonly string[]).includes(item));
    return out.length ? [...new Set(out)] : null;
  }
  const raw = String(value ?? "").normalize("NFKC").trim().toLowerCase();
  if (!raw) return null;
  const range = raw.match(/^([a-z]+)\s*(?:-|–|—|through|to)\s*([a-z]+)$/i);
  if (range) {
    const start = DAY_ALIAS[range[1].toLowerCase()];
    const end = DAY_ALIAS[range[2].toLowerCase()];
    if (!start || !end) return null;
    const out: ShiftDayCode[] = [];
    let i = dayIndex(start);
    const endIndex = dayIndex(end);
    for (let guard = 0; guard < 7; guard += 1) {
      out.push(SHIFT_DAY_CODES[i]);
      if (i === endIndex) return out;
      i = (i + 1) % 7;
    }
    return null;
  }
  const tokens = raw.split(/[,/&+]|\s+/).map((v) => v.trim()).filter(Boolean);
  const out = tokens.map((token) => DAY_ALIAS[token]).filter((item): item is ShiftDayCode => Boolean(item));
  return out.length ? [...new Set(out)] : null;
}

export function normalizeShiftTime(value: string | null | undefined): string | null {
  const raw = value?.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");
  if (!raw) return null;
  let match = raw.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2] ?? "0");
    if (hour < 1 || hour > 12 || minute > 59) return null;
    if (match[3] === "am") hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseShiftRange(value: string | null | undefined) {
  const raw = value?.normalize("NFKC").trim();
  if (!raw) return null;
  const parts = raw.split(/\s*(?:-|–|—|to)\s*/i);
  if (parts.length !== 2) return null;
  const start = normalizeShiftTime(parts[0]);
  const end = normalizeShiftTime(parts[1]);
  return start && end ? { start, end, overnight: end <= start } : null;
}
