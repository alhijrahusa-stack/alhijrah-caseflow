import { inflateRawSync } from "node:zlib";

export type IntakeCell = string | null;
export type IntakeRow = Record<string, IntakeCell>;

const MAX_ROWS = 1000;
const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;

function clean(value: string) {
  const v = value.replace(/^\uFEFF/, "").trim();
  return v.length ? v : null;
}

function uniqueHeaders(raw: string[]) {
  const used = new Map<string, number>();
  return raw.map((h, i) => {
    const base = clean(h) ?? `column_${i + 1}`;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
}

export function parseCsv(text: string): IntakeRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
      if (rows.length > MAX_ROWS + 1) throw new Error(`Import is limited to ${MAX_ROWS} data rows`);
    } else {
      field += ch;
    }
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field");
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].every((v) => !v.trim())) rows.pop();
  if (rows.length < 2) return [];

  const headers = uniqueHeaders(rows[0]);
  return rows.slice(1, MAX_ROWS + 1)
    .filter((r) => r.some((v) => v.trim()))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, clean(r[i] ?? "")]))) as IntakeRow[];
}

function u16(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}

function u32(b: Uint8Array, o: number) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function findEocd(bytes: Uint8Array) {
  const min = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (u32(bytes, i) === 0x06054b50) return i;
  }
  throw new Error("Invalid XLSX archive");
}

function zipEntries(bytes: Uint8Array) {
  const eocd = findEocd(bytes);
  const count = u16(bytes, eocd + 10);
  const centralOffset = u32(bytes, eocd + 16);
  const decoder = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  let pos = centralOffset;
  let expanded = 0;

  for (let i = 0; i < count; i++) {
    if (u32(bytes, pos) !== 0x02014b50) throw new Error("Invalid XLSX central directory");
    const flags = u16(bytes, pos + 8);
    const method = u16(bytes, pos + 10);
    const compressedSize = u32(bytes, pos + 20);
    const uncompressedSize = u32(bytes, pos + 24);
    const nameLen = u16(bytes, pos + 28);
    const extraLen = u16(bytes, pos + 30);
    const commentLen = u16(bytes, pos + 32);
    const localOffset = u32(bytes, pos + 42);
    const name = decoder.decode(bytes.slice(pos + 46, pos + 46 + nameLen));
    if (flags & 1) throw new Error("Encrypted XLSX files are not supported");
    expanded += uncompressedSize;
    if (expanded > MAX_UNCOMPRESSED_BYTES) throw new Error("XLSX expands beyond the safe import limit");

    if (u32(bytes, localOffset) !== 0x04034b50) throw new Error("Invalid XLSX local header");
    const localNameLen = u16(bytes, localOffset + 26);
    const localExtraLen = u16(bytes, localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = bytes.slice(start, start + compressedSize);
    let data: Uint8Array;
    if (method === 0) data = compressed;
    else if (method === 8) data = new Uint8Array(inflateRawSync(compressed));
    else throw new Error(`Unsupported XLSX compression method ${method}`);
    if (uncompressedSize && data.length !== uncompressedSize) throw new Error("Corrupt XLSX entry size");
    out.set(name.replace(/^\//, ""), data);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function xmlDecode(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

function textNodes(xml: string) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => xmlDecode(m[1])).join("");
}

function sharedStrings(entries: Map<string, Uint8Array>) {
  const bytes = entries.get("xl/sharedStrings.xml");
  if (!bytes) return [] as string[];
  const xml = new TextDecoder().decode(bytes);
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((m) => textNodes(m[1]));
}

function firstSheetPath(entries: Map<string, Uint8Array>) {
  const workbook = entries.get("xl/workbook.xml");
  const rels = entries.get("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) return "xl/worksheets/sheet1.xml";
  const wb = new TextDecoder().decode(workbook);
  const rel = new TextDecoder().decode(rels);
  const sheet = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"[^>]*\/?\s*>/);
  if (!sheet) return "xl/worksheets/sheet1.xml";
  const id = sheet[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const target = rel.match(new RegExp(`<Relationship\\b[^>]*\\bId="${id}"[^>]*\\bTarget="([^"]+)"[^>]*/?>`));
  if (!target) return "xl/worksheets/sheet1.xml";
  const normalized = target[1].replace(/\\/g, "/").replace(/^\//, "");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized.replace(/^\.\//, "")}`;
}

function columnIndex(ref: string) {
  const letters = (ref.match(/^[A-Z]+/i)?.[0] ?? "A").toUpperCase();
  let n = 0;
  for (const c of letters) n = n * 26 + c.charCodeAt(0) - 64;
  return n - 1;
}

function cellValue(cell: string, shared: string[]) {
  const type = cell.match(/\bt="([^"]+)"/)?.[1] ?? "";
  if (type === "inlineStr") return clean(textNodes(cell));
  const raw = cell.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1];
  if (raw == null) return null;
  const decoded = xmlDecode(raw);
  if (type === "s") {
    const idx = Number(decoded);
    return Number.isInteger(idx) && idx >= 0 ? clean(shared[idx] ?? "") : null;
  }
  if (type === "b") return decoded === "1" ? "TRUE" : "FALSE";
  return clean(decoded);
}

export function parseXlsx(bytes: Uint8Array): IntakeRow[] {
  const entries = zipEntries(bytes);
  const path = firstSheetPath(entries);
  const sheetBytes = entries.get(path) ?? entries.get("xl/worksheets/sheet1.xml");
  if (!sheetBytes) throw new Error("XLSX does not contain a readable first worksheet");
  const xml = new TextDecoder().decode(sheetBytes);
  const shared = sharedStrings(entries);
  const matrix: string[][] = [];

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const values: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const ref = attrs.match(/\br="([A-Z]+\d+)"/i)?.[1] ?? `A${matrix.length + 1}`;
      const idx = columnIndex(ref);
      values[idx] = cellValue(`<c ${attrs}>${cellMatch[2]}</c>`, shared) ?? "";
    }
    if (values.some((v) => v?.trim())) matrix.push(values);
    if (matrix.length > MAX_ROWS + 1) throw new Error(`Import is limited to ${MAX_ROWS} data rows`);
  }
  if (matrix.length < 2) return [];
  const headers = uniqueHeaders(matrix[0]);
  return matrix.slice(1, MAX_ROWS + 1)
    .filter((r) => r.some((v) => v?.trim()))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, clean(r[i] ?? "")]))) as IntakeRow[];
}
