"use client";

import { useEffect, useState } from "react";
import { GlassReviewDialog } from "@/components/staff/smart/GlassReviewDialog";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import "./secure-document.css";

/** Signed URLs live only in this mounted preview; private originals are never cached locally. */
export function SecureDocumentDrawer({ documentId, name, mimeType, onClose }: {
  documentId: string; name: string; mimeType?: string; onClose: () => void;
}) {
  const { t } = useStaffLanguage();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(100);
  const [attempt, setAttempt] = useState(0);
  const image = mimeType?.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif)$/i.test(name);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/documents/${encodeURIComponent(documentId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.ok || typeof body.url !== "string") throw new Error(body?.error?.message ?? "Secure document preview is unavailable");
        if (!controller.signal.aborted) { setError(""); setUrl(body.url); }
      }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Document could not be opened"); });
    return () => { controller.abort(); };
  }, [documentId, attempt]);
  return <GlassReviewDialog title={t("Document preview", "معاينة الوثيقة")} wide drawer onClose={onClose}>
    <div className="cg-secure-document">
      <div className="cg-document-toolbar">
        <div><strong dir="ltr">{name}</strong><p>{t("Private original · access recorded · temporary link", "الوثيقة الأصلية الخاصة · تم تسجيل الوصول · رابط مؤقت")}</p></div>
        <div className="cg-document-zoom" role="group" aria-label={t("Document zoom", "تكبير الوثيقة")} dir="ltr">
          <button type="button" aria-label={t("Zoom out", "تصغير")} disabled={zoom <= 50} onClick={() => setZoom(value => Math.max(50, value - 25))}>−</button>
          <output aria-live="polite">{zoom}%</output>
          <button type="button" aria-label={t("Zoom in", "تكبير")} disabled={zoom >= 250} onClick={() => setZoom(value => Math.min(250, value + 25))}>+</button>
          <button type="button" onClick={() => setZoom(100)}>{t("Reset", "إعادة ضبط")}</button>
        </div>
      </div>
      {error ? <div role="alert" className="cg-document-error"><p>{error}</p><button type="button" onClick={() => { setUrl(null); setError(""); setAttempt(value => value + 1); }}>{t("Retry preview", "إعادة المحاولة")}</button></div>
        : !url ? <p role="status">{t("Opening secured document…", "جارٍ فتح الوثيقة بأمان…")}</p>
          : <div className="cg-document-canvas" tabIndex={0} aria-label={t("Document contents", "محتوى الوثيقة")}>
            {image ? <div className="cg-document-image" style={{ width: `${zoom}%` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={name} referrerPolicy="no-referrer" draggable={false} />
            </div> : <iframe key={`${documentId}:${attempt}:${zoom}`} src={`${url.split("#")[0]}#zoom=${zoom}`} title={name}
              referrerPolicy="no-referrer" className="cg-document-frame" />}
          </div>}
    </div>
  </GlassReviewDialog>;
}
