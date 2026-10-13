/**
 * Tesseract.js on-device browser inference. No document leaves the employee's browser for OCR.
 * The model runtime/assets are downloaded on first use; callers display progress.
 */
import { createWorker, type Worker } from "tesseract.js";
let instance: Promise<Worker> | null = null;
type Line = { text: string; score: number };
type OCRCandidate = { row: Record<string, string>; confidence: Record<string, number> };
export type BrowserOcrResult = { candidates: OCRCandidate[]; recognizedCount: number; elapsedMs: number };
function getEngine(): Promise<Worker> {
  if (!instance) {
    instance = createWorker("eng", 1);
    void instance.catch(() => { instance = null; });
  }
  return instance;
}
function dateFromExplicitSource(value: string): string | null {
  const t = value.trim();
  const iso = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/.exec(t);
  const us = /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/.exec(t);
  if (!iso && !us) return null;
  const [year, month, day] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [Number(us![3]), Number(us![1]), Number(us![2])];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return [year, String(month).padStart(2, "0"), String(day).padStart(2, "0")].join("-");
}
function ascii(value: string) { return value.replace(/\s+/g, " ").trim(); }
function parseIdentity(lines: Line[]): OCRCandidate {
  const row: Record<string, string> = {};
  const confidence: Record<string, number> = {};
  const clean = lines.map(l => ({text: ascii(l.text), score: l.score})).filter(l => l.text);
  const set = (key: string, value: string | null, score: number) => {
    if (value && !row[key] && score >= 0.58 && value.length <= 180) {
      row[key] = value; confidence[key] = Math.max(0, Math.min(1, score));
    }
  };
  const fieldPatterns: Array<[string, RegExp]> = [
    ["full_name", /^(?:FULL\s*NAME|CARDHOLDER(?:\s+NAME)?|NAME)\s*[:#-]\s*([A-Za-z][A-Za-z '-]{2,90})$/i],
    ["date_of_birth", /^(?:DATE\s+OF\s+BIRTH|BIRTH\s+DATE|DOB|DBB)\s*[:#-]?\s*(\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4})$/i],
    ["street", /^(?:ADDRESS|STREET)\s*[:#-]\s*(\d{1,7}\s+.{3,90})$/i],
    ["city", /^CITY\s*[:#-]\s*([A-Za-z '-]{2,60})$/i],
    ["state", /^STATE\s*[:#-]\s*([A-Z]{2})$/i],
    ["zip", /^(?:ZIP|POSTAL\s+CODE)\s*[:#-]\s*(\d{5}(?:-\d{4})?)$/i],
  ];
  for (let i=0; i<clean.length; i++) {
    const line=clean[i];
    for (const [key, rx] of fieldPatterns) {
      const match=rx.exec(line.text);
      if (!match) continue;
      set(key, key === "date_of_birth" ? dateFromExplicitSource(match[1]) : ascii(match[1]), line.score);
    }
  }
  // Many US identity cards print SURNAME and GIVEN NAME on separate OCR lines.
  const last: string[]=[]; const given: string[]=[]; const nameScores: number[]=[];
  for (let i=0;i<clean.length - 1;i++) {
    const label=clean[i].text.toUpperCase().replace(/[^A-Z ]/g, "").trim();
    const next=clean[i+1];
    if (!/^[A-Z][A-Z '-]{1,65}$/.test(next.text.toUpperCase())) continue;
    if (label==="SURNAME" || label==="LAST NAME") {last.push(next.text);nameScores.push(next.score);}
    if (label==="GIVEN NAME" || label==="GIVEN NAMES" || label==="FIRST NAME") {given.push(next.text);nameScores.push(next.score);}
  }
  if (last.length && given.length) set("full_name", [given[0],last[0]].join(" "), Math.min(...nameScores));
  return {row, confidence};
}

export async function recognizeDocumentInBrowser(file: File): Promise<BrowserOcrResult> {
  if (!/^image\/(?:jpeg|png|webp)$/.test(file.type)) {
    throw new Error("Browser OCR currently supports JPG, PNG and WebP; PDF requires a separate rendering path.");
  }
  const started=performance.now();
  const engine=await getEngine();
  const { data } = await engine.recognize(file);
  const lines: Line[] = data.text.split(/\r?\n/).map((text) => ({ text, score: data.confidence / 100 })).filter((line) => line.text.trim());
  if (!lines.length) throw new Error("No readable text detected. Retake a sharper photo or enter details manually.");
  const candidate=parseIdentity(lines);
  // Unlabelled OCR lines are not silently assigned to sensitive identity fields.
  if (!Object.keys(candidate.row).length) {
    throw new Error("Text recognized but identity fields could not be verified. Use a clearer image or manual entry.");
  }
  return {candidates:[candidate],recognizedCount:lines.length,elapsedMs:Math.round(performance.now()-started)};
}
