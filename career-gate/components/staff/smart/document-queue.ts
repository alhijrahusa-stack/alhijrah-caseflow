/**
 * Local document ingestion for Smart source capture.
 *
 * Nothing leaves the browser before it passes local validation here, and every locally
 * previewable file gets an object URL that this module is responsible for revoking.
 * Client-side validation is UX and hardening only — the server stays authoritative for
 * type, size and authorization, so the limits below mirror the server policy rather
 * than replacing it.
 */

export const SMART_DOCUMENT_POLICY = Object.freeze({
  maxFiles: 10,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
  /** Mirrors the server's supported mobile intake types. */
  mimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const,
  extensions: [".pdf", ".jpg", ".jpeg", ".png", ".webp"] as const,
});

export const SMART_DOCUMENT_ACCEPT = [...SMART_DOCUMENT_POLICY.mimeTypes, ...SMART_DOCUMENT_POLICY.extensions].join(",");

/** Local validation outcome for one file. */
export type LocalValidationState = "VALIDATED" | "REJECTED";
/** Where the file is in the capture → storage → processing lifecycle. */
export type DocumentUploadState = "READY_TO_UPLOAD" | "UPLOADING" | "STORED" | "FAILED";
export type DocumentProcessingState =
  | "WAITING"
  | "QUEUED"
  | "UPLOADING"
  | "READING"
  | "EXTRACTING"
  | "VALIDATING"
  | "PROCESSING"
  | "COMPLETE"
  | "REVIEW_REQUIRED"
  | "FAILED";
/** How the file can be shown locally before any upload. */
export type PreviewKind = "image" | "unsupported";

export type QueuedDocument = {
  id: string;
  file: File;
  name: string;
  mime: string;
  size: number;
  localState: LocalValidationState;
  /** Set only when localState is REJECTED; it is the exact reason, never a generic message. */
  rejection: string | null;
  uploadState: DocumentUploadState;
  processingState: DocumentProcessingState;
  previewKind: PreviewKind;
  /** Object URL for an image preview; null for every other type. Revoked by releaseDocuments. */
  previewUrl: string | null;
  /** What the document itself was read to be, once a read has returned. */
  documentType: string | null;
  /** How readable the source image was, as the read reported it. */
  legibility: string | null;
  /** True when a weak first read was given a second, stronger one. */
  escalated: boolean;
  /** Fields this document contributed, and fields it left for review. */
  importedFields: readonly string[];
  reviewFields: readonly string[];
  /** The exact reason this document's read did not complete, never a generic one. */
  processingError: string | null;
  /** Wall-clock time of the read that produced the above, in milliseconds. */
  durationMs: number | null;
  /**
   * Whether the document's machine readable zone passed its check digits. Null when
   * the document has no band — which is most documents, and not a problem.
   */
  mrzVerified: boolean | null;
  mrzFormat: string | null;
};

export type DocumentQueueResult = {
  documents: QueuedDocument[];
  /** Files that could not be admitted at all, with the exact reason for each. */
  rejected: { name: string; reason: string }[];
};

type UrlFactory = { create: (file: Blob) => string; revoke: (url: string) => void };

const browserUrls: UrlFactory = {
  create: (file) => URL.createObjectURL(file),
  revoke: (url) => URL.revokeObjectURL(url),
};

function extensionOf(name: string) {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}

function isSupportedType(file: File) {
  const mime = (file.type || "").toLowerCase();
  if ((SMART_DOCUMENT_POLICY.mimeTypes as readonly string[]).includes(mime)) return true;
  // A browser can report an empty type; the extension is then the only local signal.
  // The server re-checks the real type either way.
  return !mime && (SMART_DOCUMENT_POLICY.extensions as readonly string[]).includes(extensionOf(file.name));
}

function previewKindOf(file: File): PreviewKind {
  return (file.type || "").toLowerCase().startsWith("image/") ? "image" : "unsupported";
}

function formatMb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatDocumentSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : formatMb(bytes);
}

let sequence = 0;
function nextId() {
  sequence += 1;
  const unique = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(sequence);
  return `doc-${sequence}-${unique}`;
}

/**
 * Admits incoming files into the queue. Validation runs before any object URL is created,
 * so a rejected file never allocates one. The returned queue is a new array; callers
 * release the documents they drop.
 */
export function admitDocuments(
  current: readonly QueuedDocument[],
  incoming: readonly File[],
  urls: UrlFactory = browserUrls,
): DocumentQueueResult {
  const documents = [...current];
  const rejected: { name: string; reason: string }[] = [];
  let totalBytes = documents.reduce((sum, entry) => sum + entry.size, 0);

  for (const file of incoming) {
    const name = file.name || "upload";
    if (documents.length >= SMART_DOCUMENT_POLICY.maxFiles) {
      rejected.push({ name, reason: `Maximum ${SMART_DOCUMENT_POLICY.maxFiles} files per submission.` });
      continue;
    }
    if (documents.some((entry) => entry.name === name && entry.size === file.size)) {
      rejected.push({ name, reason: "Already in this submission." });
      continue;
    }
    if (!isSupportedType(file)) {
      rejected.push({ name, reason: `Unsupported type ${file.type || extensionOf(name) || "unknown"}. Accepts PDF, JPG, PNG, WebP.` });
      continue;
    }
    if (!file.size) {
      rejected.push({ name, reason: "File is empty." });
      continue;
    }
    if (file.size > SMART_DOCUMENT_POLICY.maxFileBytes) {
      rejected.push({ name, reason: `${formatMb(file.size)} exceeds the ${formatMb(SMART_DOCUMENT_POLICY.maxFileBytes)} per-file limit.` });
      continue;
    }
    if (totalBytes + file.size > SMART_DOCUMENT_POLICY.maxTotalBytes) {
      rejected.push({ name, reason: `Total upload would exceed ${formatMb(SMART_DOCUMENT_POLICY.maxTotalBytes)}.` });
      continue;
    }

    const previewKind = previewKindOf(file);
    let previewUrl: string | null = null;
    if (previewKind === "image") {
      try { previewUrl = urls.create(file); } catch { previewUrl = null; }
    }
    documents.push({
      id: nextId(),
      file,
      name,
      mime: file.type || "application/octet-stream",
      size: file.size,
      localState: "VALIDATED",
      rejection: null,
      uploadState: "READY_TO_UPLOAD",
      processingState: "WAITING",
      previewKind,
      previewUrl,
      documentType: null,
      legibility: null,
      escalated: false,
      importedFields: [],
      reviewFields: [],
      processingError: null,
      durationMs: null,
      mrzVerified: null,
      mrzFormat: null,
    });
    totalBytes += file.size;
  }

  return { documents, rejected };
}

/** Revokes the object URLs held by the given documents. Safe to call more than once. */
export function releaseDocuments(documents: readonly QueuedDocument[], urls: UrlFactory = browserUrls) {
  for (const entry of documents) {
    if (!entry.previewUrl) continue;
    try { urls.revoke(entry.previewUrl); } catch { /* already revoked or unsupported */ }
  }
}

/** Removes one document and releases only that document's object URL. */
export function removeDocument(
  current: readonly QueuedDocument[],
  id: string,
  urls: UrlFactory = browserUrls,
): QueuedDocument[] {
  const dropped = current.filter((entry) => entry.id === id);
  releaseDocuments(dropped, urls);
  return current.filter((entry) => entry.id !== id);
}

export function advanceDocuments(
  current: readonly QueuedDocument[],
  patch: { uploadState?: DocumentUploadState; processingState?: DocumentProcessingState },
): QueuedDocument[] {
  return current.map((entry) => ({ ...entry, ...patch }));
}

/** The fields of one queued document that its own read is allowed to change. */
export type DocumentPatch = Partial<Pick<QueuedDocument,
  | "uploadState"
  | "processingState"
  | "documentType"
  | "legibility"
  | "escalated"
  | "importedFields"
  | "reviewFields"
  | "processingError"
  | "durationMs"
  | "mrzVerified"
  | "mrzFormat"
>>;

/**
 * Advances one document without touching the others.
 *
 * Zero-click reads run per file and finish out of order, so a document that has
 * already completed must not be reset by a later patch for a different file. A patch
 * for an id that is no longer in the queue is a no-op: removing a file while its read
 * is in flight is normal, not an error.
 */
export function patchDocument(
  current: readonly QueuedDocument[],
  id: string,
  patch: DocumentPatch,
): QueuedDocument[] {
  let changed = false;
  const next = current.map((entry) => {
    if (entry.id !== id) return entry;
    changed = true;
    return { ...entry, ...patch };
  });
  return changed ? next : (current as QueuedDocument[]);
}

export function documentTotals(documents: readonly QueuedDocument[]) {
  const bytes = documents.reduce((sum, entry) => sum + entry.size, 0);
  return {
    count: documents.length,
    bytes,
    label: formatDocumentSize(bytes),
    remaining: Math.max(0, SMART_DOCUMENT_POLICY.maxFiles - documents.length),
  };
}

/** The single status word shown on a file card, derived from the three real states. */
export function documentStatusLabel(entry: QueuedDocument) {
  if (entry.localState === "REJECTED") return "REJECTED";
  if (entry.uploadState === "FAILED") return "FAILED";
  // The read's own stage is the most informative thing to show while it is running,
  // and it is reported before the upload state because that is what is happening.
  switch (entry.processingState) {
    case "QUEUED": return "QUEUED";
    case "UPLOADING": return "UPLOADING";
    case "READING": return "READING DOCUMENT";
    case "EXTRACTING": return "EXTRACTING";
    case "VALIDATING": return "CHECKING FIELDS";
    case "PROCESSING": return "PROCESSING";
    case "REVIEW_REQUIRED": return "REVIEW REQUIRED";
    case "FAILED": return "READ FAILED";
    case "COMPLETE": return "READ COMPLETE";
    default: break;
  }
  if (entry.uploadState === "UPLOADING") return "UPLOADING";
  if (entry.uploadState === "READY_TO_UPLOAD") return entry.previewUrl ? "READY" : "VALIDATED";
  return "STORED";
}

/** Documents still moving through a read, for an honest "N of M" readout. */
export function documentsInFlight(documents: readonly QueuedDocument[]) {
  const active: DocumentProcessingState[] = ["QUEUED", "UPLOADING", "READING", "EXTRACTING", "VALIDATING", "PROCESSING"];
  return documents.filter((entry) => active.includes(entry.processingState)).length;
}
