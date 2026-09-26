"use client";

import { Mic, Pause, Play, Square, Trash2, UploadCloud, Waves } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
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
      <div className="space-y-4 text-center">
        <p className="text-sm text-rose-300">{error}</p>
        <Button variant="secondary" onClick={onCancel}>{t("back")}</Button>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-center gap-7 py-2">
      <div className="pointer-events-none absolute inset-x-0 -bottom-10 h-52 bg-[radial-gradient(ellipse_at_center,rgba(244,63,94,.12),transparent_68%)]" />

      <div className="relative flex items-center gap-2 rounded-full border border-white/[0.08] bg-black/20 px-3 py-1.5 text-[11px] font-bold tracking-[0.14em] text-slate-300">
        <span className={`size-2 rounded-full ${state === "recording" ? "soft-pulse bg-rose-400 shadow-[0_0_18px_rgba(244,63,94,.9)]" : "bg-amber-300"}`} />
        {state === "paused" ? (rtl ? "متوقف مؤقتاً" : "PAUSED") : (rtl ? "تسجيل مباشر" : "RECORDING")}
      </div>

      <div className="relative text-center">
        <div className="font-mono text-[58px] font-medium leading-none tabular-nums tracking-[-0.05em] text-white sm:text-[72px]" dir="ltr" aria-live="polite">
          {fmtTime(elapsed)}
        </div>
        <div className="mt-2 flex items-center justify-center gap-2 text-[11px] text-slate-500">
          <Waves className="size-3.5 text-rose-300" />
          {rtl ? "صوت خام — دون تنقية أو تعديل" : "Raw capture — no enhancement applied"}
        </div>
      </div>

      <div className="relative flex h-28 w-full max-w-2xl items-center justify-center overflow-hidden rounded-[24px] border border-white/[0.07] bg-black/25 px-4" aria-hidden dir="ltr">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(244,63,94,.05),transparent)]" />
        <div className="flex h-20 w-full items-center justify-center gap-[2px]">
          {Array.from({ length: 60 }, (_, i) => {
            const phase = Math.sin((i + elapsed / 105) * 0.52) ** 2;
            const center = 1 - Math.min(1, Math.abs(i - 29.5) / 34);
            const h = Math.max(0.07, Math.min(1, level * 3.15 * (0.3 + phase * 0.5 + center * 0.2)));
            return (
              <span
                key={i}
                className="w-[3px] rounded-full bg-gradient-to-t from-rose-500 via-rose-400 to-pink-300 transition-[height,opacity] duration-75"
                style={{ height: `${h * 100}%`, opacity: state === "paused" ? 0.32 : 0.62 + h * 0.38 }}
              />
            );
          })}
        </div>
      </div>

      <div className="relative flex items-center gap-4">
        <Button variant="secondary" size="icon" className="size-12" onClick={discard} aria-label={t("discard")}>
          <Trash2 />
        </Button>
        <Button size="lg" className="record-gradient h-16 rounded-full border border-white/10 px-9 text-base shadow-[0_18px_52px_-18px_rgba(244,63,94,.8)]" onClick={stop} disabled={state === "starting"}>
          <Square className="fill-current" /> {rtl ? "إنهاء" : "Done"}
        </Button>
        <Button variant="secondary" size="icon" className="size-12" onClick={pause} aria-label={state === "paused" ? t("resume") : t("pause")}>
          {state === "paused" ? <Play /> : <Pause />}
        </Button>
      </div>

      <div className="relative w-full max-w-md rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
        <div className="mb-2 flex items-center justify-between text-[10px] font-medium text-slate-500">
          <span>{rtl ? "مستوى الإدخال" : "INPUT LEVEL"}</span>
          <span className="font-mono" dir="ltr">{Math.round(level * 100)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="record-gradient h-full rounded-full transition-[width] duration-75" style={{ width: `${Math.min(100, level * 130)}%` }} />
        </div>
      </div>
    </div>
  );
}

export const RecorderIcons = { Mic, UploadCloud };
