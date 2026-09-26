"use client";

import { Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type WaveSurfer from "wavesurfer.js";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Variant = "original" | "playback";

type PlayerApi = {
  ready: boolean;
  playing: boolean;
  timeMs: number;
  durationMs: number;
  rate: number;
  variant: Variant;
  seek: (ms: number, play?: boolean) => void;
  toggle: () => void;
  skip: (deltaMs: number) => void;
  setRate: (r: number) => void;
  playWindow: (startMs: number, endMs: number, rate?: number) => void;
  highlight: (startMs: number | null, endMs?: number) => void;
};

const Ctx = createContext<PlayerApi | null>(null);
const AttachCtx = createContext<((el: HTMLDivElement | null) => void) | null>(null);

export function usePlayer() {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePlayer outside PlayerProvider");
  return c;
}

/**
 * Plays the exact original evidence bytes via a short-lived signed URL. Only if the
 * browser cannot decode the original container does it fall back to the derived
 * playback copy, and then says so on screen.
 */
export function PlayerProvider({ recordingId, durationHint, children }: { recordingId: string; durationHint?: number | null; children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<{ clearRegions: () => void; addRegion: (o: Record<string, unknown>) => unknown } | null>(null);
  const stopAtRef = useRef<number | null>(null);
  const urlAtRef = useRef(0);
  const triedRefreshRef = useRef(false);
  const [variant, setVariant] = useState<Variant>("original");
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(durationHint ?? 0);
  const [rate, setRateState] = useState(1);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);

  const loadUrl = useCallback(
    async (v: Variant, keepTime?: number) => {
      const a = audioRef.current;
      if (!a) return;
      const { url } = await api<{ url: string }>(`/api/recordings/${recordingId}/media-url?variant=${v}`);
      urlAtRef.current = Date.now();
      a.src = url;
      a.preload = "metadata";
      if (keepTime != null) {
        a.addEventListener("loadedmetadata", () => (a.currentTime = keepTime / 1000), { once: true });
      }
    },
    [recordingId],
  );

  useEffect(() => {
    const a = new Audio();
    audioRef.current = a;
    const onTime = () => {
      setTimeMs(a.currentTime * 1000);
      if (stopAtRef.current != null && a.currentTime * 1000 >= stopAtRef.current) {
        stopAtRef.current = null;
        a.pause();
      }
    };
    const onMeta = () => {
      if (Number.isFinite(a.duration) && a.duration > 0) setDurationMs(a.duration * 1000);
      setReady(true);
    };
    const onErr = () => {
      const t = a.currentTime * 1000;
      if (!triedRefreshRef.current && Date.now() - urlAtRef.current > 60_000) {
        triedRefreshRef.current = true; // signed URL likely expired — refresh once
        void loadUrl(variant, t);
        return;
      }
      if (variant === "original") {
        setVariant("playback");
      }
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("play", () => setPlaying(true));
    a.addEventListener("pause", () => setPlaying(false));
    a.addEventListener("ended", () => setPlaying(false));
    a.addEventListener("error", onErr);
    return () => {
      a.pause();
      a.removeAttribute("src");
      a.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- single audio element per recording
  }, [recordingId]);

  useEffect(() => {
    triedRefreshRef.current = false;
    void loadUrl(variant).catch(() => undefined);
  }, [variant, loadUrl]);

  useEffect(() => {
    api<{ peaks: number[] }>(`/api/recordings/${recordingId}/peaks`)
      .then((p) => setPeaks(p.peaks))
      .catch(() => setPeaks(null));
  }, [recordingId]);

  useEffect(() => {
    if (!container || !audioRef.current || !peaks) return;
    let destroyed = false;
    (async () => {
      const [{ default: WS }, { default: Regions }] = await Promise.all([
        import("wavesurfer.js"),
        import("wavesurfer.js/dist/plugins/regions.esm.js"),
      ]);
      if (destroyed) return;
      const regions = Regions.create();
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent-500").trim() || "#7a5af8";
      const ws = WS.create({
        container,
        media: audioRef.current!,
        peaks: [peaks],
        duration: (durationMs || (peaks.length / 50) * 1000) / 1000,
        height: 72,
        barWidth: 2,
        barGap: 1.5,
        barRadius: 2,
        normalize: true,
        waveColor: "rgba(122,90,248,0.28)",
        progressColor: accent,
        cursorColor: accent,
        cursorWidth: 2,
        interact: true,
        dragToSeek: true,
        plugins: [regions],
      });
      wsRef.current = ws;
      regionsRef.current = regions as unknown as typeof regionsRef.current;
    })();
    return () => {
      destroyed = true;
      wsRef.current?.destroy();
      wsRef.current = null;
      regionsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild only when container/peaks change
  }, [container, peaks]);

  const seek = useCallback((ms: number, play = false) => {
    const a = audioRef.current;
    if (!a) return;
    stopAtRef.current = null;
    a.currentTime = Math.max(0, ms / 1000);
    setTimeMs(Math.max(0, ms));
    if (play) void a.play().catch(() => undefined);
  }, []);

  const api_ = useMemo<PlayerApi>(
    () => ({
      ready,
      playing,
      timeMs,
      durationMs,
      rate,
      variant,
      seek,
      toggle: () => {
        const a = audioRef.current;
        if (!a) return;
        stopAtRef.current = null;
        if (a.paused) void a.play().catch(() => undefined);
        else a.pause();
      },
      skip: (d) => seek(Math.min(durationMs || Infinity, Math.max(0, (audioRef.current?.currentTime ?? 0) * 1000 + d))),
      setRate: (r) => {
        if (audioRef.current) {
          audioRef.current.playbackRate = r;
          audioRef.current.preservesPitch = true;
        }
        setRateState(r);
      },
      playWindow: (s, e, r) => {
        const a = audioRef.current;
        if (!a) return;
        if (r) {
          a.playbackRate = r;
          setRateState(r);
        }
        a.currentTime = Math.max(0, s / 1000);
        stopAtRef.current = e;
        void a.play().catch(() => undefined);
      },
      highlight: (s, e) => {
        const reg = regionsRef.current;
        if (!reg) return;
        reg.clearRegions();
        if (s != null && e != null) reg.addRegion({ start: s / 1000, end: e / 1000, color: "rgba(245, 158, 11, 0.22)", drag: false, resize: false });
      },
    }),
    [ready, playing, timeMs, durationMs, rate, variant, seek],
  );

  return (
    <Ctx.Provider value={api_}>
      <AttachCtx.Provider value={setContainer}>{children}</AttachCtx.Provider>
    </Ctx.Provider>
  );
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function PlayerBar({ className }: { className?: string }) {
  const p = usePlayer();
  const attach = useContext(AttachCtx);
  const { t } = useI18n();
  return (
    <div className={cn("glass-strong rounded-3xl p-4", className)}>
      <div ref={attach ?? undefined} className="min-h-[72px] w-full cursor-pointer" dir="ltr" data-testid="waveform" />
      <div className="mt-3 flex flex-wrap items-center gap-2" dir="ltr">
        <Button variant="ghost" size="sm" onClick={() => p.skip(-10000)} aria-label={t("minus10")}>
          <RotateCcw /> 10
        </Button>
        <Button size="icon" onClick={p.toggle} aria-label={p.playing ? "Pause" : "Play"} data-testid="play-toggle">
          {p.playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => p.skip(10000)} aria-label={t("plus10")}>
          10 <RotateCw />
        </Button>
        <span className="font-mono text-xs tabular-nums muted" data-testid="clock">
          {fmtTime(p.timeMs, true)} / {fmtTime(p.durationMs)}
        </span>
        <div className="ms-auto flex items-center gap-1">
          <span className="muted text-[11px]">{t("speed")}</span>
          <select
            className="rounded-xl border hairline bg-transparent px-2 py-1 text-xs"
            value={p.rate}
            onChange={(e) => p.setRate(Number(e.target.value))}
            aria-label={t("speed")}
          >
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-2 text-[11px] muted" dir="auto">
        {p.variant === "original" ? t("original_audio") : <span className="text-amber-600 dark:text-amber-300">{t("derived_copy")}</span>}
      </div>
    </div>
  );
}
