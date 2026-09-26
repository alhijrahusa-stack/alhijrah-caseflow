"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { dateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { DocumentRow } from "@/lib/types";
import { useApi } from "./useApi";

const BUCKET = "client-documents";
const KINDS = ["id", "work_authorization", "ssn_card", "resume", "other"] as const;
const MAX_BYTES = 15 * 1024 * 1024;

export function DocumentsPanel({ clientId, documents }: { clientId: string; documents: DocumentRow[] }) {
  const router = useRouter();
  const { call, pending, error, setError } = useApi();
  const [uploading, setUploading] = useState(false);
  const [openText, setOpenText] = useState<string | null>(null);

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const f = new FormData(formEl);
    const file = f.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a file");
    if (file.size > MAX_BYTES) return setError("File is larger than 15 MB");

    setUploading(true);
    setError(null);
    const supabase = createClient();
    const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-120);
    const path = `${clientId}/${crypto.randomUUID()}-${safeName}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || "application/octet-stream",
    });
    if (upErr) {
      setUploading(false);
      return setError(upErr.message);
    }
    const { data: user } = await supabase.auth.getUser();
    const { error: rowErr } = await supabase.from("documents").insert({
      client_id: clientId, kind: f.get("kind"), storage_path: path, file_name: file.name,
      mime_type: file.type || "application/octet-stream", size_bytes: file.size,
      uploaded_by: user.user?.id ?? null,
    });
    if (rowErr) {
      await supabase.storage.from(BUCKET).remove([path]);
      setUploading(false);
      return setError(rowErr.message);
    }
    await supabase.from("activity").insert({
      client_id: clientId, actor: user.user?.id ?? null, type: "document_uploaded",
      summary: `Uploaded ${String(f.get("kind")).replace("_", " ")}: ${file.name}`,
    });
    setUploading(false);
    formEl.reset();
    router.refresh();
  }

  async function download(id: string) {
    const res = await call<{ url: string }>(`/api/documents/${id}`, "GET");
    if (res?.url) window.open(res.url, "_blank", "noopener");
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card title="Documents" className="md:col-span-2">
        {documents.length ? (
          <ul className="divide-y divide-slate-100 text-sm">
            {documents.map((d) => (
              <li key={d.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{d.file_name}</p>
                    <p className="text-slate-500">
                      {d.kind.replace("_", " ")} · {(d.size_bytes / 1024).toFixed(0)} KB · {dateTime(d.created_at)}
                      {d.verified && <span className="ml-2 text-green-700">✓ verified</span>}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button variant="secondary" className="px-2 py-1 text-xs" disabled={pending} onClick={() => download(d.id)}>Open</Button>
                    <Button variant="secondary" className="px-2 py-1 text-xs" disabled={pending}
                      onClick={() => call(`/api/documents/${d.id}`, "PATCH", { verified: !d.verified })}>
                      {d.verified ? "Unverify" : "Verify"}
                    </Button>
                    {d.mime_type.startsWith("image/") && (
                      <Button variant="secondary" className="px-2 py-1 text-xs" disabled={pending || d.ocr_status === "pending"}
                        onClick={() => call("/api/ocr", "POST", { documentId: d.id })}>
                        {d.ocr_status === "done" ? "Re-run OCR" : "OCR"}
                      </Button>
                    )}
                    {d.ocr_text && (
                      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setOpenText(openText === d.id ? null : d.id)}>
                        Text
                      </Button>
                    )}
                    <Button variant="ghost" className="px-2 py-1 text-xs text-red-600" disabled={pending}
                      onClick={() => confirm(`Delete ${d.file_name}?`) && call(`/api/documents/${d.id}`, "DELETE")}>
                      Delete
                    </Button>
                  </div>
                </div>
                {openText === d.id && (
                  <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">{d.ocr_text}</pre>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No documents uploaded.</p>
        )}
      </Card>

      <Card title="Upload">
        <form onSubmit={upload} className="space-y-3">
          <div>
            <label className="label" htmlFor="doc-kind">Type</label>
            <select id="doc-kind" name="kind" className="input">
              {KINDS.map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
            </select>
          </div>
          <input name="file" type="file" accept="image/*,application/pdf" className="block w-full text-sm" required />
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={uploading}>{uploading ? "Uploading…" : "Upload"}</Button>
        </form>
      </Card>
    </div>
  );
}
