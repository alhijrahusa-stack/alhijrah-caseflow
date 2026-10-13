/**
 * Machine Readable Zone parsing, ICAO Doc 9303.
 *
 * A passport, a permanent resident card and an employment authorization document
 * all carry an MRZ: a fixed-width band designed to be read by machine, with a check
 * digit over each field and one over the record. That makes it categorically better
 * evidence than any model's confidence score — a field whose check digit verifies is
 * arithmetically consistent, not merely "probably right".
 *
 * This module is deterministic, offline and dependency-free. It costs nothing to run,
 * downloads nothing, and is the only extraction path in this codebase that can report
 * a field as VERIFIED rather than as a reading.
 *
 * Formats, per 9303 Parts 4–6:
 *   TD1  3 lines × 30  identity cards, PRC, EAD
 *   TD2  2 lines × 36  older travel documents
 *   TD3  2 lines × 44  passports
 *
 * What it deliberately does NOT do: repair a line, guess a missing character, or
 * return a field whose own check digit fails. A failed check digit is reported as
 * failed, because an MRZ that does not verify is exactly the case a human must see.
 */

export type MrzFormat = "TD1" | "TD2" | "TD3";

export type MrzFieldCheck = {
  /** The digit printed in the MRZ. */
  printed: number | null;
  /** The digit computed from the field's own characters. */
  computed: number;
  valid: boolean;
};

export type MrzResult = {
  format: MrzFormat;
  document_code: string;
  issuing_state: string;
  surname: string;
  given_names: string;
  full_name: string;
  document_number: string;
  nationality: string;
  /** ISO dates, resolved against the sliding window below. Null when not a date. */
  date_of_birth: string | null;
  expiration_date: string | null;
  sex: "M" | "F" | "X" | null;
  optional_data: string;
  checks: {
    document_number: MrzFieldCheck;
    date_of_birth: MrzFieldCheck;
    expiration_date: MrzFieldCheck;
    /** TD3 only: the check over the personal-number field. */
    optional_data: MrzFieldCheck | null;
    composite: MrzFieldCheck;
  };
  /** True only when every check digit present in this format verifies. */
  verified: boolean;
  /** Field keys whose own check digit verified, so they may be trusted as read. */
  verified_fields: string[];
};

const FILLER = "<";
const WEIGHTS = [7, 3, 1] as const;

/** Character values for the check-digit algorithm: digits, A–Z = 10–35, filler = 0. */
function charValue(char: string): number {
  if (char >= "0" && char <= "9") return char.charCodeAt(0) - 48;
  if (char >= "A" && char <= "Z") return char.charCodeAt(0) - 55;
  if (char === FILLER) return 0;
  return -1;
}

/**
 * The ICAO 9303 check digit: each character's value times a repeating 7-3-1 weight,
 * summed, modulo 10. An unexpected character makes the whole field uncomputable
 * rather than silently contributing zero.
 */
export function mrzCheckDigit(input: string): number | null {
  let sum = 0;
  for (let index = 0; index < input.length; index += 1) {
    const value = charValue(input[index]);
    if (value < 0) return null;
    sum += value * WEIGHTS[index % 3];
  }
  return sum % 10;
}

function check(field: string, printed: string): MrzFieldCheck {
  const computed = mrzCheckDigit(field);
  const parsed = /^\d$/.test(printed) ? Number(printed) : null;
  return {
    printed: parsed,
    computed: computed ?? -1,
    valid: computed !== null && parsed !== null && computed === parsed,
  };
}

/**
 * A two-digit MRZ year resolved to a full year.
 *
 * A date of birth cannot be in the future, so a two-digit year above the current one
 * belongs to the previous century. An expiry may be decades out, so it is read
 * forward. This is the standard sliding window, applied explicitly rather than
 * assumed, and it never produces a date the calendar does not have.
 */
function mrzDate(raw: string, kind: "birth" | "expiry", now = new Date()): string | null {
  if (!/^\d{6}$/.test(raw)) return null;
  const year2 = Number(raw.slice(0, 2));
  const month = Number(raw.slice(2, 4));
  const day = Number(raw.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const currentYear = now.getUTCFullYear();
  const currentYear2 = currentYear % 100;
  const century = Math.floor(currentYear / 100) * 100;
  const year = kind === "birth"
    ? (year2 > currentYear2 ? century - 100 + year2 : century + year2)
    : (year2 < currentYear2 - 70 ? century + 100 + year2 : century + year2);

  const exact = new Date(Date.UTC(year, month - 1, day));
  if (exact.getUTCFullYear() !== year || exact.getUTCMonth() !== month - 1 || exact.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** MRZ name fields: `<` separates words, `<<` separates surname from given names. */
function names(field: string): { surname: string; given: string } {
  const [surnamePart = "", givenPart = ""] = field.split("<<");
  const clean = (value: string) => value.split(FILLER).filter(Boolean).join(" ").trim();
  return { surname: clean(surnamePart), given: clean(givenPart) };
}

function sexOf(raw: string): "M" | "F" | "X" | null {
  if (raw === "M" || raw === "F") return raw;
  // 9303 uses `<` for unspecified; X appears in practice and means the same.
  return raw === FILLER || raw === "X" ? "X" : null;
}

function strip(value: string) {
  return value.split(FILLER).filter(Boolean).join("").trim();
}

/**
 * The candidate MRZ lines in a block of OCR text.
 *
 * MRZ lines are fixed-width and drawn from a 37-character alphabet, which makes them
 * separable from ordinary text without guessing. Spaces are removed because OCR
 * routinely introduces them into the filler runs; nothing else is altered.
 */
export function findMrzLines(text: string): string[] {
  return String(text ?? "")
    .toUpperCase()
    .split(/[\r\n]+/)
    .map((line) => line.replace(/\s+/g, "").replace(/[«»]/g, FILLER))
    .filter((line) => line.length >= 28 && /^[A-Z0-9<]+$/.test(line) && line.includes(FILLER));
}

function parseTd3(lines: readonly string[]): MrzResult | null {
  const [one, two] = lines;
  if (one.length !== 44 || two.length !== 44) return null;
  const documentNumber = two.slice(0, 9);
  const dob = two.slice(13, 19);
  const expiry = two.slice(21, 27);
  const optional = two.slice(28, 42);
  const composite = documentNumber + two[9] + dob + two[19] + expiry + two[27] + optional + two[42];
  const { surname, given } = names(one.slice(5));
  const checks = {
    document_number: check(documentNumber, two[9]),
    date_of_birth: check(dob, two[19]),
    expiration_date: check(expiry, two[27]),
    optional_data: check(optional, two[42]),
    composite: check(composite, two[43]),
  };
  return assemble("TD3", {
    document_code: strip(one.slice(0, 2)),
    issuing_state: strip(one.slice(2, 5)),
    surname,
    given,
    documentNumber: strip(documentNumber),
    nationality: strip(two.slice(10, 13)),
    dob,
    expiry,
    sex: two[20],
    optional: strip(optional),
    checks,
  });
}

function parseTd2(lines: readonly string[]): MrzResult | null {
  const [one, two] = lines;
  if (one.length !== 36 || two.length !== 36) return null;
  const documentNumber = two.slice(0, 9);
  const dob = two.slice(13, 19);
  const expiry = two.slice(21, 27);
  const optional = two.slice(28, 35);
  const composite = documentNumber + two[9] + dob + two[19] + expiry + two[27] + optional;
  const { surname, given } = names(one.slice(5));
  const checks = {
    document_number: check(documentNumber, two[9]),
    date_of_birth: check(dob, two[19]),
    expiration_date: check(expiry, two[27]),
    optional_data: null,
    composite: check(composite, two[35]),
  };
  return assemble("TD2", {
    document_code: strip(one.slice(0, 2)),
    issuing_state: strip(one.slice(2, 5)),
    surname,
    given,
    documentNumber: strip(documentNumber),
    nationality: strip(two.slice(10, 13)),
    dob,
    expiry,
    sex: two[20],
    optional: strip(optional),
    checks,
  });
}

function parseTd1(lines: readonly string[]): MrzResult | null {
  const [one, two, three] = lines;
  if (one.length !== 30 || two.length !== 30 || three.length !== 30) return null;
  const documentNumber = one.slice(5, 14);
  const dob = two.slice(0, 6);
  const expiry = two.slice(8, 14);
  const optional1 = one.slice(15, 30);
  const optional2 = two.slice(18, 29);
  const composite = one.slice(5, 30) + two.slice(0, 7) + two.slice(8, 15) + two.slice(18, 29);
  const { surname, given } = names(three);
  const checks = {
    document_number: check(documentNumber, one[14]),
    date_of_birth: check(dob, two[6]),
    expiration_date: check(expiry, two[14]),
    optional_data: null,
    composite: check(composite, two[29]),
  };
  return assemble("TD1", {
    document_code: strip(one.slice(0, 2)),
    issuing_state: strip(one.slice(2, 5)),
    surname,
    given,
    documentNumber: strip(documentNumber),
    nationality: strip(two.slice(15, 18)),
    dob,
    expiry,
    sex: two[7],
    optional: [strip(optional1), strip(optional2)].filter(Boolean).join(" "),
    checks,
  });
}

function assemble(format: MrzFormat, parts: {
  document_code: string;
  issuing_state: string;
  surname: string;
  given: string;
  documentNumber: string;
  nationality: string;
  dob: string;
  expiry: string;
  sex: string;
  optional: string;
  checks: MrzResult["checks"];
}): MrzResult {
  const { checks } = parts;
  const dateOfBirth = mrzDate(parts.dob, "birth");
  const expirationDate = mrzDate(parts.expiry, "expiry");
  const fullName = [parts.given, parts.surname].filter(Boolean).join(" ").trim();

  // A field is trusted only when its own check digit verifies AND the record's
  // composite check verifies. One corrupted character shifts the composite, so a
  // record that fails it is not partially trusted.
  const verifiedFields: string[] = [];
  if (checks.composite.valid) {
    if (checks.document_number.valid) verifiedFields.push("document_number");
    if (checks.date_of_birth.valid && dateOfBirth) verifiedFields.push("date_of_birth");
    if (checks.expiration_date.valid && expirationDate) verifiedFields.push("expiration_date");
    // Names and nationality carry no check digit of their own; the composite covers
    // the record, so they are reported as read rather than as verified.
  }

  const present = [checks.document_number, checks.date_of_birth, checks.expiration_date, checks.composite];
  if (checks.optional_data) present.push(checks.optional_data);

  return {
    format,
    document_code: parts.document_code,
    issuing_state: parts.issuing_state,
    surname: parts.surname,
    given_names: parts.given,
    full_name: fullName,
    document_number: parts.documentNumber,
    nationality: parts.nationality,
    date_of_birth: dateOfBirth,
    expiration_date: expirationDate,
    sex: sexOf(parts.sex),
    optional_data: parts.optional,
    checks,
    verified: present.every((item) => item.valid),
    verified_fields: verifiedFields,
  };
}

/**
 * Parses the MRZ out of a block of text, or returns null when there is not one.
 *
 * The longest valid reading wins: a TD3 passport band is tried before TD2 and TD1, so
 * a 44-character line is never mistaken for a truncated one. Returning null is a
 * normal outcome — most documents have no MRZ at all.
 */
export function parseMrz(text: string): MrzResult | null {
  const lines = findMrzLines(text);
  if (lines.length < 2) return null;

  for (let start = 0; start + 1 < lines.length; start += 1) {
    const pair = [lines[start], lines[start + 1]];
    const td3 = parseTd3(pair);
    if (td3) return td3;
    const td2 = parseTd2(pair);
    if (td2) return td2;
    if (start + 2 < lines.length) {
      const td1 = parseTd1([lines[start], lines[start + 1], lines[start + 2]]);
      if (td1) return td1;
    }
  }
  return null;
}
