import { ApiError, api } from "./api";
import { recordingsStore } from "./idb";
import type { Recording } from "./types";

export type ArabicLocale = "ar" | "ar-YE" | "ar-EG" | "ar-SY" | "ar-LB" | "ar-IQ";
export type RecordingType =
  | "interrogation"
  | "witness_testimony"
  | "meeting"
  | "phone_call"
  | "court_session"
  | "third_circuit_transcript"
  | "michigan_appellate_transcript"
  | "other";

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

export type PendingUpload = {
  fingerprint: string;
  name: string;
  size: number;
  uploadId: string;
  title: string;
  storedRecordingId?: string;
};

const PENDING_KEY = "murailex.pendingUploads";

export function fingerprintOf(file: File | Blob, name: string): string {
  const lm = file instanceof File ? file.lastModified : 0;
  return `${name}:${file.size}:${lm}`.slice(0, 200);
}

export function pendingUploads(): PendingUpload[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PendingUpload =>
      !!item && typeof item === "object" && typeof item.fingerprint === "string" &&
      typeof item.uploadId === "string" && typeof item.name === "string" &&
      typeof item.size === "number" && typeof item.title === "string",
    );
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

export function forgetPending(fingerprint: string, uploadId?: string) {
  savePending(pendingUploads().filter((p) => p.fingerprint !== fingerprint || (uploadId !== undefined && p.uploadId !== uploadId)));
}

async function sha256Hex(buf: ArrayBuffer): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type UploadOptions = {
  name: string;
  title: string;
  source: "upload" | "recording";
  storedRecordingId?: string;
  languageLocale?: ArabicLocale;
  recordingType?: RecordingType;
  expectedTerms?: string[];
  expectedSpeakers?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

async function clearCompletedUpload(pending: PendingUpload): Promise<void> {
  if (pending.storedRecordingId) await recordingsStore.remove(pending.storedRecordingId);
  forgetPending(pending.fingerprint, pending.uploadId);
}

/** Remove only uploads the authenticated server confirms are already complete. */
export async function reconcilePendingUploads(): Promise<void> {
  await Promise.allSettled(pendingUploads().map(async (pending) => {
    const session = await api<UploadSessionInfo>(`/api/uploads/${pending.uploadId}`);
    if (session.status === "complete" && session.recording_id) await clearCompletedUpload(pending);
  }));
}

export async function resumableUpload(blob: Blob, opts: UploadOptions): Promise<Recording> {
  for (let restart = 0; restart < 2; restart++) {
    try {
      return await uploadOnce(blob, opts);
    } catch (error) {
      const expired = error instanceof ApiError && error.status === 409 &&
        !!error.detail && typeof error.detail === "object" && "code" in error.detail &&
        error.detail.code === "UPLOAD_SESSION_EXPIRED";
      if (!expired || restart > 0) throw error;
      forgetPending(fingerprintOf(blob, opts.name));
    }
  }
  throw new Error("Unable to restart the expired upload.");
}

async function uploadOnce(blob: Blob, opts: UploadOptions): Promise<Recording> {
  const fingerprint = fingerprintOf(blob, opts.name);
  const mime = blob.type || "application/octet-stream";
  const session = await api<UploadSessionInfo>("/api/uploads", {
    method: "POST",
    json: {
      filename: opts.name,
      mime_type: mime,
      size: blob.size,
      fingerprint,
      title: opts.title,
      source: opts.source,
      language_locale: opts.languageLocale ?? "ar",
      recording_type: opts.recordingType ?? "other",
      expected_terms: opts.expectedTerms?.length ? opts.expectedTerms : null,
      expected_speakers: opts.expectedSpeakers ?? null,
    },
  });
  savePending([
    ...pendingUploads().filter((pending) => pending.fingerprint !== fingerprint),
    {
      fingerprint,
      name: opts.name,
      size: blob.size,
      uploadId: session.id,
      title: opts.title,
      storedRecordingId: opts.storedRecordingId,
    },
  ]);

  const done = new Set(session.received_parts);
  let sent = session.received_bytes;
  opts.onProgress?.(sent / blob.size);
  for (let number = 1; number <= session.total_parts; number++) {
    if (done.has(number)) continue;
    const start = (number - 1) * session.chunk_size;
    const chunk = blob.slice(start, Math.min(blob.size, start + session.chunk_size));
    const buffer = await chunk.arrayBuffer();
    const digest = await sha256Hex(buffer);
    for (let attempt = 0; ; attempt++) {
      if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
      try {
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          throw new TypeError("offline");
        }
        await api(`/api/uploads/${session.id}/parts/${number}`, {
          method: "PUT",
          body: buffer,
          headers: {
            "content-type": "application/octet-stream",
            ...(digest ? { "x-chunk-sha256": digest } : {}),
          },
          signal: opts.signal,
        });
        break;
      } catch (error) {
        const retryable = !(error instanceof ApiError) || error.status >= 500 || error.status === 429;
        if (!retryable || attempt >= 8) throw error;
        await sleep(Math.min(30000, 1000 * 2 ** attempt));
      }
    }
    sent += chunk.size;
    opts.onProgress?.(sent / blob.size);
  }
  const result = await api<{ recording: Recording }>(`/api/uploads/${session.id}/complete`, {
    method: "POST",
  });
  try {
    await clearCompletedUpload({
      fingerprint, name: opts.name, size: blob.size, uploadId: session.id,
      title: opts.title, storedRecordingId: opts.storedRecordingId,
    });
  } catch {
    // The server accepted the audio. Retain the local entry for later cleanup;
    // never report a failed upload or upload the same audio again for an IDB error.
  }
  return result.recording;
}
