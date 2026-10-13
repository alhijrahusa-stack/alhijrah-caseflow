/**
 * Preparing a document for the read.
 *
 * A phone photograph of an identity card is routinely 4–8 MB of mostly redundant
 * pixels: the text is legible far below the sensor's resolution. Uploading the
 * original is the single largest cost in the zero-click path, so an image is
 * re-encoded in the browser to the longest edge the read actually needs before any
 * byte leaves the device.
 *
 * Three rules keep this safe:
 *   - A PDF is never touched. Re-encoding one would lose pages and embedded text.
 *   - The original is kept whenever the re-encode is not clearly smaller, so a
 *     screenshot or an already-small image is never made worse.
 *   - Any failure returns the original file. Downscaling is an optimization, and an
 *     optimization that cannot run must not cost the staff member their document.
 */

/** The longest edge kept. Identity-document text stays legible well below this. */
export const DOWNSCALE_MAX_EDGE = 2000;
/** Below this, re-encoding is not worth the CPU or the quality loss. */
export const DOWNSCALE_MIN_BYTES = 600 * 1024;
/** The re-encode has to save this much to be worth using. */
const WORTH_IT_RATIO = 0.8;
const JPEG_QUALITY = 0.86;

export type PreparedDocument = {
  file: File;
  /** True when the uploaded bytes differ from the chosen file's. */
  downscaled: boolean;
  originalBytes: number;
  bytes: number;
};

function unchanged(file: File): PreparedDocument {
  return { file, downscaled: false, originalBytes: file.size, bytes: file.size };
}

function decode(file: File): Promise<{ width: number; height: number; draw: (context: CanvasRenderingContext2D, w: number, h: number) => void }> {
  // createImageBitmap decodes off the main thread where it exists, which keeps the
  // surface responsive while a large photograph is being prepared.
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file).then((bitmap) => ({
      width: bitmap.width,
      height: bitmap.height,
      draw: (context, w, h) => { context.drawImage(bitmap, 0, 0, w, h); bitmap.close?.(); },
    }));
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
        draw: (context, w, h) => context.drawImage(image, 0, 0, w, h),
      });
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode failed")); };
    image.src = url;
  });
}

/**
 * The file to upload for this document. Never throws: on any failure the original
 * file is returned, so the read still happens with the bytes the person chose.
 */
export async function prepareForUpload(file: File): Promise<PreparedDocument> {
  const mime = (file.type || "").toLowerCase();
  if (!mime.startsWith("image/")) return unchanged(file);
  if (file.size < DOWNSCALE_MIN_BYTES) return unchanged(file);
  if (typeof document === "undefined") return unchanged(file);

  try {
    const source = await decode(file);
    const longest = Math.max(source.width, source.height);
    if (!longest || longest <= DOWNSCALE_MAX_EDGE) return unchanged(file);

    const scale = DOWNSCALE_MAX_EDGE / longest;
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return unchanged(file);
    // A white backdrop so a transparent PNG does not become black text on black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    source.draw(context, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob || blob.size >= file.size * WORTH_IT_RATIO) return unchanged(file);

    const name = file.name.replace(/\.[^.]+$/, "") || "document";
    return {
      file: new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: file.lastModified }),
      downscaled: true,
      originalBytes: file.size,
      bytes: blob.size,
    };
  } catch {
    return unchanged(file);
  }
}
