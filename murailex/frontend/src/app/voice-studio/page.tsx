"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { api, csrf } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { GroqVoiceStudio } from "@/components/groq-voice-studio";

type Engine = {
  configured: boolean;
  ready: boolean;
  model: string;
  voices?: string[];
  default_voice?: string | null;
};
type GatewayStatus = { scope: string; asr: Engine; tts: Engine };
type AsrPreview = {
  scope: string;
  model: string;
  source_sha256: string;
  raw_transcript: string;
  segments: Record<string, unknown>[];
};

const AUDIO_RATE = 24000;

function waveFile(chunks: Uint8Array[]): Blob {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const data = new ArrayBuffer(44 + length);
  const view = new DataView(data);
  const bytes = new Uint8Array(data);
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, AUDIO_RATE, true);
  view.setUint32(28, AUDIO_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, length, true);
  let offset = 44;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([data], { type: "audio/wav" });
}

export default function VoiceStudioPage() {
  const { dir } = useI18n();
  const rtl = dir === "rtl";
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [context, setContext] = useState("");
  const [consent, setConsent] = useState(false);
  const [asrBusy, setAsrBusy] = useState(false);
  const [transcript, setTranscript] = useState<AsrPreview | null>(null);
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("");
  const [cfg, setCfg] = useState(1.5);
  const [steps, setSteps] = useState(5);
  const [synthBusy, setSynthBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [complete, setComplete] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<AudioBufferSourceNode[]>([]);
  const pcmRef = useRef<Uint8Array[]>([]);

  useEffect(() => {
    let active = true;
    api<GatewayStatus>("/api/vibevoice/status")
      .then((value) => {
        if (!active) return;
        setStatus(value);
        setVoice(value.tts.default_voice || value.tts.voices?.[0] || "");
      })
      .catch(() => { if (active) setError(rtl ? "تعذّر فحص خدمة VibeVoice." : "Cannot check VibeVoice service."); });
    return () => {
      active = false;
      abortRef.current?.abort();
      for (const node of nodesRef.current) {
        try { node.stop(); } catch { /* already stopped */ }
      }
      const context = audioRef.current;
      if (context) void context.close();
    };
  }, [rtl]);

  function stopSpeech() {
    abortRef.current?.abort();
    abortRef.current = null;
    for (const node of nodesRef.current) {
      try { node.stop(); } catch { /* already stopped */ }
    }
    nodesRef.current = [];
    const context = audioRef.current;
    audioRef.current = null;
    if (context) void context.close();
    setSynthBusy(false);
  }

  async function transcribe() {
    if (!file || !consent || !status?.asr.ready) return;
    setError("");
    setTranscript(null);
    setAsrBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("context_info", context);
      body.set("consent", "true");
      const preview = await api<AsrPreview>("/api/vibevoice/asr", { method: "POST", body });
      setTranscript(preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ASR request failed.");
    } finally {
      setAsrBusy(false);
    }
  }

  async function synthesize() {
    if (!consent || !status?.tts.ready || !text.trim() || synthBusy) return;
    setError("");
    setSeconds(0);
    setComplete(false);
    pcmRef.current = [];
    stopSpeech();
    const controller = new AbortController();
    abortRef.current = controller;
    setSynthBusy(true);
    try {
      const response = await fetch("/api/vibevoice/speech", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
        headers: { "content-type": "application/json", "x-csrf-token": csrf() },
        body: JSON.stringify({ text, voice: voice || null, cfg_scale: cfg, inference_steps: steps, consent: true }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.detail === "string" ? body.detail : "Speech synthesis failed.");
      }
      if (!response.body) throw new Error("Audio stream is unavailable.");
      if (response.headers.get("X-Audio-Format") !== "pcm_s16le") throw new Error("Unexpected audio format.");

      const audio = new AudioContext();
      audioRef.current = audio;
      await audio.resume();
      let playAt = audio.currentTime + 0.15;
      let remainder: number | null = null;
      let samples = 0;
      const reader = response.body.getReader();

      while (true) {
        const packet = await reader.read();
        if (packet.done) break;
        let data = packet.value;
        if (remainder !== null) {
          const combined = new Uint8Array(data.length + 1);
          combined[0] = remainder;
          combined.set(data, 1);
          data = combined;
          remainder = null;
        }
        if (data.length % 2) {
          remainder = data[data.length - 1];
          data = data.slice(0, -1);
        }
        if (!data.length) continue;

        pcmRef.current.push(data.slice());
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const samplesInChunk = data.byteLength / 2;
        const floats = new Float32Array(samplesInChunk);
        for (let i = 0; i < samplesInChunk; i += 1) {
          floats[i] = view.getInt16(i * 2, true) / 32768;
        }
        const buffer = audio.createBuffer(1, samplesInChunk, AUDIO_RATE);
        buffer.copyToChannel(floats, 0);
        const node = audio.createBufferSource();
        node.buffer = buffer;
        node.connect(audio.destination);
        node.onended = () => {
          nodesRef.current = nodesRef.current.filter((existing) => existing !== node);
        };
        playAt = Math.max(playAt, audio.currentTime + 0.05);
        node.start(playAt);
        playAt += samplesInChunk / AUDIO_RATE;
        nodesRef.current.push(node);
        samples += samplesInChunk;
        setSeconds(samples / AUDIO_RATE);
      }
      if (remainder !== null) throw new Error("Truncated PCM16 audio frame.");
      if (!samples) throw new Error("Model returned no audio.");
      setComplete(true);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Speech synthesis failed.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSynthBusy(false);
    }
  }

  function saveSpeech() {
    if (!pcmRef.current.length || !complete) return;
    const url = URL.createObjectURL(waveFile(pcmRef.current));
    const link = document.createElement("a");
    link.href = url;
    link.download = "murailex-vibevoice-" + new Date().toISOString().replace(/[:.]/g, "-") + ".wav";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const asrReady = status?.asr.ready === true;
  const ttsReady = status?.tts.ready === true;

  return (
    <div className="space-y-5 fade-in">
      <PageHeader title={rtl ? "VibeVoice — مختبر الصوت" : "VibeVoice — Voice Studio"} />
      <Notice tone="info">
        {rtl
          ? "مساحة تجريبية منفصلة. المخرجات ليست محاضر جنائية معتمدة، ولا تغيّر التسجيلات الأصلية أو سجلات التدقيق."
          : "Separate research-preview workspace. Results are not certified forensic transcripts and never modify original evidence or audit records."}
      </Notice>
      {error && <Notice tone="danger" role="alert">{error}</Notice>}
      <GroqVoiceStudio />

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{rtl ? "تفريغ الصوت — VibeVoice ASR" : "Speech to text — VibeVoice ASR"}</CardTitle>
          <span className="text-xs text-fg-muted" dir="ltr">{asrReady ? "ONLINE" : "NOT AVAILABLE"}</span>
        </div>
        <p className="text-sm text-fg-muted">
          {rtl ? "تفريغ مستقل مع تمييز المتحدثين والطوابع الزمنية كما يُرجعها النموذج؛ النتائج تحتاج تحققًا بشريًا." : "Standalone transcription with model-reported speakers and timestamps; human verification is required."}
        </p>
        <label className="block space-y-2 text-sm">
          <span>{rtl ? "الملف الصوتي" : "Audio file"}</span>
          <input className="block w-full text-sm" aria-label="Audio file" type="file" accept="audio/*,.m4a,.flac,.ogg,.webm" onChange={(event) => setFile(event.target.files?.[0] || null)} />
        </label>
        <label className="block space-y-2 text-sm">
          <span>{rtl ? "سياق وأسماء لتحسين التعرّف (اختياري)" : "Hotwords / context (optional)"}</span>
          <textarea className="w-full rounded-lg border border-line bg-surface-2 p-3 text-fg" value={context} maxLength={1200} onChange={(event) => setContext(event.target.value)} rows={2} />
        </label>
        <Button disabled={!asrReady || !file || !consent || asrBusy} onClick={() => void transcribe()}>
          {asrBusy ? (rtl ? "جارٍ التفريغ…" : "Transcribing…") : (rtl ? "بدء التفريغ" : "Transcribe")}
        </Button>
        {transcript && (
          <div className="space-y-2 rounded-lg border border-line p-3">
            <div className="break-all text-xs text-fg-subtle" dir="ltr">{transcript.model} · SHA-256 {transcript.source_sha256}</div>
            <pre className="max-h-[35rem] overflow-auto whitespace-pre-wrap break-words text-sm" dir="auto">
              {transcript.segments.length ? JSON.stringify(transcript.segments, null, 2) : transcript.raw_transcript}
            </pre>
          </div>
        )}
      </Card>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{rtl ? "توليد الصوت الفوري — Realtime TTS" : "Text to speech — Realtime TTS"}</CardTitle>
          <span className="text-xs text-fg-muted" dir="ltr">{ttsReady ? "ONLINE" : "NOT AVAILABLE"}</span>
        </div>
        <p className="text-sm text-fg-muted">
          {rtl ? "النموذج 0.5B يولّد صوت متحدث واحد، بالإنجليزية أساسًا. التشغيل يعتمد على خادم GPU منفصل." : "The 0.5B model generates one speaker at a time, primarily in English, on a separate GPU host."}
        </p>
        <textarea aria-label="Speech text" className="w-full rounded-lg border border-line bg-surface-2 p-3 text-fg" rows={5} maxLength={2400} value={text} onChange={(event) => setText(event.target.value)} placeholder={rtl ? "أدخل النص المطلوب تحويله إلى صوت" : "Enter text to speak"} />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-2 text-sm">
            <span>{rtl ? "الصوت" : "Voice"}</span>
            <select aria-label="Voice" className="w-full rounded-lg border border-line bg-surface-2 p-2" value={voice} onChange={(event) => setVoice(event.target.value)}>
              {(status?.tts.voices || []).map((key) => <option value={key} key={key}>{key}</option>)}
            </select>
          </label>
          <label className="space-y-2 text-sm">
            <span>CFG: {cfg.toFixed(2)}</span>
            <input className="w-full" type="range" min="1.3" max="3" step="0.05" value={cfg} onChange={(event) => setCfg(Number(event.target.value))} />
          </label>
          <label className="space-y-2 text-sm">
            <span>{rtl ? "خطوات الاستدلال" : "Inference steps"}: {steps}</span>
            <input className="w-full" type="range" min="5" max="20" step="1" value={steps} onChange={(event) => setSteps(Number(event.target.value))} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!ttsReady || !consent || !text.trim() || synthBusy} onClick={() => void synthesize()}>
            {synthBusy ? (rtl ? "جارٍ توليد الصوت…" : "Generating…") : (rtl ? "توليد وتشغيل" : "Generate and play")}
          </Button>
          <Button variant="secondary" disabled={!synthBusy && !complete} onClick={stopSpeech}>{rtl ? "إيقاف" : "Stop"}</Button>
          <Button variant="outline" disabled={!complete} onClick={saveSpeech}>{rtl ? "حفظ WAV" : "Save WAV"}</Button>
          <span className="text-xs tabular-nums text-fg-muted">{seconds.toFixed(1)} s</span>
        </div>
      </Card>

      <Card>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          <span>
            {rtl
              ? "أوافق صراحةً على إرسال الصوت أو النص الذي أختاره إلى خدمة GPU الخارجية المهيأة. لن يُرسل أي ملف دون هذا الاختيار. لا أستخدم مواد حساسة قبل مراجعة سياسة الجهة المستضيفة."
              : "I explicitly authorize sending the selected audio or text to the configured external GPU service. No content is transmitted without this choice. I will not use sensitive materials before reviewing the host's data policy."}
          </span>
        </label>
        {!status?.asr.configured && !status?.tts.configured && (
          <p className="mt-3 text-sm text-fg-muted">
            {rtl ? "لم يُفعّل المسؤول اتصال نماذج VibeVoice بعد. راجع إعدادات GPU وخصوصية البيانات." : "An administrator has not enabled the VibeVoice GPU connections and privacy gate."}
          </p>
        )}
      </Card>
    </div>
  );
}
