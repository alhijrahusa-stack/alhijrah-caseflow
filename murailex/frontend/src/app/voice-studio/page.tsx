"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  ArrowDownToLine,
  AudioLines,
  Check,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  FileAudio2,
  Headphones,
  LoaderCircle,
  Mic2,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { TranscriptAnalysisPanel } from "@/components/transcript-analysis-panel";
import { csrf } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const MAX_AUDIO_BYTES = 25_000_000;
const MAX_TEXT = 1000;
const BARS = [17, 32, 25, 48, 36, 62, 46, 78, 56, 39, 65, 50, 30, 58, 43, 70, 52, 29, 47, 23, 37, 19];

type Processing = "tts" | "stt" | null;
type TranscriptResponse = {
  text: string;
  model?: string;
  source_sha256?: string;
};

function formatBytes(bytes: number): string {
  return bytes < 1_000_000 ? (bytes / 1_000).toFixed(0) + " KB" : (bytes / 1_000_000).toFixed(2) + " MB";
}

function formatTime(ms: number): string {
  return ms < 1000 ? Math.round(ms) + " ms" : (ms / 1000).toFixed(2) + " s";
}

async function responseError(res: Response): Promise<string> {
  const result: unknown = await res.json().catch(() => null);
  if (result && typeof result === "object" && "error" in result) {
    const text = (result as { error: unknown }).error;
    if (typeof text === "string") return text;
  }
  return "Request failed (HTTP " + res.status + ").";
}

function GlassPanel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "relative overflow-hidden rounded-[28px] border border-white/[0.11] bg-white/[0.045] " +
        "shadow-[0_25px_90px_-36px_rgba(0,0,0,0.85)] backdrop-blur-2xl " + className
      }
    >
      <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" aria-hidden="true" />
      {children}
    </div>
  );
}

export default function VoiceStudioPage() {
  const { dir } = useI18n();
  const rtl = dir === "rtl";
  const reduceMotion = useReducedMotion();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<Processing>(null);
  const [errorTTS, setErrorTTS] = useState("");
  const [errorSTT, setErrorSTT] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [sourceHash, setSourceHash] = useState("");
  const [whisperContext, setWhisperContext] = useState("");
  const [ttsElapsed, setTtsElapsed] = useState<number | null>(null);
  const [sttElapsed, setSttElapsed] = useState<number | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  function setAudioFile(selected: File | null) {
    setErrorSTT("");
    setTranscript("");
    setSourceHash("");
    setSttElapsed(null);
    if (selected && selected.size > MAX_AUDIO_BYTES) {
      setFile(null);
      setErrorSTT(rtl ? "الحد الأقصى للملف الصوتي 25 ميغابايت." : "Audio file limit is 25 MB.");
      return;
    }
    setFile(selected);
  }

  async function synthesize() {
    if (!text.trim() || busy) return;
    setBusy("tts");
    setErrorTTS("");
    setTtsElapsed(null);
    setAudioUrl("");
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    const started = performance.now();
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json", "x-csrf-token": csrf() },
        body: JSON.stringify({ text: text.trim() }),
      });
      if (!res.ok) throw new Error(await responseError(res));
      if (!(res.headers.get("content-type") ?? "").includes("audio/mpeg")) {
        throw new Error("Unexpected response format.");
      }
      const audio = await res.blob();
      if (audio.size < 64) throw new Error("Empty MP3 response.");
      const url = URL.createObjectURL(audio);
      audioUrlRef.current = url;
      setAudioUrl(url);
      setTtsElapsed(performance.now() - started);
    } catch (error) {
      setErrorTTS(error instanceof Error ? error.message : "Audio generation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function transcribe() {
    if (!file || busy) return;
    setBusy("stt");
    setErrorSTT("");
    setTranscript("");
    setSourceHash("");
    setSttElapsed(null);
    const started = performance.now();
    try {
      const form = new FormData();
      form.set("file", file);
      if (whisperContext.trim()) form.set("prompt", whisperContext.trim());
      const res = await fetch("/api/stt", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "x-csrf-token": csrf() },
        body: form,
      });
      if (!res.ok) throw new Error(await responseError(res));
      const result: unknown = await res.json();
      if (!result || typeof result !== "object" || !("text" in result) ||
          typeof result.text !== "string" || !result.text.trim()) {
        throw new Error("Transcription response is empty or invalid.");
      }
      const response = result as TranscriptResponse;
      setTranscript(response.text);
      setSourceHash(typeof response.source_sha256 === "string" ? response.source_sha256 : "");
      setSttElapsed(performance.now() - started);
    } catch (error) {
      setErrorSTT(error instanceof Error ? error.message : "Audio transcription failed.");
    } finally {
      setBusy(null);
    }
  }

  const animateUp = reduceMotion ? {} : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };
  const NextArrow = rtl ? ChevronLeft : ChevronRight;

  return (
    <div className="relative isolate mx-auto max-w-6xl space-y-7 overflow-hidden pb-8 text-white">
      <div aria-hidden="true" className="pointer-events-none absolute -top-28 right-[-20%] -z-10 h-[32rem] w-[38rem] rounded-full bg-[radial-gradient(ellipse,rgba(89,91,242,0.22)_0%,transparent_68%)] blur-2xl" />
      <div aria-hidden="true" className="pointer-events-none absolute left-[-25%] top-[20rem] -z-10 h-[32rem] w-[34rem] rounded-full bg-[radial-gradient(ellipse,rgba(24,187,214,0.13)_0%,transparent_68%)] blur-2xl" />

      <motion.header {...animateUp} transition={{ duration: 0.42 }} className="relative space-y-5 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-indigo-300/20 bg-indigo-300/[0.08] px-3.5 py-1.5 text-[11px] font-bold tracking-[0.15em] text-indigo-200" dir="ltr">
            <Sparkles className="size-3.5" aria-hidden="true" /> MURAILEX / VOICE INTELLIGENCE
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200/15 bg-emerald-300/[0.05] px-3 py-1.5 text-xs font-medium text-emerald-100/80">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            {rtl ? "مساحة عمل مستقلة" : "Private workspace"}
          </span>
        </div>
        <div className="max-w-3xl space-y-3">
          <h1 className="text-[clamp(2rem,5vw,3.6rem)] font-bold leading-[1.17] tracking-tight">
            {rtl ? "صوتك. نصك." : "Your voice. Your words."}
            <span className="block bg-gradient-to-r from-[#B5BCFF] via-[#82D7F2] to-[#D1B9FF] bg-clip-text text-transparent">
              {rtl ? "بذكاء أكثر." : "Elevated by intelligence."}
            </span>
          </h1>
          <p className="max-w-2xl text-sm leading-7 text-white/60 sm:text-base">
            {rtl
              ? "حوّل النص العربي إلى صوت طبيعي، أو استخرج نصًا من تسجيلك عبر واجهة واحدة. النتائج قابلة للتشغيل والنسخ والتنزيل."
              : "Create natural Arabic speech from text or transcribe your recording in one focused studio. Listen, copy and download directly."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5 text-xs text-white/65">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3.5 py-2 backdrop-blur-xl" dir="ltr">
            <AudioLines className="size-3.5 text-sky-300" aria-hidden="true" /> Neural TTS · MP3
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3.5 py-2 backdrop-blur-xl" dir="ltr">
            <Mic2 className="size-3.5 text-indigo-300" aria-hidden="true" /> Whisper Large V3
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3.5 py-2 backdrop-blur-xl">
            <ShieldCheck className="size-3.5 text-emerald-300" aria-hidden="true" />
            {rtl ? "ملفات الأدلة الأصلية دون تغيير" : "Original evidence remains unchanged"}
          </span>
        </div>
      </motion.header>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <motion.section {...animateUp} transition={{ duration: 0.45, delay: 0.06 }} aria-label={rtl ? "تحويل النص إلى صوت" : "Text to speech"}>
          <GlassPanel>
            <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-28 size-72 rounded-full bg-indigo-400/[0.12] blur-3xl" />
            <div className="relative space-y-6 p-5 sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-3">
                  <span className="flex size-12 items-center justify-center rounded-2xl border border-indigo-200/20 bg-indigo-300/10 shadow-[0_0_40px_-12px_rgba(129,140,248,.5)]">
                    <Headphones className="size-6 text-indigo-200" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-widest text-indigo-200/85" dir="ltr">01 / TEXT TO SPEECH</div>
                    <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{rtl ? "امنح كلماتك صوتًا" : "Bring words to life"}</h2>
                    <p className="mt-1 text-sm leading-6 text-white/55">
                      {rtl ? "صوت شاكر العربي العصبي — ملف MP3" : "Arabic Neural Voice — Shakir · MP3"}
                    </p>
                  </div>
                </div>
                <span className="rounded-lg border border-white/10 bg-white/[0.035] p-2.5 text-indigo-200" aria-hidden="true">
                  <WandSparkles className="size-4" />
                </span>
              </div>

              <div className="rounded-2xl border border-white/[0.095] bg-black/[0.22] p-4 shadow-inner sm:p-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <label htmlFor="voice-text" className="text-xs font-semibold text-white/80">
                    {rtl ? "النص المطلوب تحويله" : "Your script"}
                  </label>
                  <span className="text-xs tabular-nums text-white/40" dir="ltr">{text.length} / {MAX_TEXT}</span>
                </div>
                <textarea
                  id="voice-text"
                  className="min-h-40 w-full resize-y bg-transparent text-sm leading-8 text-white outline-none placeholder:text-white/30"
                  rows={5}
                  maxLength={MAX_TEXT}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={busy !== null}
                  placeholder={rtl ? "اكتب هنا ما تريد سماعه بصوت طبيعي…" : "Write your Arabic script here…"}
                  dir="auto"
                />
              </div>

              <div className="flex h-14 items-center justify-center gap-1.5 rounded-xl border border-indigo-200/[0.09] bg-indigo-300/[0.045]" aria-label={rtl ? "مؤشر معالجة الصوت" : "Voice processing indicator"}>
                {BARS.map((height, index) => (
                  <motion.span
                    key={index}
                    className="w-1.5 rounded-full bg-gradient-to-t from-indigo-500/65 via-indigo-300 to-sky-200"
                    style={{ height: height * 0.53 }}
                    animate={busy === "tts" && !reduceMotion ? { scaleY: [0.6, 1.35, 0.55] } : { scaleY: 1 }}
                    transition={{ duration: 0.8, repeat: busy === "tts" && !reduceMotion ? Infinity : 0, delay: index * 0.04 }}
                  />
                ))}
              </div>

              <button
                type="button"
                disabled={!text.trim() || busy !== null}
                onClick={() => void synthesize()}
                className="flex min-h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#626CE7] to-[#7672E9] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_35px_-14px_rgba(99,102,241,.9)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy === "tts" ? <LoaderCircle className="size-[18px] animate-spin" aria-hidden="true" /> : <WandSparkles className="size-[18px]" aria-hidden="true" />}
                {busy === "tts" ? (rtl ? "جارٍ توليد الصوت…" : "Generating speech…") : (rtl ? "توليد الصوت" : "Generate speech")}
                {busy !== "tts" && <NextArrow className="size-4" aria-hidden="true" />}
              </button>
              {errorTTS && <p className="rounded-xl border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm text-red-200" role="alert">{errorTTS}</p>}

              <AnimatePresence mode="wait">
                {audioUrl && (
                  <motion.div
                    key={audioUrl}
                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="space-y-3 rounded-2xl border border-emerald-200/15 bg-emerald-200/[0.055] p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-2 font-semibold text-emerald-200">
                        <Check className="size-4" aria-hidden="true" />
                        {rtl ? "تم استلام ملف الصوت" : "Audio received"}
                      </span>
                      {ttsElapsed !== null && <span className="text-white/45">{rtl ? "زمن الطلب:" : "Request time:"} {formatTime(ttsElapsed)}</span>}
                    </div>
                    <audio controls preload="metadata" src={audioUrl} className="w-full" aria-label={rtl ? "الصوت الناتج" : "Generated audio"} />
                    <a
                      className="inline-flex items-center gap-2 rounded-lg border border-emerald-200/20 bg-emerald-200/10 px-3.5 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-200/15"
                      href={audioUrl}
                      download="murailex-voice.mp3"
                    >
                      <ArrowDownToLine className="size-4" aria-hidden="true" />
                      {rtl ? "تنزيل MP3" : "Download MP3"}
                    </a>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </GlassPanel>
        </motion.section>

        <motion.section {...animateUp} transition={{ duration: 0.45, delay: 0.12 }} aria-label={rtl ? "تحويل الصوت إلى نص" : "Speech to text"}>
          <GlassPanel>
            <div aria-hidden="true" className="pointer-events-none absolute -left-20 -top-28 size-72 rounded-full bg-sky-400/[0.10] blur-3xl" />
            <div className="relative space-y-6 p-5 sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-3">
                  <span className="flex size-12 items-center justify-center rounded-2xl border border-sky-200/20 bg-sky-300/10 shadow-[0_0_40px_-12px_rgba(56,189,248,.45)]">
                    <Mic2 className="size-6 text-sky-200" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-widest text-sky-200/85" dir="ltr">02 / SPEECH TO TEXT</div>
                    <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{rtl ? "كل كلمة تصبح نصًا" : "Every word, captured"}</h2>
                    <p className="mt-1 text-sm leading-6 text-white/55">
                      {rtl ? "Groq Whisper Large V3 — التفريغ باللغة العربية" : "Groq Whisper Large V3 · Arabic recognition"}
                    </p>
                  </div>
                </div>
                <span className="rounded-lg border border-white/10 bg-white/[0.035] p-2.5 text-sky-200" aria-hidden="true">
                  <Activity className="size-4" />
                </span>
              </div>

              <label
                htmlFor="voice-audio-file"
                className="group relative flex min-h-56 cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-sky-200/25 bg-gradient-to-b from-sky-300/[0.07] to-transparent p-5 text-center transition hover:border-sky-200/50 hover:from-sky-300/[0.12] focus-within:border-sky-200 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-sky-200"
              >
                <input
                  ref={fileRef}
                  id="voice-audio-file"
                  type="file"
                  accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.webm"
                  className="sr-only"
                  disabled={busy !== null}
                  onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
                />
                <span className="grid size-15 place-items-center rounded-2xl border border-sky-200/15 bg-sky-200/10 text-sky-100 shadow-[0_0_32px_-14px_rgba(125,211,252,.4)] transition group-hover:scale-105">
                  {file ? <FileAudio2 className="size-7" aria-hidden="true" /> : <CloudUpload className="size-7" aria-hidden="true" />}
                </span>
                <span className="space-y-1.5">
                  <span className="block max-w-[18rem] truncate text-sm font-semibold text-white/90" dir="auto">
                    {file ? file.name : rtl ? "اختر تسجيلًا صوتيًا" : "Choose your audio file"}
                  </span>
                  <span className="block text-xs text-white/45">
                    {file ? formatBytes(file.size) : rtl ? "MP3, WAV, M4A, FLAC, OGG, WEBM" : "MP3, WAV, M4A, FLAC, OGG, WEBM"}
                  </span>
                  <span className="block text-xs text-sky-200/65">
                    {rtl ? "حتى 25 ميغابايت" : "Up to 25 MB"}
                  </span>
                </span>
              </label>

              <label className="block space-y-2 rounded-xl border border-white/[0.09] bg-black/[0.13] px-4 py-3">
                <span className="block text-xs font-semibold text-white/75">
                  {rtl ? "سياق اللهجة والأسماء (اختياري)" : "Dialect and names context (optional)"}
                </span>
                <textarea
                  rows={2}
                  maxLength={160}
                  value={whisperContext}
                  onChange={(e) => setWhisperContext(e.target.value)}
                  disabled={busy !== null}
                  dir="auto"
                  className="w-full resize-y bg-transparent text-xs leading-6 text-white/80 outline-none placeholder:text-white/35"
                  placeholder={rtl
                    ? "مثال: تسجيل مالي. أسماء: عمر، عبدالله، سناء. مبالغ: 15,000، 94,000."
                    : "Example: Arabic financial conversation; names and terms heard in this recording"}
                  aria-label={rtl ? "السياق الصوتي الاختياري" : "Optional audio context"}
                />
                <span className="block text-[11px] text-white/45">
                  {rtl
                    ? "اذكر فقط أسماء ومصطلحات موجودة في التسجيل. الحد 200 بايت UTF-8 لضبط عدد رموز Whisper."
                    : "Include only terms heard in the recording. 200 UTF-8 byte maximum for Whisper."}
                </span>
              </label>

              {file && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.09] bg-black/[0.17] px-3.5 py-3 text-xs text-white/65">
                  <span className="flex min-w-0 items-center gap-2">
                    <FileAudio2 className="size-4 shrink-0 text-sky-300" aria-hidden="true" />
                    <span className="truncate" dir="auto">{file.name}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={rtl ? "إزالة الملف" : "Remove file"}
                    disabled={busy !== null}
                    onClick={() => {
                      setAudioFile(null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                    className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>
              )}

              <button
                type="button"
                disabled={!file || busy !== null}
                onClick={() => void transcribe()}
                className="flex min-h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#149BB6] to-[#238FBF] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_35px_-14px_rgba(14,165,233,.75)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy === "stt" ? <LoaderCircle className="size-[18px] animate-spin" aria-hidden="true" /> : <AudioLines className="size-[18px]" aria-hidden="true" />}
                {busy === "stt" ? (rtl ? "جارٍ تحليل التسجيل…" : "Transcribing audio…") : (rtl ? "رفع الصوت وتفريغه" : "Upload and transcribe")}
                {busy !== "stt" && <NextArrow className="size-4" aria-hidden="true" />}
              </button>
              {errorSTT && <p className="rounded-xl border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm text-red-200" role="alert">{errorSTT}</p>}

              <AnimatePresence mode="wait">
                {transcript && (
                  <motion.div
                    key={sourceHash || "transcription"}
                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="space-y-3 rounded-2xl border border-sky-200/15 bg-sky-200/[0.045] p-4"
                  >
                    {sttElapsed !== null && (
                      <p className="text-end text-xs text-white/45">
                        {rtl ? "زمن التفريغ:" : "Transcription time:"} {formatTime(sttElapsed)}
                      </p>
                    )}
                    <TranscriptAnalysisPanel
                      key={sourceHash || transcript}
                      rawText={transcript}
                      sourceSha256={sourceHash}
                      rtl={rtl}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </GlassPanel>
        </motion.section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.075] bg-white/[0.025] px-5 py-4 text-xs leading-6 text-white/45 backdrop-blur-xl">
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="size-4 shrink-0 text-emerald-200/75" aria-hidden="true" />
          {rtl
            ? "هذا المختبر مستقل؛ مخرجاته ليست محاضر قضائية معتمدة، والتسجيلات الأصلية لا تُعدّل."
            : "Independent preview. Results are not certified forensic transcripts; original recordings remain unchanged."}
        </span>
        <span className="font-medium tracking-[0.16em] text-white/40" dir="ltr">MURAILEX © 2026</span>
      </div>
    </div>
  );
}
