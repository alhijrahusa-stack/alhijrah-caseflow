import { DOC_MAX_BYTES, DOC_MIME } from "@/lib/domain";

type Mime = (typeof DOC_MIME)[number];

/** Identifies the file from its leading bytes; the browser's claimed type is not trusted. */
export function sniffMime(bytes: Uint8Array): Mime | null {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  return null;
}

export async function readUpload(file: File): Promise<{ bytes: Uint8Array; mime: Mime } | { error: string }> {
  if (file.size === 0) return { error: "File is empty" };
  if (file.size > DOC_MAX_BYTES) return { error: "File is larger than 4 MB" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes);
  if (!mime) return { error: "Only JPEG, PNG, WebP or PDF files are accepted" };
  return { bytes, mime };
}

export function safeFileName(name: string) {
  const cleaned = name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/^_+/, "");
  return (cleaned || "document").slice(-100);
}
