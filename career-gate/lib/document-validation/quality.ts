import "server-only";

import sharp from "sharp";
import type { DocumentQuality, VerificationState } from "@/lib/providers/document-intelligence-types";

type QualityCheck = DocumentQuality["checks"][number];

function overall(checks: QualityCheck[]): VerificationState {
  if (checks.some((item) => item.result === "FAILED")) return "FAILED";
  if (checks.some((item) => item.result === "REVIEW")) return "REVIEW";
  if (checks.some((item) => item.result === "PASSED")) return "PASSED";
  return "NOT_PERFORMED";
}

function variance(values: number[]) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

async function laplacianVariance(buffer: Buffer) {
  const { data, info } = await sharp(buffer)
    .greyscale()
    .resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const values: number[] = [];
  const width = info.width;
  const height = info.height;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const center = data[i] * 4;
      const lap = center - data[i - 1] - data[i + 1] - data[i - width] - data[i + width];
      values.push(lap);
    }
  }
  return variance(values);
}

async function glareRatio(buffer: Buffer) {
  const { data, info } = await sharp(buffer)
    .resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  let bright = 0;
  const pixels = Math.floor(data.length / channels);
  for (let i = 0; i < data.length; i += channels) {
    let min = 255;
    for (let c = 0; c < channels; c += 1) min = Math.min(min, data[i + c]);
    if (min >= 248) bright += 1;
  }
  return pixels ? bright / pixels : 0;
}

/**
 * Deterministic capture-quality preflight. These signals only describe image
 * usability. They are never evidence that a document is genuine or fraudulent.
 */
export async function preflightImageQuality(bytes: Uint8Array, mimeType: string): Promise<DocumentQuality> {
  if (!mimeType.startsWith("image/")) return { overall: "NOT_PERFORMED", checks: [] };

  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    const image = sharp(buffer, { failOn: "none" });
    const [metadata, stats, blur, glare] = await Promise.all([
      image.metadata(),
      sharp(buffer, { failOn: "none" }).stats(),
      laplacianVariance(buffer),
      glareRatio(buffer),
    ]);

    const checks: QualityCheck[] = [];
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    checks.push({
      type: "RESOLUTION",
      result: width >= 600 && height >= 350 ? "PASSED" : "FAILED",
      probability: null,
      regions: [],
    });

    const brightness = stats.channels.length
      ? stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / Math.min(3, stats.channels.length)
      : 0;
    checks.push({
      type: "BRIGHTNESS",
      result: brightness < 20 || brightness > 245 ? "FAILED" : brightness < 40 || brightness > 230 ? "REVIEW" : "PASSED",
      probability: Number(brightness.toFixed(2)),
      regions: [],
    });

    checks.push({
      type: "BLUR",
      // This is a capture-quality heuristic, so borderline results require
      // review rather than being declared a hard failure.
      result: blur < 35 ? "REVIEW" : "PASSED",
      probability: Number(blur.toFixed(2)),
      regions: [],
    });

    checks.push({
      type: "GLARE",
      result: glare > 0.18 ? "REVIEW" : "PASSED",
      probability: Number((glare * 100).toFixed(2)),
      regions: [],
    });

    checks.push({
      type: "ORIENTATION",
      result: metadata.orientation ? "PASSED" : "NOT_PERFORMED",
      probability: metadata.orientation ?? null,
      regions: [],
    });

    return { overall: overall(checks), checks };
  } catch {
    return {
      overall: "REVIEW",
      checks: [{ type: "IMAGE_READABILITY", result: "REVIEW", probability: null, regions: [] }],
    };
  }
}

export function qualityFailureMessage(quality: DocumentQuality) {
  const failed = quality.checks.filter((item) => item.result === "FAILED").map((item) => item.type);
  if (!failed.length) return null;
  if (failed.includes("RESOLUTION")) return "The document image is too small to read reliably. Retake or upload a higher-resolution image.";
  if (failed.includes("BRIGHTNESS")) return "The document image is too dark or overexposed. Retake it in even lighting.";
  return "The document image quality is not sufficient for reliable extraction. Retake the document image.";
}
