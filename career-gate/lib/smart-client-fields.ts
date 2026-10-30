import { ENGLISH_PROFICIENCY_VALUES, LANGUAGES } from "@/lib/domain";

export type SmartLanguageCode = keyof typeof LANGUAGES;
export type EnglishProficiency = (typeof ENGLISH_PROFICIENCY_VALUES)[number];
export const SHIFT_DAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
export type ShiftDayCode = (typeof SHIFT_DAY_CODES)[number];

const SMART_SOURCE_FIELD_KEYS: Readonly<Record<string, string>> = {
  site_code: "preferred_location",
  alt_site_code: "location_option_1",
  backup_site_code: "location_option_2",
  shift_code: "preferred_shift",
};

export function canonicalSmartFieldKey(value: unknown): string {
  const key = String(value ?? "");
  return Object.prototype.hasOwnProperty.call(SMART_SOURCE_FIELD_KEYS, key) ? SMART_SOURCE_FIELD_KEYS[key] : key;
}

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

const DATE_SEPARATOR = String.raw`[-/.]`;
const ISO_DATE_RE = new RegExp(`^(\\d{4})${DATE_SEPARATOR}(\\d{1,2})${DATE_SEPARATOR}(\\d{1,2})$`);
const US_DATE_RE = new RegExp(`^(\\d{1,2})${DATE_SEPARATOR}(\\d{1,2})${DATE_SEPARATOR}(\\d{4})$`);

/**
 * Canonical Smart-path date normalizer. Accepts YYYY-MM-DD and US MM/DD/YYYY only and
 * validates the real calendar date, so DD/MM/YYYY is never reinterpreted as a US date.
 */
export function normalizeSmartDate(value: string | null | undefined): string | null {
  const raw = value?.normalize("NFKC").trim();
  if (!raw) return null;
  const iso = raw.match(ISO_DATE_RE);
  const us = iso ? null : raw.match(US_DATE_RE);
  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : us
      ? { year: Number(us[3]), month: Number(us[1]), day: Number(us[2]) }
      : null;
  if (!parts) return null;
  const { year, month, day } = parts;
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const exact = new Date(Date.UTC(year, month - 1, day));
  if (exact.getUTCFullYear() !== year || exact.getUTCMonth() !== month - 1 || exact.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeEnglishProficiency(value: string | null | undefined): EnglishProficiency | null {
  const raw = value?.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  if (!raw) return null;

  // Bounded corrections for observed source typos only. Do not use broad fuzzy matching.
  const v = raw
    .replace(/\benglis\b/g, "english")
    .replace(/\bgoog\b/g, "good");

  if (["excellent", "fluent", "fluently", "very good", "very good english", "speaks english fluently", "english is excellent", "native-level english", "ممتاز", "طليق", "طلاقة"].includes(v)) return "EXCELLENT";
  if (["good", "speaks english well", "english is good", "english good", "good english", "جيد", "جيد جدا", "جيد جداً"].includes(v)) return "GOOD";
  if (["fair", "intermediate", "some english", "متوسط", "مقبول", "انجليزي متوسط", "إنجليزي متوسط"].includes(v)) return "FAIR";
  if (["weak", "basic", "limited english", "poor english", "english is weak", "ضعيف", "محدود", "انجليزي محدود", "إنجليزي محدود"].includes(v)) return "WEAK";
  if (["none", "no english", "does not speak english", "zero english", "بدون انجليزي", "بدون إنجليزي", "لا يتحدث الانجليزية", "لا يتحدث الإنجليزية"].includes(v)) return "NONE";
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
  // Arabic day names, with and without the definite article, as they are written
  // and as they are dictated.
  "الاحد": "SUN", "الأحد": "SUN", "احد": "SUN", "أحد": "SUN", "اليوم الاحد": "SUN",
  "الاثنين": "MON", "الإثنين": "MON", "اثنين": "MON", "إثنين": "MON",
  "الثلاثاء": "TUE", "ثلاثاء": "TUE",
  "الاربعاء": "WED", "الأربعاء": "WED", "اربعاء": "WED", "أربعاء": "WED",
  "الخميس": "THU", "خميس": "THU",
  "الجمعة": "FRI", "الجمعه": "FRI", "جمعة": "FRI", "جمعه": "FRI",
  "السبت": "SAT", "سبت": "SAT",
};

/** Arabic day names, longest-first, for scanning free text. */
export const ARABIC_DAY_WORDS: readonly string[] = Object.keys(DAY_ALIAS)
  .filter((key) => /[\u0600-\u06FF]/.test(key))
  .sort((a, b) => b.length - a.length);

/** Range and list connectors as Arabic writes them. */
const ARABIC_RANGE_RE = /\s*(?:-|–|—|إلى|الى|حتى|لغاية|لحد)\s*/g;
const ARABIC_LIST_RE = /\s*(?:,|،|\/|&|\+)\s*|\s+و\s+|\s+و(?=[\u0600-\u06FF])/g;

function dayIndex(day: ShiftDayCode) {
  return SHIFT_DAY_CODES.indexOf(day);
}

export function normalizeShiftDays(value: string | readonly string[] | null | undefined): ShiftDayCode[] | null {
  if (Array.isArray(value)) {
    const out = value.map((item) => DAY_ALIAS[String(item).trim().toLowerCase()] ?? String(item).trim().toUpperCase())
      .filter((item): item is ShiftDayCode => (SHIFT_DAY_CODES as readonly string[]).includes(item));
    return out.length ? [...new Set(out)] : null;
  }
  const raw = String(value ?? "").normalize("NFKC").trim().toLowerCase()
    // "من الجمعة إلى الاثنين" is the same range as "friday-monday".
    .replace(/^من\s+/, "")
    .replace(ARABIC_RANGE_RE, "-")
    .replace(/^-|-$/g, "")
    .trim();
  if (!raw) return null;
  if (/^weekdays?$|^أيام\s*العمل$|^ايام\s*العمل$/.test(raw)) return ["MON", "TUE", "WED", "THU", "FRI"];
  if (/^(?:نهاية\s*الأسبوع|نهاية\s*الاسبوع)$/.test(raw)) return ["SAT", "SUN"];
  if (/^(?:يوميا|يومياً|كل\s*يوم|كل\s*الأيام|كل\s*الايام)$/.test(raw)) return ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  if (/^weekends?$/.test(raw)) return ["SAT", "SUN"];
  if (/^(?:daily|every\s*day|all\s*days)$/.test(raw)) return ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const range = raw.match(/^(\p{L}+(?:\s\p{L}+)?)\s*(?:-|–|—|through|thru|to)\s*(\p{L}+(?:\s\p{L}+)?)$/iu);
  const rangeStart = range ? DAY_ALIAS[range[1].toLowerCase()] : undefined;
  const rangeEnd = range ? DAY_ALIAS[range[2].toLowerCase()] : undefined;
  if (rangeStart && rangeEnd) {
    const out: ShiftDayCode[] = [];
    let i = dayIndex(rangeStart);
    const endIndex = dayIndex(rangeEnd);
    for (let guard = 0; guard < 7; guard += 1) {
      out.push(SHIFT_DAY_CODES[i]);
      if (i === endIndex) return out;
      i = (i + 1) % 7;
    }
  }
  const tokens = raw.replace(ARABIC_LIST_RE, ",").split(/[,/&+]|\s+/).map((v) => v.trim()).filter(Boolean);
  const out = tokens.map((token) => DAY_ALIAS[token]).filter((item): item is ShiftDayCode => Boolean(item));
  return out.length ? [...new Set(out)] : null;
}

/* --- Arabic clock readings -------------------------------------------------- *
 * Dictated and handwritten Arabic states the hour as a word, the minutes as a
 * fraction of it, and the half of the day as a separate word. Each part is read
 * exactly; a reading with no recognizable hour word returns null rather than a
 * guess.
 * -------------------------------------------------------------------------- */

/** Arabic-Indic and extended Arabic-Indic digits, which NFKC leaves alone. */
const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

function foldArabicDigits(value: string) {
  return value.replace(ARABIC_DIGITS, (digit) => {
    const code = digit.codePointAt(0)!;
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/** Hour words, longest first so "الثانية عشرة" is never read as "الثانية". */
const ARABIC_HOUR_WORDS: readonly { words: readonly string[]; hour: number }[] = [
  { words: ["الثانية عشرة", "الثانية عشر", "ثانية عشرة", "ثانية عشر", "اثنتا عشرة", "اثنتي عشرة"], hour: 12 },
  { words: ["الحادية عشرة", "الحادية عشر", "حادية عشرة", "حادية عشر", "احدى عشرة", "إحدى عشرة"], hour: 11 },
  { words: ["العاشرة", "عاشرة"], hour: 10 },
  { words: ["التاسعة", "تاسعة"], hour: 9 },
  { words: ["الثامنة", "ثامنة"], hour: 8 },
  { words: ["السابعة", "سابعة"], hour: 7 },
  { words: ["السادسة", "سادسة"], hour: 6 },
  { words: ["الخامسة", "خامسة"], hour: 5 },
  { words: ["الرابعة", "رابعة"], hour: 4 },
  { words: ["الثالثة", "ثالثة"], hour: 3 },
  { words: ["الثانية", "ثانية"], hour: 2 },
  { words: ["الواحدة", "واحدة", "الحادية", "حادية"], hour: 1 },
];

/** Minute fractions, longest first; a subtractive fraction is explicit. */
const ARABIC_FRACTIONS: readonly { words: readonly string[]; minutes: number }[] = [
  { words: ["الا ربع", "إلا ربع", "ناقص ربع"], minutes: -15 },
  { words: ["الا ثلث", "إلا ثلث", "ناقص ثلث"], minutes: -20 },
  { words: ["الا عشرة", "إلا عشرة", "ناقص عشرة"], minutes: -10 },
  { words: ["الا خمس", "إلا خمس", "ناقص خمس"], minutes: -5 },
  { words: ["والنصف", "و النصف", "ونصف", "و نصف"], minutes: 30 },
  { words: ["والربع", "و الربع", "وربع", "و ربع"], minutes: 15 },
  { words: ["والثلث", "و الثلث", "وثلث", "و ثلث"], minutes: 20 },
  { words: ["وعشرة", "و عشرة"], minutes: 10 },
  { words: ["وخمس دقائق", "وخمسة", "و خمس"], minutes: 5 },
];

/** Which half of the day the reading belongs to, or null when it is not stated. */
const ARABIC_MERIDIEM: readonly { words: readonly string[]; meridiem: "am" | "pm" }[] = [
  { words: ["بعد الظهر", "بعد الظهير", "العصر", "عصرا", "عصراً", "عصرًا"], meridiem: "pm" },
  { words: ["مساء", "مساءً", "مساءا", "مساءٔ", "المساء", "ليلا", "ليلاً", "ليلًا", "الليل", "ليلي"], meridiem: "pm" },
  { words: ["صباحا", "صباحاً", "صباحًا", "الصباح", "صباح", "فجرا", "فجراً", "فجرًا", "الفجر"], meridiem: "am" },
  { words: ["ظهرا", "ظهراً", "ظهرًا", "الظهر"], meridiem: "pm" },
];

/**
 * An Arabic clock reading, or null when the text states no hour.
 *
 * The half of the day is required for an hour of 1–11: without it the reading is
 * genuinely ambiguous, and a shift at 06:00 and one at 18:00 are not the same, so
 * nothing is written. An hour of 12 is unambiguous enough to default to noon only
 * when the text says so.
 */
export function normalizeArabicTime(value: string | null | undefined): string | null {
  const raw = foldArabicDigits(String(value ?? "").normalize("NFKC"))
    .replace(/[ً-ْٰ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!raw) return null;

  let meridiem: "am" | "pm" | null = null;
  for (const entry of ARABIC_MERIDIEM) {
    if (entry.words.some((word) => raw.includes(word.replace(/[ً-ْٰ]/g, "")))) {
      meridiem = entry.meridiem;
      break;
    }
  }

  let minutes: number | null = null;
  for (const entry of ARABIC_FRACTIONS) {
    if (entry.words.some((word) => raw.includes(word))) {
      minutes = entry.minutes;
      break;
    }
  }

  let hour: number | null = null;
  for (const entry of ARABIC_HOUR_WORDS) {
    if (entry.words.some((word) => raw.includes(word))) {
      hour = entry.hour;
      break;
    }
  }
  if (hour == null) {
    // A bare numeral with an Arabic half-of-day word, e.g. "6 مساءً".
    const numeral = raw.match(/\b(\d{1,2})(?::(\d{2}))?\b/);
    if (!numeral || !meridiem) return null;
    hour = Number(numeral[1]);
    if (numeral[2] != null) minutes = Number(numeral[2]);
    if (hour < 1 || hour > 12) return null;
  }
  if (meridiem == null) return null;

  let total = (hour % 12) * 60 + (minutes ?? 0);
  if (meridiem === "pm") total += 12 * 60;
  total = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (m % 1 !== 0) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function normalizeShiftTime(value: string | null | undefined): string | null {
  const source = foldArabicDigits(String(value ?? "").normalize("NFKC"));
  // Arabic states the hour as a word, so it must be read before spaces are stripped.
  if (/[\u0600-\u06FF]/.test(source)) {
    const arabic = normalizeArabicTime(source);
    if (arabic) return arabic;
  }
  const raw = source.trim().toLowerCase().replace(/\s+/g, "");
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
  const raw = String(value ?? "").normalize("NFKC").trim().replace(/^من\s+/, "");
  if (!raw) return null;
  const parts = raw.split(/\s*(?:-|–|—|to|till|until|through|thru|إلى|الى|حتى|لغاية)\s*/i);
  if (parts.length !== 2) return null;
  const start = normalizeShiftTime(parts[0]);
  const end = normalizeShiftTime(parts[1]);
  return start && end ? { start, end, overnight: end <= start } : null;
}

/**
 * Whether a shift crosses midnight. Derived from the two canonical times, so it
 * is never a stored third copy of the same fact and cannot disagree with them.
 * Null when either end is unknown — an unknown range is not an on-shift claim.
 */
export function isOvernightShift(start: string | null | undefined, end: string | null | undefined): boolean | null {
  const from = normalizeShiftTime(start);
  const to = normalizeShiftTime(end);
  if (!from || !to) return null;
  return to <= from;
}
