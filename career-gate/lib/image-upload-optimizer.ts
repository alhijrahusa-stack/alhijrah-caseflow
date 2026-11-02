/**
 * Browser-side preparation of document photos before upload.
 *
 * Phone photos of IDs and documents are often 3–8 MB and 4000+ px wide, which
 * exceeds the 4 MB document limit and slows previews. A photo is redrawn to fit
 * within MAX_EDGE px on its long side and re-encoded as WebP (JPEG where the
 * browser cannot encode WebP). PDFs and non-image files pass through untouched,
 * and the original is kept whenever re-encoding would not make it smaller, fails,
 * or the browser lacks the APIs. The server still sniffs the bytes, decodes the
 * image and runs its own quality checks, so nothing here is trusted for security.
 */

export const MAX_EDGE = 1920;
export const WEBP_QUALITY = 0.86;
/** Below this size and within MAX_EDGE, re-encoding gains too little to be worth a quality loss. */
export const SMALL_ENOUGH_BYTES = 350 * 1024;

const RASTER = new Set(["image/jpeg", "image/png", "image/webp"]);

export type OptimizedUpload = { file: File; optimized: boolean; originalBytes: number; bytes: number };

export type ImagePlan = { resize: boolean; width: number; height: number; reencode: boolean };

/** Pure decision: target size and whether to re-encode. Exported for tests. */
export function planImage(input: { type: string; size: number; width: number; height: number }): ImagePlan {
  const { width, height } = input;
  const longEdge = Math.max(width, height);
  if (!RASTER.has(input.type) || width < 1 || height < 1) return { resize: false, width, height, reencode: false };
  const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;
  const resize = scale < 1;
  return {
    resize,
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    reencode: resize || input.size > SMALL_ENOUGH_BYTES,
  };
}

/** `photo.HEIC.jpg` → `photo.HEIC.webp`; a name without an extension gets one. */
export function renamedFor(name: string, type: string) {
  const ext = type === "image/webp" ? "webp" : "jpg";
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name || "document";
  return `${stem}.${ext}`;
}

function encode(canvas: OffscreenCanvas | HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality }).catch(() => null);
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

export async function optimizeImageForUpload(file: File): Promise<OptimizedUpload> {
  const unchanged: OptimizedUpload = { file, optimized: false, originalBytes: file.size, bytes: file.size };
  if (!RASTER.has(file.type) || typeof createImageBitmap !== "function") return unchanged;
  let bitmap: ImageBitmap | null = null;
  try {
    // EXIF orientation is applied, so a rotated phone photo stays upright.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const plan = planImage({ type: file.type, size: file.size, width: bitmap.width, height: bitmap.height });
    if (!plan.reencode) return unchanged;
    const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(plan.width, plan.height)
      : Object.assign(document.createElement("canvas"), { width: plan.width, height: plan.height });
    const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!context) return unchanged;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, plan.width, plan.height);
    let blob = await encode(canvas, "image/webp", WEBP_QUALITY);
    if (!blob || blob.type !== "image/webp") {
      // No WebP encoder: JPEG on a white ground, since JPEG has no transparency.
      context.globalCompositeOperation = "destination-over";
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, plan.width, plan.height);
      blob = await encode(canvas, "image/jpeg", 0.88);
    }
    if (!blob || blob.size === 0 || blob.size >= file.size) return unchanged;
    const optimized = new File([blob], renamedFor(file.name, blob.type), { type: blob.type, lastModified: file.lastModified });
    return { file: optimized, optimized: true, originalBytes: file.size, bytes: optimized.size };
  } catch {
    return unchanged;
  } finally {
    bitmap?.close();
  }
}

export async function optimizeFilesForUpload(files: Iterable<File>): Promise<OptimizedUpload[]> {
  const list = Array.from(files);
  // Sequential: decoding several 12-megapixel photos at once can exhaust memory on phones.
  const out: OptimizedUpload[] = [];
  for (const file of list) out.push(await optimizeImageForUpload(file));
  return out;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
