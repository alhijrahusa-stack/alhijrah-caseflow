// Deterministic reconciliation of document-extracted values against the
// client record. Fuzzy similarity is reported for reviewers but never yields
// MATCH on its own.

export type ReconState = "MATCH" | "FORMAT_VARIANCE" | "MISMATCH" | "UNVERIFIED";
export type Recon = { field: string; state: ReconState; record_value: string | null; document_value: string | null; similarity?: number };

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const month = (word: string) => MONTHS[word.slice(0, 3)] ?? null;

/** Normalizes common US/ISO date renderings to YYYY-MM-DD, or null. */
export function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ");
  let y: number, m: number, d: number;
  let r: RegExpMatchArray | null;
  if ((r = s.match(/^(\d{4})[-/ ](\d{1,2})[-/ ](\d{1,2})$/))) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = s.match(/^(\d{1,2})[-/ ](\d{1,2})[-/ ](\d{4})$/))) [m, d, y] = [+r[1], +r[2], +r[3]];
  else if ((r = s.match(/^(\d{1,2}) ([a-z]{3,9}) (\d{4})$/)) && month(r[2])) [d, m, y] = [+r[1], month(r[2])!, +r[3]];
  else if ((r = s.match(/^([a-z]{3,9}) (\d{1,2}) (\d{4})$/)) && month(r[1])) [m, d, y] = [month(r[1])!, +r[2], +r[3]];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function nameTokens(raw: string) {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function levenshtein(a: string, b: string) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function similarity(a: string, b: string) {
  const x = nameTokens(a).sort().join(" ");
  const y = nameTokens(b).sort().join(" ");
  if (!x && !y) return 1;
  return Math.round((1 - levenshtein(x, y) / Math.max(x.length, y.length)) * 1000) / 1000;
}

export function reconcileName(record: string | null, doc: string | null): Recon {
  if (!record || !doc) return { field: "full_name", state: "UNVERIFIED", record_value: record, document_value: doc };
  const r = nameTokens(record);
  const d = nameTokens(doc);
  const sim = similarity(record, doc);
  if (r.join(" ") === d.join(" ")) {
    return { field: "full_name", state: record.trim() === doc.trim() ? "MATCH" : "FORMAT_VARIANCE", record_value: record, document_value: doc, similarity: sim };
  }
  const sameSet = [...r].sort().join(" ") === [...d].sort().join(" ");
  const subset = r.every((t) => d.includes(t)) || d.every((t) => r.includes(t));
  return {
    field: "full_name",
    state: sameSet || subset ? "FORMAT_VARIANCE" : "MISMATCH",
    record_value: record,
    document_value: doc,
    similarity: sim,
  };
}

export function reconcileDob(record: string | null, docRaw: string | null): Recon {
  const doc = normalizeDate(docRaw);
  if (!record || !doc) return { field: "date_of_birth", state: "UNVERIFIED", record_value: record, document_value: docRaw };
  return { field: "date_of_birth", state: record === doc ? "MATCH" : "MISMATCH", record_value: record, document_value: doc };
}

export const needsHuman = (rs: Recon[]) => rs.some((r) => r.state !== "MATCH");

function sameNameToken(a: string, b: string) {
  return a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b));
}

/**
 * Two written forms of one person's name: the same tokens in any order
 * ("DOE, JOHN M" and "John M Doe"), or one form missing a middle name or
 * reducing it to an initial. Both forms need at least two tokens, so a lone
 * given name never vouches for a full name. Anything else is a different name.
 */
export function compatibleNames(left: string, right: string) {
  const a = nameTokens(left), b = nameTokens(right);
  if (a.length < 2 || b.length < 2) return a.length > 0 && a.join(" ") === b.join(" ");
  const [small, large] = a.length <= b.length ? [a, b] : [b, a];
  const pool = [...large];
  for (const token of small) {
    const at = pool.findIndex((candidate) => sameNameToken(token, candidate));
    if (at < 0) return false;
    pool.splice(at, 1);
  }
  // At least two whole-word matches: initials alone never establish identity.
  return small.filter((token) => token.length > 1 && large.includes(token)).length >= 2;
}

/** "DOE, JOHN MICHAEL" (document order) → "JOHN MICHAEL DOE"; other forms are returned trimmed. Letter case is kept as written. */
export function givenFirstName(value: string) {
  const match = value.replace(/\s+/g, " ").trim().match(/^([^,]+),\s*([^,]+)$/);
  return match ? `${match[2].trim()} ${match[1].trim()}` : value.replace(/\s+/g, " ").trim();
}

/** The most complete of compatible forms (most tokens, then longest whole words), in given-name-first order. */
export function mostCompleteName(values: readonly string[]) {
  const score = (value: string) => {
    const tokens = nameTokens(value);
    return tokens.length * 1000 + tokens.reduce((sum, token) => sum + token.length, 0);
  };
  const best = [...values].sort((x, y) => score(y) - score(x))[0];
  return best === undefined ? null : givenFirstName(best);
}

/** "First Middle Last" from separate parts, or null without both first and last. */
export function composeName(first: string | null | undefined, middle: string | null | undefined, last: string | null | undefined) {
  const parts = [first, middle, last].map((part) => part?.replace(/\s+/g, " ").trim() ?? "");
  if (!parts[0] || !parts[2]) return null;
  return parts.filter(Boolean).join(" ");
}
