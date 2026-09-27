import "server-only";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import type { DOC_MIME } from "@/lib/domain";

type Mime = (typeof DOC_MIME)[number];

export type Quality = {
  decoded: boolean;
  mime: Mime;
  size_bytes: number;
  width: number | null;
  height: number | null;
  page_count: number | null;
  orientation: number | null;
  /** Advisory only: variance of a Laplacian filter over a greyscale preview. */
  sharpness: number | null;
  advisories: string[];
  error: string | null;
};

const EXT: Record<Mime, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
};

/** The file-name extension must agree with the sniffed content type. */
export function extensionMatches(fileName: string, mime: Mime) {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (!fileName.includes(".")) return true;
  return EXT[mime].includes(ext);
}

/** Decodes the file fully; decode failure means the upload is corrupt. */
export async function assessQuality(bytes: Uint8Array, mime: Mime): Promise<Quality> {
  const q: Quality = {
    decoded: false, mime, size_bytes: bytes.byteLength, width: null, height: null, page_count: null,
    orientation: null, sharpness: null, advisories: [], error: null,
  };
  try {
    if (mime === "application/pdf") {
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      q.page_count = pdf.getPageCount();
      if (q.page_count < 1) throw new Error("PDF has no pages");
      const first = pdf.getPage(0).getSize();
      q.width = Math.round(first.width);
      q.height = Math.round(first.height);
      q.decoded = true;
      return q;
    }
    const img = sharp(bytes, { failOn: "error" });
    const meta = await img.metadata();
    q.width = meta.width ?? null;
    q.height = meta.height ?? null;
    q.orientation = meta.orientation ?? null;
    q.page_count = 1;
    // Full decode of a bounded preview; corrupt data throws here.
    const { data, info } = await sharp(bytes, { failOn: "error" })
      .rotate()
      .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    q.decoded = true;
    q.sharpness = laplacianVariance(data, info.width, info.height);
    if ((q.width ?? 0) < 600 || (q.height ?? 0) < 400) q.advisories.push("low_resolution");
    if (q.sharpness !== null && q.sharpness < 50) q.advisories.push("possibly_blurry");
    if (q.orientation && q.orientation !== 1) q.advisories.push("rotated_exif");
    return q;
  } catch (e) {
    q.error = e instanceof Error ? e.message.slice(0, 200) : "decode failed";
    return q;
  }
}

function laplacianVariance(px: Buffer, w: number, h: number) {
  if (w < 3 || h < 3) return null;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = px[i - w] + px[i + w] + px[i - 1] + px[i + 1] - 4 * px[i];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return Math.round((sumSq / n - mean * mean) * 10) / 10;
}

export async function thumbnail(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await sharp(bytes).rotate().resize({ width: 320, height: 320, fit: "inside" }).webp({ quality: 70 }).toBuffer());
}
