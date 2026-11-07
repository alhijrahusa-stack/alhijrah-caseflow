import { api } from "./api";

const MAX_AUDIO_BYTES = 25_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Load an authorized original without changing its recording or forensic state. */
export async function loadSavedAudio(recordingId: string, signal?: AbortSignal): Promise<{ file: File; sha256: string }> {
  if (!UUID.test(recordingId)) throw new Error("Invalid recording identifier.");
  const id = recordingId.toLowerCase();
  const detail = await api<{ recording: { id: string; byte_size: number; sha256: string; original_filename: string; mime_type: string } }>(`/api/recordings/${id}`, { signal });
  const rec = detail.recording;
  if (!rec || rec.id !== id || !Number.isSafeInteger(rec.byte_size) || rec.byte_size <= 0 ||
      typeof rec.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(rec.sha256) ||
      typeof rec.original_filename !== "string" || typeof rec.mime_type !== "string") {
    throw new Error("The saved recording has invalid source metadata.");
  }
  if (rec.byte_size > MAX_AUDIO_BYTES) throw new Error("Direct transcription accepts saved recordings up to 25 MB.");
  const media = await api<{ url: string }>(`/api/recordings/${id}/media-url?variant=original`, { signal });
  if (typeof media.url !== "string") throw new Error("Original audio link is unavailable.");
  const url = new URL(media.url, location.origin);
  if (url.origin !== location.origin || url.pathname !== `/api/media/${id}/original` || url.username || url.password) {
    throw new Error("Original audio link does not match this recording.");
  }
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", redirect: "error", signal });
  if (!response.ok || !response.body) throw new Error(`Original audio could not be loaded (HTTP ${response.status}).`);
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > rec.byte_size || size > MAX_AUDIO_BYTES) {
        await reader.cancel();
        throw new Error("Original audio size does not match the saved recording.");
      }
      chunks.push(new Uint8Array(value).buffer);
    }
  } finally {
    reader.releaseLock();
  }
  if (size !== rec.byte_size) throw new Error("Original audio size does not match the saved recording.");
  const file = new File(chunks, rec.original_filename, { type: rec.mime_type });
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  if (sha256 !== rec.sha256.toLowerCase()) throw new Error("Original audio SHA-256 verification failed; no transcription was requested.");
  return { file, sha256 };
}
