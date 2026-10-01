"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DOC_LABELS, DOC_MAX_BYTES, DOC_MIME, DOC_TYPES } from "@/lib/domain";

export type PendingDocument = {
  id: string;
  doc_type: (typeof DOC_TYPES)[number];
  file: File;
  compressed?: boolean;
  original_bytes?: number;
};

type Props = {
  docType: (typeof DOC_TYPES)[number];
  onDocTypeChange: (value: (typeof DOC_TYPES)[number]) => void;
  docs: PendingDocument[];
  onChange: (docs: PendingDocument[]) => void;
  disabled?: boolean;
  onError: (message: string | null) => void;
};

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ACCEPT = DOC_MIME.join(",");

function humanBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function useImageObjectUrl(file: File) {
  const url = useMemo(() => IMAGE_TYPES.has(file.type) ? URL.createObjectURL(file) : null, [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url;
}

async function compressImage(file: File): Promise<{ file: File; compressed: boolean; original: number }> {
  if (!IMAGE_TYPES.has(file.type) || file.size < 900 * 1024 || typeof createImageBitmap !== "function") {
    return { file, compressed: false, original: file.size };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const maxEdge = 2200;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      bitmap.close();
      return { file, compressed: false, original: file.size };
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    if (!blob || blob.size >= file.size) return { file, compressed: false, original: file.size };
    const stem = file.name.replace(/\.[^.]+$/, "") || "document";
    return {
      file: new File([blob], `${stem}.webp`, { type: "image/webp", lastModified: file.lastModified }),
      compressed: true,
      original: file.size,
    };
  } catch {
    return { file, compressed: false, original: file.size };
  }
}

function PreviewThumb({ file }: { file: File }) {
  const url = useImageObjectUrl(file);
  if (!url) return <div className="cg-doc-thumb grid place-items-center text-[10px] font-semibold text-slate-400">PDF</div>;
  return <img className="cg-doc-thumb" src={url} alt="Document preview" />;
}

function SpatialPreview({ file, onClose }: { file: File; onClose: () => void }) {
  const url = useImageObjectUrl(file);
  return (
    <div className="cg-spatial-backdrop" role="dialog" aria-modal="true" aria-label="Spatial document preview" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cg-spatial-stage relative p-8">
        <button type="button" className="absolute right-4 top-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200" onClick={onClose}>Close</button>
        {url ? <img className="cg-spatial-sheet" src={url} alt={file.name} /> : <div className="max-w-md rounded-2xl border border-white/10 bg-white/5 p-10 text-center"><p className="text-lg font-semibold">{file.name}</p><p className="mt-2 text-sm text-slate-400">PDF preview is protected; the original file remains unchanged.</p></div>}
      </div>
    </div>
  );
}

export function SmartDocumentDropzone({ docType, onDocTypeChange, docs, onChange, disabled = false, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [preview, setPreview] = useState<File | null>(null);

  async function addFiles(list: FileList | File[]) {
    if (disabled || processing) return;
    setProcessing(true);
    onError(null);
    const next = [...docs];
    try {
      for (const incoming of Array.from(list)) {
        if (!(DOC_MIME as readonly string[]).includes(incoming.type)) {
          onError(`${incoming.name}: unsupported file type`);
          continue;
        }
        const optimized = await compressImage(incoming);
        if (optimized.file.size > DOC_MAX_BYTES) {
          onError(`${incoming.name}: file is larger than 4 MB after safe compression`);
          continue;
        }
        next.push({
          id: crypto.randomUUID(),
          doc_type: docType,
          file: optimized.file,
          compressed: optimized.compressed,
          original_bytes: optimized.original,
        });
      }
      onChange(next);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="cg-document-pond space-y-4" data-dragging={dragging ? "true" : "false"}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label className="label" htmlFor="smart_doc_type">Document type</label>
          <select id="smart_doc_type" className="input w-64 max-w-full" value={docType} disabled={disabled || processing} onChange={(e) => onDocTypeChange(e.target.value as typeof docType)}>
            {DOC_TYPES.map((type) => <option key={type} value={type}>{DOC_LABELS[type]}</option>)}
          </select>
        </div>
        <span className="cg-mini-chip">JPEG · PNG · WebP · PDF · max 4 MB</span>
      </div>

      <div
        className="cg-drop-target"
        role="button"
        tabIndex={0}
        aria-disabled={disabled || processing}
        onClick={() => !disabled && !processing && inputRef.current?.click()}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !disabled && !processing) inputRef.current?.click(); }}
        onDragEnter={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
        }}
      >
        <input ref={inputRef} className="sr-only" type="file" multiple accept={ACCEPT} disabled={disabled || processing}
          onChange={(e) => { const files = e.target.files; e.target.value = ""; if (files?.length) void addFiles(files); }} />
        <div>
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/[.06] text-xl text-cyan-200">⇧</div>
          <p className="font-semibold text-slate-100">{processing ? "Optimizing documents…" : dragging ? "Drop documents here" : "Drop documents or click to browse"}</p>
          <p className="mt-1 text-xs text-slate-500">Large images are compressed locally before upload. PDFs are never recompressed.</p>
        </div>
      </div>

      {docs.length > 0 && (
        <div className="space-y-2" aria-live="polite">
          {docs.map((doc) => (
            <div key={doc.id} className="cg-doc-row">
              <div className="flex min-w-0 items-center gap-3">
                <PreviewThumb file={doc.file} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-200">{doc.file.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{DOC_LABELS[doc.doc_type]} · {humanBytes(doc.file.size)}</p>
                  <p className="cg-doc-status" data-compressed={doc.compressed ? "true" : "false"}>
                    {doc.compressed && doc.original_bytes ? `Ready · compressed from ${humanBytes(doc.original_bytes)}` : "Ready for secure upload"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5" onClick={() => setPreview(doc.file)}>Spatial preview</button>
                <button type="button" className="rounded-lg border border-red-400/20 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-400/5" onClick={() => onChange(docs.filter((item) => item.id !== doc.id))}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {preview && <SpatialPreview file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
