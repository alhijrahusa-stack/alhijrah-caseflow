import { ApiError, api } from "./api";
import type { Recording } from "./types";

export type UploadSessionInfo = {
  id: string;
  status: string;
  chunk_size: number;
  total_size: number;
  received_parts: number[];
  total_parts: number;
  received_bytes: number;
  recording_id: string | null;
};

export type PendingUpload = { fingerprint: string; name: string; size: number; uploadId: string; title: string; storedRecordingId?: string };

const PENDING_KEY = "murailex.pendingUploads";

export function fingerprintOf(file: File | Blob, name: string): string {
  const lm = file instanceof File ? file.lastModified : 0;
  return `${name}:${file.size}:${lm}`.slice(0, 200);
}

export function pendingUploads(): PendingUpload[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]") as PendingUpload[];
  } catch {
    return [];
  }
}

function savePending(list: PendingUpload[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

export function forgetPending(fingerprint: string) {
  savePending(pendingUploads().filter((p) => p.fingerprint !== fingerprint));
}

async function sha256Hex(buf: ArrayBuffer): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resumable, chunked upload. The server keeps the multipart session; a reload or a
 * network loss resumes from the parts the server already acknowledged.
 */
export async function resumableUpload(
  blob: Blob,
  opts: {
    name: string;
    title: string;
    source: "upload" | "recording";
    storedRecordingId?: string;
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
  },
): Promise<Recording> {
  const fingerprint = fingerprintOf(blob, opts.name);
  const mime = blob.type || "application/octet-stream";
  const session = await api<UploadSessionInfo>("/api/uploads", {
    method: "POST",
    json: { filename: opts.name, mime_type: mime, size: blob.size, fingerprint, title: opts.title, source: opts.source },
  });
  savePending([
    ...pendingUploads().filter((p) => p.fingerprint !== fingerprint),
    { fingerprint, name: opts.name, size: blob.size, uploadId: session.id, title: opts.title, storedRecordingId: opts.storedRecordingId },
  ]);
  const done = new Set(session.received_parts);
  let sent = session.received_bytes;
  opts.onProgress?.(sent / blob.size);
  for (let n = 1; n <= session.total_parts; n++) {
    if (done.has(n)) continue;
    const start = (n - 1) * session.chunk_size;
    const chunk = blob.slice(start, Math.min(blob.size, start + session.chunk_size));
    const buf = await chunk.arrayBuffer();
    const digest = await sha256Hex(buf);
    for (let attempt = 0; ; attempt++) {
      if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
      try {
        if (typeof navigator !== "undefined" && navigator.onLine === false) throw new TypeError("offline");
        await api(`/api/uploads/${session.id}/parts/${n}`, {
          method: "PUT",
          body: buf,
          headers: { "content-type": "application/octet-stream", ...(digest ? { "x-chunk-sha256": digest } : {}) },
          signal: opts.signal,
        });
        break;
      } catch (e) {
        const retryable = !(e instanceof ApiError) || e.status >= 500 || e.status === 429;
        if (!retryable || attempt >= 8) throw e;
        await sleep(Math.min(30000, 1000 * 2 ** attempt));
      }
    }
    sent += chunk.size;
    opts.onProgress?.(sent / blob.size);
  }
  const res = await api<{ recording: Recording }>(`/api/uploads/${session.id}/complete`, { method: "POST" });
  forgetPending(fingerprint);
  return res.recording;
}
