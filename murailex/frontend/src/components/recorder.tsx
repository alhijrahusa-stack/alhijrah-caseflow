"use client";

import { Mic, Pause, Play, Square, Trash2, UploadCloud } from "lucide-react";
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

/**
 * Captures microphone audio without processing (echo cancellation, noise suppression and
 * auto-gain are disabled so the evidence is the unaltered capture). Chunks are persisted
 * to IndexedDB every second so a crash or interrupted tab session retains the completed
 * chunks already written.
 */
export function Recorder({ onFinished, onCancel }: Props) {
  const { t } = useI18n();
  const [state, setState] = useState<"starting" | "recording" | "paused" | "stopping" | "error">("starting");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recRef = useRef<StoredRecording | null>(null);
  const tickRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const accRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const persistChainRef = useRef<Promise<void>>(Promise.resolve());

  const cleanup = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    if (ctx && ctx.state !== "closed") {
      void ctx.close().catch(() => undefined);
    }
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
        const rec: StoredRecording = {
          id: crypto.randomUUID(),
          mime: mr.mimeType || mime || "audio/webm",
          chunks: [],
          startedAt: Date.now(),
          finished: false,
        };
        recRef.current = rec;
        await recordingsStore.put(rec);
        mr.ondataavailable = (e) => {
          if (!e.data || e.data.size <= 0 || !recRef.current) return;
          recRef.current.chunks.push(e.data);
          const current = recRef.current;
          persistChainRef.current = persistChainRef.current
            .then(() => recordingsStore.put(current).then(() => undefined))
            .catch(() => undefined);
        };
        mr.onerror = () => {
          setState("error");
          setError(t("mic_error"));
        };
        mr.start(1000);
        mediaRef.current = mr;
        startRef.current = performance.now();
        setState("recording");
        tickRef.current = window.setInterval(() => {
          if (mediaRef.current?.state === "recording") {
            setElapsed(accRef.current + performance.now() - startRef.current);
          }
        }, 250);

        try {
          const ctx = new AudioContext();
          audioContextRef.current = ctx;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
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
          // The recorder remains usable if the browser does not expose an audio analyser.
        }
      } catch {
        setState("error");
        setError(t("mic_denied"));
      }
    })();
    return () => {
      cancelled = true;
      const mr = mediaRef.current;
      if (mr && mr.state !== "inactive") {
        try {
          mr.stop();
        } catch {
          // Ignore teardown races; already-persisted chunks remain recoverable.
        }
      }
      cleanup();
    };
  }, [cleanup, t]);

  function pause() {
    const mr = mediaRef.current;
    if (!mr || state === "stopping") return;
    if (mr.state === "recording") {
      mr.pause();
      accRef.current += performance.now() - startRef.current;
      setElapsed(accRef.current);
      setState("paused");
    } else if (mr.state === "paused") {
      mr.resume();
      startRef.current = performance.now();
      setState("recording");
    }
  }

  async function stop() {
    const mr = mediaRef.current;
    const rec = recRef.current;
    if (!mr || !rec || state === "stopping" || state === "error") return;
    setState("stopping");
    if (mr.state === "recording") {
      accRef.current += performance.now() - startRef.current;
      setElapsed(accRef.current);
    }
    await new Promise<void>((resolve, reject) => {
      const onStop = () => resolve();
      const onError = () => reject(new Error("MediaRecorder stopped with an error."));
      mr.addEventListener("stop", onStop, { once: true });
      mr.addEventListener("error", onError, { once: true });
      try {
        mr.stop();
      } catch (e) {
        mr.removeEventListener("stop", onStop);
        mr.removeEventListener("error", onError);
        reject(e);
      }
    });
    await persistChainRef.current;
    cleanup();
    rec.finished = true;
    await recordingsStore.put(rec);
    onFinished(rec);
  }

  async function discard() {
    if (state === "stopping") return;
    const mr = mediaRef.current;
    if (mr && mr.state !== "inactive") {
      try {
        mr.stop();
      } catch {
        // Ignore teardown races during discard.
      }
    }
    cleanup();
    if (recRef.current) await recordingsStore.remove(recRef.current.id);
    onCancel();
  }

  if (state === "error") {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-rose-600">{error}</p>
        <Button variant="secondary" onClick={onCancel}>
          {t("back")}
        </Button>
      </div>
    );
  }

  const recordingActive = state === "recording";
  const controlsDisabled = state === "starting" || state === "stopping";

  return (
    <div className="flex flex-col items-center gap-6 py-2">
      <div className="flex items-center gap-2 text-sm">
        <span className={`size-2.5 rounded-full ${recordingActive ? "animate-pulse bg-rose-500" : "bg-amber-400"}`} />
        <span className="muted">{state === "paused" ? t("pause") : t("recording_now")}</span>
      </div>
      <div className="font-mono text-5xl tabular-nums tracking-tight" dir="ltr" aria-live="polite">
        {fmtTime(elapsed)}
      </div>
      <div className="flex h-10 items-end gap-[3px]" aria-hidden dir="ltr">
        {Array.from({ length: 28 }, (_, i) => {
          const h = Math.max(0.08, Math.min(1, level * 2.4 * (0.55 + 0.45 * Math.sin((i + elapsed / 120) * 0.9) ** 2)));
          return <span key={i} className="w-1.5 rounded-full bg-accent-500/70 transition-[height] duration-100" style={{ height: `${h * 100}%` }} />;
        })}
      </div>
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="icon" onClick={discard} aria-label={t("discard")} disabled={controlsDisabled}>
          <Trash2 />
        </Button>
        <Button size="lg" className="rounded-full bg-rose-600 px-8 hover:bg-rose-700" onClick={stop} disabled={controlsDisabled}>
          <Square className="fill-current" /> {state === "stopping" ? t("uploading") : t("stop")}
        </Button>
        <Button variant="secondary" size="icon" onClick={pause} aria-label={state === "paused" ? t("resume") : t("pause")} disabled={controlsDisabled}>
          {state === "paused" ? <Play /> : <Pause />}
        </Button>
      </div>
    </div>
  );
}

export const RecorderIcons = { Mic, UploadCloud };
