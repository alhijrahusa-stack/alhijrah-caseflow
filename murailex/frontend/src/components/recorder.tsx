"use client";

import { Mic, Pause, Play, Square, Trash2, UploadCloud, Waves } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { fmtTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { recordingsStore, type StoredRecording } from "@/lib/idb";

const MIME_PREFERENCE = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return MIME_PREFERENCE.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "";
}

export function extFor(mime: string): string {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

type Props = { onFinished: (rec: StoredRecording) => void; onCancel: () => void };

export function Recorder({ onFinished, onCancel }: Props) {
  const { t, dir } = useI18n();
  const rtl = dir === "rtl";
  const [state, setState] = useState<"starting" | "recording" | "paused" | "error">("starting");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<StoredRecording | null>(null);
  const tickRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const accRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const cleanup = useCallback(() => {
    if (tickRef.current) window.clearInterval(tickRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setState("error");
        setError(t("mic_unsupported"));
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        const mime = pickMime();
        const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        const rec: StoredRecording = { id: crypto.randomUUID(), mime: mr.mimeType || mime || "audio/webm", chunks: [], startedAt: Date.now(), finished: false };
        recRef.current = rec;
        await recordingsStore.put(rec);
        mr.ondataavailable = async (e) => {
          if (e.data && e.data.size > 0 && recRef.current) {
            recRef.current.chunks.push(e.data);
            await recordingsStore.put(recRef.current);
          }
        };
        mr.start(1000);
        mediaRef.current = mr;
        startRef.current = performance.now();
        setState("recording");
        tickRef.current = window.setInterval(() => {
          if (mediaRef.current?.state === "recording") setElapsed(accRef.current + performance.now() - startRef.current);
        }, 250);

        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.72;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const loop = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
          setLevel(peak);
          rafRef.current = requestAnimationFrame(loop);
        };
        loop();
      } catch {
        setState("error");
        setError(t("mic_denied"));
      }
    })();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [cleanup, t]);

  function pause() {
    const mr = mediaRef.current;
    if (!mr) return;
    if (mr.state === "recording") {
      mr.pause();
      accRef.current += performance.now() - startRef.current;
      setState("paused");
    } else if (mr.state === "paused") {
      mr.resume();
      startRef.current = performance.now();
      setState("recording");
    }
  }

  async function stop() {
    const mr = mediaRef.current;
    if (!mr || !recRef.current) return;
    await new Promise<void>((resolve) => {
      mr.addEventListener("stop", () => resolve(), { once: true });
      mr.stop();
    });
    await new Promise((r) => setTimeout(r, 50));
    cleanup();
    recRef.current.finished = true;
    await recordingsStore.put(recRef.current);
    onFinished(recRef.current);
  }

  async function discard() {
    if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop();
    cleanup();
    if (recRef.current) await recordingsStore.remove(recRef.current.id);
    onCancel();
  }

  if (state === "error") {
    return (
      <div className="space-y-4">
        <Notice tone="danger" role="alert">{error}</Notice>
        <div className="flex justify-center">
          <Button variant="secondary" onClick={onCancel}>{t("back")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 py-2">
      <div className="flex items-center gap-2 rounded-md border border-line-strong bg-surface-2 px-2.5 py-1 text-xs font-semibold text-fg-muted" role="status">
        <span className={`size-2 rounded-full ${state === "recording" ? "animate-pulse bg-danger" : "bg-warn"}`} aria-hidden />
        {state === "paused" ? (rtl ? "متوقف مؤقتاً" : "PAUSED") : (rtl ? "تسجيل مباشر" : "RECORDING")}
      </div>

      <div className="text-center">
        <div className="font-mono text-[52px] font-medium leading-none tabular-nums tracking-tight text-fg sm:text-[64px]" dir="ltr" aria-live="polite">
          {fmtTime(elapsed)}
        </div>
        <div className="mt-2 flex items-center justify-center gap-2 text-xs text-fg-subtle">
          <Waves className="size-3.5" />
          {rtl ? "صوت خام — دون تنقية أو تعديل" : "Raw capture — no enhancement applied"}
        </div>
      </div>

      <div className="flex h-24 w-full max-w-2xl items-center justify-center rounded-lg border border-line bg-surface-2/60 px-4" aria-hidden dir="ltr">
        <div className="flex h-16 w-full items-center justify-center gap-[3px]">
          {Array.from({ length: 60 }, (_, i) => {
            const phase = Math.sin((i + elapsed / 105) * 0.52) ** 2;
            const center = 1 - Math.min(1, Math.abs(i - 29.5) / 34);
            const h = Math.max(0.07, Math.min(1, level * 3.15 * (0.3 + phase * 0.5 + center * 0.2)));
            return (
              <span
                key={i}
                className="w-[3px] rounded-full bg-danger transition-[height,opacity] duration-75"
                style={{ height: `${h * 100}%`, opacity: state === "paused" ? 0.3 : 0.55 + h * 0.45 }}
              />
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="secondary" size="icon" className="size-12" onClick={discard} aria-label={t("discard")}>
          <Trash2 />
        </Button>
        <Button size="lg" variant="destructive" className="h-14 px-8" onClick={stop} disabled={state === "starting"}>
          <Square className="fill-current" /> {rtl ? "إنهاء" : "Done"}
        </Button>
        <Button variant="secondary" size="icon" className="size-12" onClick={pause} aria-label={state === "paused" ? t("resume") : t("pause")}>
          {state === "paused" ? <Play /> : <Pause />}
        </Button>
      </div>

      <div className="w-full max-w-md">
        <div className="mb-1.5 flex items-center justify-between text-[11.5px] font-medium text-fg-subtle">
          <span>{rtl ? "مستوى الإدخال" : "Input level"}</span>
          <span className="font-mono" dir="ltr">{Math.round(level * 100)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" dir="ltr">
          <div className="h-full rounded-full bg-danger transition-[width] duration-75" style={{ width: `${Math.min(100, level * 130)}%` }} />
        </div>
      </div>
    </div>
  );
}

export const RecorderIcons = { Mic, UploadCloud };
