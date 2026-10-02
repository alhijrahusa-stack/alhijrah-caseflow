"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export function DocumentARPreview({ file, onClose }: { file: File; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "live" | "unavailable">("starting");
  const url = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    const media = navigator.mediaDevices;
    const video = videoRef.current;
    if (!media?.getUserMedia) {
      queueMicrotask(() => !cancelled && setStatus("unavailable"));
      return () => { cancelled = true; };
    }
    void media.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    }).then((next) => {
      if (cancelled) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = next;
      if (video) {
        video.srcObject = next;
        void video.play().catch(() => undefined);
      }
      setStatus("live");
    }).catch(() => {
      if (!cancelled) setStatus("unavailable");
    });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, []);

  return (
    <div className="cg-ar-backdrop" role="dialog" aria-modal="true" aria-label="Camera AR document preview">
      <video ref={videoRef} className="cg-ar-camera" playsInline muted aria-hidden="true" />
      <div className="cg-ar-shade" aria-hidden="true" />
      <div className="cg-ar-hud">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-100">LOCAL CAMERA AR PREVIEW</p>
          <p className="mt-1 text-xs text-slate-300">Camera frames stay on this device and are not uploaded.</p>
        </div>
        <button type="button" className="rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white backdrop-blur" onClick={onClose}>Close</button>
      </div>
      <div className="cg-ar-plane-wrap" aria-label={file.name}>
        <div className="cg-ar-document" style={{ backgroundImage: `url(${url})` }} />
      </div>
      {status !== "live" && (
        <div className="cg-ar-status">
          {status === "starting" ? "Starting camera…" : "Camera unavailable or permission denied. Use Spatial preview instead."}
        </div>
      )}
    </div>
  );
}
