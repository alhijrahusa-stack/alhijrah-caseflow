import { parseIdentityLines } from "@/lib/smart/identity-ocr-parser";
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
export async function recognizeDocumentInBrowser(file: File): Promise<BrowserOcrResult> {
  if (!/^image\/(?:jpeg|png|webp)$/.test(file.type)) {
    throw new Error("Browser OCR currently supports JPG, PNG and WebP; PDF requires a separate rendering path.");
  }
  const started=performance.now();
  const result = await Promise.race([getEngine().then((engine) => engine.recognize(file)), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("OCR exceeded 25 seconds. Retry with a sharper, cropped image.")), 25000))]);
  const { data } = result;
  const lines: Line[] = data.text.split(/\r?\n/).map((text) => ({ text, score: data.confidence / 100 })).filter((line) => line.text.trim());
  if (!lines.length) throw new Error("No readable text detected. Retake a sharper photo or enter details manually.");
  const candidate=parseIdentityLines(lines);
  // Unlabelled OCR lines are not silently assigned to sensitive identity fields.
  if (!Object.keys(candidate.row).length) {
    throw new Error("Text recognized but identity fields could not be verified. Use a clearer image or manual entry.");
  }
  return {candidates:[candidate],recognizedCount:lines.length,elapsedMs:Math.round(performance.now()-started)};
}
