import { parseIdentityLines, type OcrCandidate } from "@/lib/smart/identity-ocr-parser";
import { createWorker, type Worker } from "tesseract.js";

type Line = { text: string; score: number };
export type BrowserOcrResult = { candidates: OcrCandidate[]; recognizedCount: number; elapsedMs: number };
let instance: Promise<Worker> | null = null;

/** Reuse one initialized worker. Do not include model download in the recognition timeout. */
export function prepareDocumentOcr(): Promise<Worker> {
  if (!instance) {
    instance = createWorker("eng", 1);
    void instance.catch(() => { instance = null; });
  }
  return instance;
}

async function prepareImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const maxEdge = 1800;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Image processing is unavailable in this browser.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not prepare document image.")), "image/png"));
  } finally {
    bitmap.close();
  }
}

function withTimeout<T>(job: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    job,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

/** Read immediately after selection. Values without explicit evidence stay empty. */
export async function recognizeDocumentInBrowser(file: File): Promise<BrowserOcrResult> {
  if (!/^image\/(?:jpeg|png|webp)$/.test(file.type)) {
    throw new Error("OCR accepts JPG, PNG and WebP images. Convert PDF pages to images before extraction.");
  }
  const started = performance.now();
  const [worker, image] = await Promise.all([
    withTimeout(prepareDocumentOcr(), 60000, "OCR model could not initialize. Check the network and retry."),
    prepareImage(file),
  ]);
  const { data } = await withTimeout(worker.recognize(image), 20000, "Document reading timed out. Retry with a clearer image.");
  const lines: Line[] = data.text.split(/\r?\n/).map(text => ({
    text,
    score: Math.max(0, Math.min(1, data.confidence / 100)),
  })).filter(line => line.text.trim());
  if (!lines.length) throw new Error("No readable text found in this image.");
  const candidate = parseIdentityLines(lines);
  if (!Object.keys(candidate.row).length) {
    throw new Error("Text was read but no identity field could be verified from the document.");
  }
  return { candidates: [candidate], recognizedCount: lines.length, elapsedMs: Math.round(performance.now() - started) };
}
