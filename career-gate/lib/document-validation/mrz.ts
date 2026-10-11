export type MrzFormat = "TD1" | "TD2" | "TD3";

export type MrzCheck = {
  name: "document_number" | "date_of_birth" | "expiry_date" | "optional_data" | "composite";
  expected: string;
  actual: string;
  passed: boolean;
};

export type MrzValidation = {
  format: MrzFormat | null;
  valid: boolean | null;
  checks: MrzCheck[];
  lines: string[];
};

const WEIGHTS = [7, 3, 1] as const;

function valueOf(char: string) {
  if (/^[0-9]$/.test(char)) return Number(char);
  if (/^[A-Z]$/.test(char)) return char.charCodeAt(0) - 55;
  if (char === "<") return 0;
  return -1;
}

export function mrzCheckDigit(input: string) {
  let sum = 0;
  for (let index = 0; index < input.length; index += 1) {
    const value = valueOf(input[index]);
    if (value < 0) return null;
    sum += value * WEIGHTS[index % WEIGHTS.length];
  }
  return String(sum % 10);
}

function normalizeLines(input: string | string[]) {
  const raw = Array.isArray(input) ? input : input.split(/\r?\n|\s+(?=[A-Z0-9<]{30,44}$)/);
  return raw
    .map((line) => line.trim().toUpperCase().replace(/\s/g, ""))
    .filter(Boolean);
}

function check(name: MrzCheck["name"], source: string, actual: string): MrzCheck {
  const expected = mrzCheckDigit(source);
  return {
    name,
    expected: expected ?? "?",
    actual,
    passed: expected != null && actual === expected,
  };
}

function td3(lines: string[]): MrzValidation {
  const line = lines[1];
  const checks = [
    check("document_number", line.slice(0, 9), line[9]),
    check("date_of_birth", line.slice(13, 19), line[19]),
    check("expiry_date", line.slice(21, 27), line[27]),
    check("optional_data", line.slice(28, 42), line[42]),
    check("composite", line.slice(0, 10) + line.slice(13, 20) + line.slice(21, 43), line[43]),
  ];
  return { format: "TD3", valid: checks.every((item) => item.passed), checks, lines };
}

function td2(lines: string[]): MrzValidation {
  const line = lines[1];
  const checks = [
    check("document_number", line.slice(0, 9), line[9]),
    check("date_of_birth", line.slice(13, 19), line[19]),
    check("expiry_date", line.slice(21, 27), line[27]),
    check("composite", line.slice(0, 10) + line.slice(13, 20) + line.slice(21, 35), line[35]),
  ];
  return { format: "TD2", valid: checks.every((item) => item.passed), checks, lines };
}

function td1(lines: string[]): MrzValidation {
  const first = lines[0];
  const second = lines[1];
  const checks = [
    check("document_number", first.slice(5, 14), first[14]),
    check("date_of_birth", second.slice(0, 6), second[6]),
    check("expiry_date", second.slice(8, 14), second[14]),
    check(
      "composite",
      first.slice(5, 30) + second.slice(0, 7) + second.slice(8, 15) + second.slice(18, 29),
      second[29],
    ),
  ];
  return { format: "TD1", valid: checks.every((item) => item.passed), checks, lines };
}

/**
 * ICAO Doc 9303 check-digit validation for TD1, TD2 and TD3 MRZ layouts.
 * This validates machine-readable checksums only; it is not an authenticity
 * verdict and must never be presented as one.
 */
export function validateMrz(input: string | string[]): MrzValidation {
  const lines = normalizeLines(input);
  if (lines.length === 2 && lines.every((line) => line.length === 44)) return td3(lines);
  if (lines.length === 2 && lines.every((line) => line.length === 36)) return td2(lines);
  if (lines.length === 3 && lines.every((line) => line.length === 30)) return td1(lines);
  return { format: null, valid: null, checks: [], lines };
}
