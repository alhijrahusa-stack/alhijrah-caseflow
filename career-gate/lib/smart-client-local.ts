import type { IntakeRow } from "@/lib/intake-file";
import { ARABIC_DAY_WORDS, normalizeShiftDays, normalizeShiftTime, normalizeSmartDate } from "@/lib/smart-client-fields";

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
const NON_NAME_TERMS_RE = /\b(?:night|morning|evening|afternoon|available|availability|english|arabic|spanish|yes|no|true|false|amazon|warehouse|shift|site|job|client|customer|application|resume|passport|license|address|street|city|state|zip|phone|email|has|have|had|is|are|was|were|the|and|or|with|without|his|her|their|needs|wants|prefers|lives|works|speaks|drives|owns|own|reliable|transportation|vehicle|car)\b/i;
const LABEL_PREFIX_RE = /^(?:full\s*name|name|client\s*name|phone|mobile|cell|telephone|email|e-mail|dob|date\s*of\s*birth|birth\s*date|street|address|street\s*address|city|state|zip|zip\s*code|postal\s*code|preferred\s*language|language|english\s*(?:proficiency|level)|appointment\s*availability|availability|available|site|site\s*code|preferred\s*location|location|job|job\s*id|amazon\s*job\s*id|shift|desired\s*shift|shift\s*days|shift\s*start|shift\s*end|backup\s*site|backup\s*location|backup\s*job\s*id|backup\s*shift|amazon\s*application\s*email|amazon\s*worked\s*before|amazon\s*applied\s*before|currently\s*amazon|via\s*agency|company|employer|job\s*title|employment\s*from|employment\s*to|employment\s*kind|notes?|additional\s*notes?|additional\s*note|extra\s*notes?|other\s*details|الاسم|الاسم\s*الكامل|رقم\s*الهاتف|الهاتف|البريد|البريد\s*الإلكتروني|ايميل|إيميل|تاريخ\s*الميلاد|العنوان|المدينة|الولاية|الرمز\s*البريدي|اللغة|مستوى\s*الإنجليزية|مستوى\s*الانجليزية|المواعيد|موعد|الموقع|الشفت|الوردية|أيام\s*الشفت|ايام\s*الشفت|بداية\s*الشفت|نهاية\s*الشفت|ملاحظات\s*إضافية|ملاحظات\s*اضافية)\b/i;

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
  // A trailing period after a lowercase letter is sentence punctuation, not an initial.
  if (/[\p{Ll}]\.$/u.test(candidate)) return -1;
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
      const parsed = normalizeSmartDate(match[0]);
      if (parsed) candidates.add(parsed);
    }
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

function contextualEnglishProficiency(lines: string[]) {
  const explicit = labeled(lines, ["english proficiency", "english level", "مستوى الانجليزية", "مستوى الإنجليزية"]);
  if (explicit) return explicit;
  const proficiencyContext = /\benglis(?:h)?\b.*\b(?:excellent|fluent|fluently|good|goog|fair|intermediate|weak|limited|poor|none)\b/i;
  const reversedContext = /\b(?:excellent|fluent|fluently|good|goog|fair|intermediate|weak|limited|poor|none)\b.*\benglis(?:h)?\b/i;
  return lines.find((line) => proficiencyContext.test(line) || reversedContext.test(line)) ?? null;
}

function contextualPreferredLocation(lines: string[]) {
  const explicit = labeled(lines, ["preferred location", "work location", "job location", "site", "site code", "warehouse", "الموقع"]);
  if (explicit) return explicit;
  const shiftContext = /^\s*([A-Za-z][A-Za-z .'-]{1,50}?)\s+(?:night|day|morning|evening|afternoon)\s+shift\b/i;
  for (const line of lines) {
    if (STREET_RE.test(line) || US_CITY_STATE_ZIP_RE.test(line)) continue;
    const match = line.match(shiftContext);
    if (match?.[1]) return clean(match[1]);
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

/* ------------------------------------------------------------------------- *
 * Universal source understanding.
 *
 * Everything below is deterministic and additive. Each pass runs AFTER the
 * labeled passes and writes through `add()`, which refuses to overwrite a value
 * that is already present — so an explicit label, a user confirmation or a staff
 * correction always outranks an inference made here. No pass invents a value: it
 * either matches its shape exactly or writes nothing.
 * ------------------------------------------------------------------------- */

/** Day names longest-first so `wednesday` is never truncated to `wed`. */
const SOURCE_NOTE_LIMIT = 2000;

const DAY_WORD = "sunday|saturday|thursday|wednesday|tuesday|monday|friday|thurs|thur|tues|sun|mon|tue|wed|thu|fri|sat";
const DAY_RANGE_RE = new RegExp(`\\b(?:${DAY_WORD})\\s*(?:-|–|—|through|thru|to|till|until)\\s*(?:${DAY_WORD})\\b`, "i");
const DAY_LIST_RE = new RegExp(`\\b(?:${DAY_WORD})\\b(?:\\s*(?:,|/|&|\\+|and)\\s*\\b(?:${DAY_WORD})\\b)+`, "i");
const DAY_GROUP_RE = /\b(?:weekdays?|weekends?|daily|every\s*day|all\s*days)\b/i;
const DAY_ONLY_RE = new RegExp(`^(?:${DAY_WORD})$`, "i");

/**
 * A clock reading: a 12-hour time carrying a meridiem, or an explicit HH:MM.
 * Bare integers are deliberately excluded, so `12-12-1977` and `48212-3678`
 * can never be read as a time range.
 */
const CLOCK = String.raw`\d{1,2}(?::\d{2})?\s*[ap]\.?\s?m\.?|\d{1,2}:\d{2}`;
const TIME_RANGE_RE = new RegExp(`(${CLOCK})\\s*(?:-|–|—|to|till|until|through|thru)\\s*(${CLOCK})`, "i");

/** Shift vocabulary. `day` is only read as a shift when it is written as a shift. */
const SHIFT_WORD_RE = /\b(?:mornings?|afternoons?|evenings?|nights?|overnight|graveyard|daytime|day\s*shift)\b/i;
const SHIFT_WORD_CANON: readonly { test: RegExp; value: string }[] = [
  { test: /\b(?:overnight|graveyard|nights?)\b/i, value: "NIGHT" },
  { test: /\bmornings?\b/i, value: "MORNING" },
  { test: /\bafternoons?\b/i, value: "AFTERNOON" },
  { test: /\bevenings?\b/i, value: "EVENING" },
  { test: /\b(?:daytime|day\s*shift)\b/i, value: "DAY" },
];
const SHIFT_WORD_AR: readonly { token: string; value: string }[] = [
  { token: "بعد الظهر", value: "AFTERNOON" },
  { token: "الليلي", value: "NIGHT" },
  { token: "ليلي", value: "NIGHT" },
  { token: "ليلا", value: "NIGHT" },
  { token: "الصباحي", value: "MORNING" },
  { token: "صباحي", value: "MORNING" },
  { token: "المسائي", value: "EVENING" },
  { token: "مسائي", value: "EVENING" },
  { token: "النهاري", value: "DAY" },
  { token: "نهاري", value: "DAY" },
];

/** A line that talks about where the applicant wants to work. */
const WORK_CUE_RE = /\b(?:prefer|prefers|preferred|preference|work|working|worksite|location|locations|site|sites|warehouse|warehouses|branch|branches|assignment|placement|facility|facilities)\b/i;
const WORK_CUE_AR = ["يفضل", "يفضّل", "العمل", "عمل", "الموقع", "المواقع", "الفرع", "الفروع"];
/** Cue wording carried alongside a place name, removed before the name is read. */
const WORK_CUE_TAIL_RE = /\s*\b(?:is|are|as|for|only|also|the)?\s*\b(?:prefer|prefers|preferred|preference|work|working|worksite|location|locations|site|sites|warehouse|warehouses|branch|branches|assignment|placement|facility|facilities|please)\b.*$/i;
/** Words that are never a place name, however the line is punctuated. */
const NOT_A_PLACE_RE = new RegExp(
  `^(?:${DAY_WORD}|mornings?|afternoons?|evenings?|nights?|overnight|graveyard|daytime|shift|shifts|weekdays?|weekends?|daily|yes|no|any|anywhere|all|none|same|english|arabic|spanish|male|female|available|availability|asap|car|transportation)$`,
  "i",
);

/**
 * A full US address written on one line. The street suffix anchors the split, so
 * the city is never taken from the street and the ZIP is never taken from a
 * house number. A comma is accepted but not required.
 */
const INLINE_US_ADDRESS_RE = new RegExp(
  String.raw`(\d{1,6}\s+[A-Za-z0-9 .#'/-]{2,}?\b(?:ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|BLVD|BOULEVARD|LN|LANE|CT|COURT|PKWY|PARKWAY|HWY|HIGHWAY|WAY|PL|PLACE|TER|TERRACE|CIR|CIRCLE)\b(?:\s*,?\s*(?:APT|APARTMENT|UNIT|STE|SUITE|RM|ROOM|#)\s*[A-Za-z0-9-]+)?)\s*,?\s+([A-Za-z][A-Za-z .'-]{1,60}?)\s*,?\s+([A-Za-z]{2})\s*,?\s+(\d{5}(?:-\d{4})?)\b`,
  "i",
);

type InlineAddress = { street: string; city: string; state: string; zip: string };

/** The first line that carries a complete single-line US address. */
function inlineUsAddress(lines: readonly string[]): InlineAddress | null {
  for (const line of lines) {
    if (US_CITY_STATE_ZIP_RE.test(line)) continue;
    const match = line.match(INLINE_US_ADDRESS_RE);
    if (!match) continue;
    return {
      street: clean(match[1]).replace(/,\s*$/, ""),
      city: clean(match[2]),
      state: match[3].toUpperCase(),
      zip: match[4],
    };
  }
  return null;
}

/** True when a line's content belongs to a different, already-handled shape. */
function structuralLine(line: string) {
  return EMAIL_RE.test(line) || PHONE_RE.test(line) || ZIP_RE.test(line)
    || STREET_RE.test(line) || US_CITY_STATE_ZIP_RE.test(line) || URL_RE.test(line);
}

/**
 * The line with the shapes the earlier passes already read blanked out.
 *
 * A dictated sentence routinely carries a phone number, a shift and the days all
 * in one line. Skipping such a line wholesale — because it matched one shape —
 * silently dropped everything else in it. Blanking the parts that are already
 * accounted for lets the remaining passes read the rest, and stops any of them
 * mistaking a phone fragment or a street name for a place.
 */
function scrubStructural(line: string) {
  if (STREET_RE.test(line) || US_CITY_STATE_ZIP_RE.test(line)) return "";
  return line
    .replace(new RegExp(EMAIL_RE.source, "gi"), " ")
    .replace(new RegExp(URL_RE.source, "gi"), " ")
    .replace(new RegExp(PHONE_RE.source, "g"), " ")
    .replace(new RegExp(DATE_TOKEN_RE.source, "gi"), " ")
    .replace(new RegExp(ZIP_RE.source, "g"), " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** True when the row already holds a non-empty value for a key. */
function hasValue(row: IntakeRow, field: string) {
  const value = row[field];
  return typeof value === "string" && value.trim().length > 0;
}

/** Canonical shift type read from free text, or null when the text does not say. */
function readShiftType(line: string): string | null {
  if (SHIFT_WORD_RE.test(line)) {
    for (const entry of SHIFT_WORD_CANON) {
      if (entry.test.test(line)) return entry.value;
    }
  }
  for (const entry of SHIFT_WORD_AR) {
    if (line.includes(entry.token)) return entry.value;
  }
  return null;
}

/** Canonical day codes read from free text, as a comma-joined string. */
function readShiftDays(line: string): string | null {
  const span = line.match(DAY_RANGE_RE)?.[0] ?? line.match(DAY_LIST_RE)?.[0] ?? line.match(DAY_GROUP_RE)?.[0] ?? null;
  if (!span) return null;
  const days = normalizeShiftDays(span.replace(/\s*,\s*/g, ","));
  return days?.length ? days.join(", ") : null;
}

/** Canonical start and end of a written time range, overnight ranges included. */
function readTimeRange(line: string): { start: string; end: string } | null {
  const match = line.match(TIME_RANGE_RE);
  if (!match) return null;
  const start = normalizeShiftTime(match[1].replace(/[.\s]/g, ""));
  const end = normalizeShiftTime(match[2].replace(/[.\s]/g, ""));
  return start && end ? { start, end } : null;
}

/** One place name, or null when the fragment is not one. */
function placeToken(fragment: string): string | null {
  const stripped = clean(fragment)
    .replace(/^(?:and|or|&|also)\s+/i, "")
    .replace(WORK_CUE_TAIL_RE, "");
  const value = clean(stripped).replace(/[.,;:]+$/, "");
  if (value.length < 3 || value.length > 40) return null;
  if (!/^[\p{L}][\p{L} .'-]*$/u.test(value)) return null;
  if (NOT_A_PLACE_RE.test(value) || DAY_ONLY_RE.test(value)) return null;
  if (LABEL_PREFIX_RE.test(value)) return null;
  // A place name is a name, not a clause: at most four words, and none of them
  // vocabulary. "يريد العمل في الشفت الليلي" is a sentence about a shift.
  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length > 4) return null;
  if (tokens.some((token) => ARABIC_NOT_A_PLACE_RE.test(token) || NOT_A_PLACE_RE.test(token) || DAY_ONLY_RE.test(token))) return null;
  if (/[\u0600-\u06FF]/.test(value) && ARABIC_WORK_CONTEXT_RE.test(value)) return null;
  return value;
}

/** A candidate list stated under its own label, canonicalized to one separator. */
function normalizeCandidateList(value: string | null): string | null {
  if (!value) return null;
  const places = splitPlaces(value);
  return places.length ? places.join(", ") : null;
}

/** Work-location preferences read from a line, in the order the line states them. */
function readWorkLocations(line: string): string[] {
  const hasCue = WORK_CUE_RE.test(line) || WORK_CUE_AR.some((token) => line.includes(token));
  if (!hasCue) return [];
  const body = line.replace(/^[^:：]{0,48}[:：]\s*/, "");
  return splitPlaces(body);
}

/** Place names in a written list, in order, deduplicated case-insensitively. */
function splitPlaces(body: string): string[] {
  const fragments = body
    // "1. Detroit 2. Romulus" and "Detroit then Romulus" separate their items
    // without a comma, so the ranking markers are separators too.
    .replace(/(?:^|\s)(?:\d\s*[.)]|1st|2nd|3rd|first|second|third|then|next)\s+/gi, ", ")
    .split(/\s*(?:,|\/|\||؛|;|&|\bor\b|\band\b|\bو\b)\s*/i);
  const seen = new Set<string>();
  const places: string[] = [];
  for (const fragment of fragments) {
    const place = placeToken(fragment);
    if (!place) continue;
    const key = place.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    places.push(place);
  }
  return places;
}

/**
 * Glue, cue and vocabulary words. On their own they carry no client detail, so a
 * line that holds nothing else once its classified content is removed is fully
 * accounted for.
 */
const RESIDUE_STOP_RE = new RegExp(
  `^(?:${DAY_WORD}|mornings?|afternoons?|evenings?|nights?|overnight|graveyard|daytime|shifts?|days?|times?|hours?`
  + `|weekdays?|weekends?|daily|every|all|prefer|prefers|preferred|preference|wants?|needs?|works?|working|worksite`
  + `|locations?|sites?|warehouses?|branch|branches|assignment|placement|facility|facilities|please|only|also|the|and|or`
  + `|is|are|was|were|has|have|had|his|her|their|for|from|with|into|onto|at|in|on|to|of|a|an|am|pm|client|applicant|new)$`,
  "i",
);

/**
 * The part of a line that no pass accounted for.
 *
 * Classified values and matched shapes are removed, and what remains is checked for
 * a token that actually carries client detail. Returns true when the line still says
 * something the engine did not read into a field.
 */
function carriesUnreadDetail(line: string, captured: readonly string[]) {
  let remainder = line
    .replace(LABEL_PREFIX_RE, " ")
    .replace(new RegExp(DAY_RANGE_RE.source, "gi"), " ")
    .replace(new RegExp(DAY_LIST_RE.source, "gi"), " ")
    .replace(new RegExp(DAY_GROUP_RE.source, "gi"), " ")
    .replace(new RegExp(TIME_RANGE_RE.source, "gi"), " ")
    .replace(new RegExp(SHIFT_WORD_RE.source, "gi"), " ");
  for (const entry of SHIFT_WORD_AR) remainder = remainder.split(entry.token).join(" ");
  for (const value of captured) {
    if (!value) continue;
    remainder = remainder.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }
  return remainder
    .split(/[\s,;:.|/\\()[\]{}"'!?]+/u)
    .map((token) => token.trim())
    .some((token) => token.length >= 3 && !RESIDUE_STOP_RE.test(token) && !/^\d+$/.test(token));
}

/**
 * Source detail no pass accounted for, preserved verbatim so that something the
 * engine could not classify still reaches the reviewer instead of being dropped.
 * A line is kept whole — it is the client's own wording — but only when it still
 * carries detail after its classified content is set aside, so notes never restate
 * a value that already has a field.
 */
function residualSource(lines: readonly string[], row: IntakeRow, alsoCaptured: readonly (string | null)[] = []): string | null {
  const captured = [...Object.values(row), ...alsoCaptured]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length >= 3)
    .sort((a, b) => b.length - a.length);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const value = clean(line);
    if (value.length < 3 || structuralLine(value) || DATE_TOKEN_RE.test(value)) continue;
    // A consumed line is still read for leftovers: a pass may have taken only part of it.
    if (!carriesUnreadDetail(value, captured)) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out.length ? out.join("\n").slice(0, SOURCE_NOTE_LIMIT) : null;
}

/* --- Arabic free text ------------------------------------------------------- *
 * Arabic states the same facts without the colon-delimited labels the English
 * passes rely on, so each shape gets its own reader. Nothing here is a
 * translation table for values: a place name and a person's name are kept exactly
 * as written.
 * -------------------------------------------------------------------------- */

function alternation(words: readonly string[]) {
  return words
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
}

/** "اسمه أحمد محمد" and the other ways a name is introduced without a colon. */
const ARABIC_NAME_CUE_RE = /(?:^|[,،;؛]\s*)(?:اسمه|اسمها|اسم\s+العميل|اسم\s+الزبون|الاسم|يسمى|تسمى)\s+([؀-ۿ][؀-ۿ\s'-]{2,60}?)(?=$|[,،;؛.]|\s+(?:يريد|تريد|يفضل|تفضل|يعمل|وعنده|وعندها|ويريد|رقمه|هاتفه))/u;

/** The Arabic hour expressions, assembled from the canonical vocabulary. */
const ARABIC_CLOCK = String.raw`(?:\d{1,2}(?::\d{2})?|(?:ال)?(?:واحدة|حادية(?:\s+عشرة?)?|ثانية(?:\s+عشرة?)?|ثالثة|رابعة|خامسة|سادسة|سابعة|ثامنة|تاسعة|عاشرة))(?:\s*(?:و\s*)?(?:النصف|نصف|الربع|ربع|الثلث|ثلث|عشرة)|\s*(?:الا|إلا|ناقص)\s*(?:ربع|ثلث|عشرة|خمس))?(?:\s*(?:صباحا|صباحاً|صباحًا|الصباح|صباح|مساء|مساءً|مساءا|المساء|ليلا|ليلاً|ليلًا|الليل|ظهرا|ظهراً|ظهرًا|الظهر|بعد\s+الظهر|العصر|عصرا|فجرا|الفجر))?`;
const ARABIC_TIME_RANGE_RE = new RegExp(
  `(?:من\\s+)?(${ARABIC_CLOCK})\\s*(?:-|–|—|إلى|الى|حتى|لغاية|لحد)\\s*(${ARABIC_CLOCK})`,
  "u",
);

const ARABIC_DAY_RANGE_RE = new RegExp(
  `(?:من\\s+)?((?:${alternation(ARABIC_DAY_WORDS)}))\\s*(?:-|–|—|إلى|الى|حتى|لغاية|لحد)\\s*((?:${alternation(ARABIC_DAY_WORDS)}))`,
  "u",
);
const ARABIC_DAY_LIST_RE = new RegExp(
  `((?:${alternation(ARABIC_DAY_WORDS)}))(?:\\s*(?:,|،|/|&|\\+)\\s*|\\s+و\\s*)((?:${alternation(ARABIC_DAY_WORDS)}))`,
  "u",
);
const ARABIC_DAY_GROUP_RE = /(?:أيام|ايام)\s*العمل|نهاية\s*(?:الأسبوع|الاسبوع)|يوميا|يومياً|كل\s*يوم/u;

/** "في رومولس" — a place introduced by a preposition, inside a work context. */
const ARABIC_PLACE_PREPOSITION_RE = /(?:^|\s)(?:في|فى|بـ)\s*([؀-ۿ][؀-ۿ\s'-]{2,40}?)(?=$|[,،;؛.]|\s+(?:و|من|إلى|الى|حتى|يريد|يفضل|وعنده|وعندها))/u;
/** An Arabic line only counts as a work context when it says so. */
const ARABIC_WORK_CONTEXT_RE = /العمل|عمل|يعمل|وظيفة|الشفت|شفت|الوردية|وردية|الموقع|المواقع|الفرع|الفروع|المستودع/u;

/** Arabic words that are vocabulary, never a place name. */
const ARABIC_NOT_A_PLACE_RE = new RegExp(
  `^(?:${alternation(ARABIC_DAY_WORDS)}|الشفت|شفت|الوردية|وردية|العمل|عمل|الليلي|ليلي|الصباحي|صباحي|المسائي|مسائي|النهاري|نهاري|الصباح|المساء|الليل|سيارة|السيارة|نعم|لا|الموقع|المواقع)$`,
  "u",
);

/** The person's name as Arabic free text introduces it. */
function readArabicName(line: string): string | null {
  const value = clean(line.match(ARABIC_NAME_CUE_RE)?.[1] ?? "");
  if (!value) return null;
  const tokens = value.split(/\s+/).filter(Boolean);
  return tokens.length >= 2 && tokens.length <= 8 ? value : null;
}

/** Canonical day codes from Arabic free text. */
function readArabicShiftDays(line: string): string | null {
  const span = line.match(ARABIC_DAY_RANGE_RE)?.[0]
    ?? line.match(ARABIC_DAY_LIST_RE)?.[0]
    ?? line.match(ARABIC_DAY_GROUP_RE)?.[0]
    ?? null;
  if (!span) return null;
  const days = normalizeShiftDays(span);
  return days?.length ? days.join(", ") : null;
}

/** Canonical start and end from an Arabic time range. */
function readArabicTimeRange(line: string): { start: string; end: string } | null {
  const match = line.match(ARABIC_TIME_RANGE_RE);
  if (!match) return null;
  const start = normalizeShiftTime(match[1]);
  const end = normalizeShiftTime(match[2]);
  return start && end ? { start, end } : null;
}

/** A work place named by an Arabic preposition, in a line about work. */
function readArabicWorkPlace(line: string): string | null {
  if (!ARABIC_WORK_CONTEXT_RE.test(line)) return null;
  const value = clean(line.match(ARABIC_PLACE_PREPOSITION_RE)?.[1] ?? "");
  if (!value || value.length < 3 || value.length > 40) return null;
  // A place name carries no vocabulary words: "الشفت الليلي" is a shift, not a site.
  const tokens = value.split(/\s+/).filter(Boolean);
  return tokens.some((token) => ARABIC_NOT_A_PLACE_RE.test(token)) ? null : value;
}

/**
 * Per-item ordering evidence. A blanket "preferred" over a whole list ranks
 * nothing — it says all of them are acceptable — so only a marker attached to the
 * items themselves is treated as a stated preference order.
 */
const ORDER_MARKER_RE = /\b(?:1st|2nd|3rd|first|second|third|then|next|primary|backup)\b|(?:^|[\s(])\d\s*[.)]|الأول|الاول|الثاني|الثالث|ثم|أولا|اولا/iu;

/** The person's name split into its parts. Null when the split is not safe. */
function splitNameParts(fullName: string): { first: string; middle: string | null; last: string } | null {
  const tokens = clean(fullName).split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 8) return null;
  return {
    first: tokens[0],
    middle: tokens.length > 2 ? tokens.slice(1, -1).join(" ") : null,
    last: tokens[tokens.length - 1],
  };
}

export function extractDeterministicClient(raw: string): LocalExtraction {
  const text = raw.replace(/\r/g, "\n").trim();
  const lines = explodeSource(text);
  const row: IntakeRow = {};
  const evidence: LocalEvidence[] = [];
  if (!text) return { row, evidence, display_name: null };

  const labeledName = labeled(lines, ["full name", "name", "client name", "applicant name", "candidate name", "الاسم", "الاسم الكامل"]);
  const arabicName = labeledName ? null : lines.map(readArabicName).find(Boolean) ?? null;
  const name = labeledName ?? arabicName ?? likelyNameLine(lines);
  add(row, evidence, "full_name", name, labeledName || arabicName ? "HIGH" : name ? "MEDIUM" : "REVIEW", name);

  const labeledPhone = labeled(lines, ["phone", "mobile", "cell", "telephone", "phone number", "mobile number", "رقم الهاتف", "الهاتف"]);
  const phoneMatch = labeledPhone?.match(PHONE_RE)?.[0] ?? firstMatch(lines, PHONE_RE);
  const phone = phoneMatch ? normalizeUsPhone(phoneMatch) : null;
  add(row, evidence, "phone", phone, labeledPhone && phone ? "HIGH" : phone ? "MEDIUM" : "REVIEW", phoneMatch);

  const labeledEmail = labeled(lines, ["email", "e-mail", "email address", "البريد", "البريد الإلكتروني", "ايميل", "إيميل"]);
  const emailMatch = labeledEmail?.match(EMAIL_RE)?.[0] ?? firstMatch(lines, EMAIL_RE);
  add(row, evidence, "email", emailMatch ? normalizeEmail(emailMatch) : null, labeledEmail && emailMatch ? "HIGH" : emailMatch ? "MEDIUM" : "REVIEW", emailMatch);

  const dobRaw = labeled(lines, ["dob", "date of birth", "birth date", "birthday", "تاريخ الميلاد"]);
  const dob = dobRaw ? normalizeSmartDate(dobRaw.match(DATE_TOKEN_RE)?.[0] ?? dobRaw) : uniqueDateFromText(lines);
  add(row, evidence, "date_of_birth", dob, dobRaw && dob ? "HIGH" : dob ? "MEDIUM" : "REVIEW", dobRaw ?? dob);

  // A complete address written on one line is split here, before the street scan,
  // because the street pattern would otherwise swallow the city, state and ZIP.
  const inline = inlineUsAddress(lines);

  const streetLabeled = labeled(lines, ["street", "address", "street address", "home address", "العنوان"]);
  const street = streetLabeled ?? inline?.street ?? lines.find((line) => STREET_RE.test(line)) ?? null;
  add(row, evidence, "street", street ? clean(street) : null, streetLabeled ? "HIGH" : street ? "MEDIUM" : "REVIEW", street);

  const cityLabeled = labeled(lines, ["city", "المدينة"]);
  const stateLabeled = labeled(lines, ["state", "الولاية"]);
  const zipLabeled = labeled(lines, ["zip", "zip code", "postal code", "الرمز البريدي"]);
  let city = cityLabeled ?? inline?.city ?? null;
  let state = (stateLabeled ?? inline?.state ?? null)?.toUpperCase() ?? null;
  let zip = zipLabeled?.match(ZIP_RE)?.[0] ?? inline?.zip ?? null;
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

  const language = labeled(lines, ["preferred language", "language", "اللغة"]);
  add(row, evidence, "preferred_language", language, language ? "HIGH" : "REVIEW", language);
  const proficiency = contextualEnglishProficiency(lines);
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
  const preferredLocation = contextualPreferredLocation(lines);
  add(row, evidence, "site_code", preferredLocation, preferredLocation ? "MEDIUM" : "REVIEW", preferredLocation);
  add(row, evidence, "job_id", labeled(lines, ["job id", "job", "amazon job id", "requisition id"]), "REVIEW", null);
  add(row, evidence, "shift_code", labeled(lines, ["shift", "desired shift", "schedule shift", "الشفت", "الوردية"]), "REVIEW", null);
  add(row, evidence, "shift_days", labeled(lines, ["shift days", "work days", "schedule days", "أيام الشفت", "ايام الشفت"]), "REVIEW", null);
  add(row, evidence, "shift_start_time", labeled(lines, ["shift start", "shift start time", "start time", "بداية الشفت"]), "REVIEW", null);
  add(row, evidence, "shift_end_time", labeled(lines, ["shift end", "shift end time", "end time", "نهاية الشفت"]), "REVIEW", null);
  add(row, evidence, "first_name", labeled(lines, ["first name", "given name", "الاسم الأول", "الاسم الاول"]), "HIGH", null);
  add(row, evidence, "middle_name", labeled(lines, ["middle name", "الاسم الأوسط", "الاسم الاوسط", "اسم الأب", "اسم الاب"]), "HIGH", null);
  add(row, evidence, "last_name", labeled(lines, ["last name", "family name", "surname", "اسم العائلة", "الاسم الأخير", "الاسم الاخير"]), "HIGH", null);
  add(row, evidence, "work_location_candidates", normalizeCandidateList(labeled(lines, ["work location candidates", "location candidates", "work locations", "preferred locations", "المواقع المقترحة", "مواقع العمل"])), "HIGH", null);
  add(row, evidence, "alt_site_code", labeled(lines, ["location option 1", "alt site", "alt site code", "alternate location", "alternate site", "second location", "second site", "الموقع البديل"]), "HIGH", null);
  add(row, evidence, "backup_site_code", labeled(lines, ["backup site", "backup location", "location option 2"]), "REVIEW", null);
  // Read first so a labelled note always outranks the residue appended below.
  const labeledNotes = labeled(lines, ["additional notes", "additional note", "extra notes", "other details", "ملاحظات إضافية", "ملاحظات اضافية"]);
  add(row, evidence, "backup_job_id", labeled(lines, ["backup job id", "job option 2"]), "REVIEW", null);
  add(row, evidence, "backup_shift_code", labeled(lines, ["backup shift", "shift option 2"]), "REVIEW", null);

  // Unlabeled operational detail, read by shape. Every write goes through `add()`,
  // so a labeled value captured above is never replaced by an inference here.
  for (const raw of lines) {
    // Read what is left of the line once the shapes already handled are blanked.
    const line = scrubStructural(raw);
    if (!line) continue;

    const days = readShiftDays(line) ?? readArabicShiftDays(line);
    if (days && !hasValue(row, "shift_days")) {
      add(row, evidence, "shift_days", days, "MEDIUM", line);
    }

    const range = readTimeRange(line) ?? readArabicTimeRange(line);
    if (range && !hasValue(row, "shift_start_time") && !hasValue(row, "shift_end_time")) {
      add(row, evidence, "shift_start_time", range.start, "MEDIUM", line);
      add(row, evidence, "shift_end_time", range.end, "MEDIUM", line);
    }

    const shiftType = readShiftType(line);
    if (shiftType && !hasValue(row, "shift_code")) {
      add(row, evidence, "shift_code", shiftType, "MEDIUM", line);
    }

    const places = readWorkLocations(line);
    if (places.length >= 2) {
      // Several places and no stated order: they are candidates for the reviewer to
      // rank. Assigning the first one as "preferred" would invent a preference the
      // source never expressed.
      if (ORDER_MARKER_RE.test(line)) {
        const open = (["site_code", "alt_site_code", "backup_site_code"] as const).filter((key) => !hasValue(row, key));
        for (const [slot, key] of open.entries()) {
          const place = places[slot];
          if (!place) break;
          add(row, evidence, key, place, "MEDIUM", line);
        }
      } else {
        add(row, evidence, "work_location_candidates", places.join(", "), "MEDIUM", line);
      }
    } else if (places.length === 1 && !hasValue(row, "site_code")) {
      add(row, evidence, "site_code", places[0], "MEDIUM", line);
    }

    const arabicPlace = readArabicWorkPlace(line);
    if (arabicPlace && !hasValue(row, "site_code") && !hasValue(row, "work_location_candidates")) {
      add(row, evidence, "site_code", arabicPlace, "MEDIUM", line);
    }
  }

  // The name's parts, read off the name itself. This is a split of a value the
  // source stated, not a new fact, so it is marked as derived and never competes
  // with a labelled first, middle or last name.
  const parts = typeof row.full_name === "string" ? splitNameParts(row.full_name) : null;
  if (parts) {
    add(row, evidence, "first_name", parts.first, "MEDIUM", String(row.full_name));
    add(row, evidence, "middle_name", parts.middle, "MEDIUM", String(row.full_name));
    add(row, evidence, "last_name", parts.last, "MEDIUM", String(row.full_name));
  }

  // Anything left unclassified is preserved verbatim rather than discarded. A labelled
  // note keeps its wording and position; residue is appended after it, never merged
  // into it and never dropped.
  const residue = residualSource(lines, row, [labeledNotes]);
  const notes = [labeledNotes, residue]
    .filter((part): part is string => Boolean(part?.trim()))
    .join("\n");
  add(row, evidence, "additional_notes", notes || null, labeledNotes ? "HIGH" : "MEDIUM", labeledNotes);

  return { row, evidence, display_name: typeof row.full_name === "string" && row.full_name.trim() ? row.full_name.trim() : null };
}

export function localDisplayIdentity(raw: string) {
  const extracted = extractDeterministicClient(raw);
  return extracted.display_name
    ?? (typeof extracted.row.email === "string" ? extracted.row.email : null)
    ?? (typeof extracted.row.phone === "string" ? extracted.row.phone : null);
}
