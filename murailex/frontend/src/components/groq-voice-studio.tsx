"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { api, csrf } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Locale = "ar" | "en";

type EngineStatus = {
  configured: boolean;
  engine_verified: boolean;
  provider: string;
  stt_model: string;
  tts_models: Record<Locale, string>;
  voices: Record<Locale, string[]>;
  max_stt_upload_bytes: number;
  max_tts_characters: number;
  scope: string;
};

type Segment = { start?: number; end?: number; text?: string };
type Transcript = {
  provider: string;
  model: string;
  scope: string;
  saved_to_case: boolean;
  source_sha256: string;
  elapsed_ms: number;
  text: string;
  language?: string;
  duration?: number;
  segments: Segment[];
  words: { start?: number; end?: number; word?: string }[];
};

export function GroqVoiceStudio() {
  const { dir } = useI18n();
  const rtl = dir === "rtl";
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sttLanguage, setSttLanguage] = useState<Locale | "auto">("auto");
  const [sttContext, setSttContext] = useState("");
  const [consent, setConsent] = useState(false);
  const [sttBusy, setSttBusy] = useState(false);
  const [sttError, setSttError] = useState("");
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [ttsLanguage, setTtsLanguage] = useState<Locale>("ar");
  const [ttsVoice, setTtsVoice] = useState("fahad");
  const [ttsText, setTtsText] = useState("");
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsError, setTtsError] = useState("");
  const [wavUrl, setWavUrl] = useState("");
  const urlRef = useRef("");
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let mounted = true;
    api<EngineStatus>("/api/voice-ai/status")
      .then((data) => { if (mounted) setStatus(data); })
      .catch((e: unknown) => {
        if (mounted) setStatusError(e instanceof Error ? e.message : "Status unavailable");
      });
    return () => {
      mounted = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const available = status?.configured === true;

  async function transcribe() {
    if (!file || !consent || !available || sttBusy) return;
    setSttError("");
    setTranscript(null);
    if (file.size > (status?.max_stt_upload_bytes ?? 25_000_000)) {
      setSttError(rtl ? "حجم الملف أكبر من الحد المسموح (25 ميغابايت)." : "File exceeds the 25 MB limit.");
      return;
    }
    setSttBusy(true);
    const payload = new FormData();
    payload.set("file", file);
    payload.set("language", sttLanguage);
    payload.set("context_info", sttContext);
    payload.set("consent", "true");
    try {
      const result = await api<Transcript>("/api/voice-ai/stt", { method: "POST", body: payload });
      setTranscript(result);
    } catch (e) {
      setSttError(e instanceof Error ? e.message : "Transcription failed");
    } finally {
      setSttBusy(false);
    }
  }

  async function synthesize() {
    if (!consent || !available || ttsBusy || !ttsText.trim()) return;
    setTtsError("");
    setTtsBusy(true);
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = "";
    }
    setWavUrl("");
    try {
      const response = await fetch("/api/voice-ai/tts", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json", "x-csrf-token": csrf() },
        body: JSON.stringify({ text: ttsText, language: ttsLanguage, voice: ttsVoice, consent: true }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        let detail = "Speech synthesis failed";
        if (payload && typeof payload === "object" && "detail" in payload) {
          const value = (payload as { detail: unknown }).detail;
          if (typeof value === "string") detail = value;
        }
        throw new Error(detail);
      }
      const blob = await response.blob();
      if (blob.size < 44 || !response.headers.get("content-type")?.includes("audio/wav")) {
        throw new Error("Invalid WAV response");
      }
      const objectUrl = URL.createObjectURL(blob);
      urlRef.current = objectUrl;
      setWavUrl(objectUrl);
      // Audio controls remain available if autoplay is blocked.
      window.setTimeout(() => { void audioRef.current?.play().catch(() => undefined); }, 0);
    } catch (e) {
      setTtsError(e instanceof Error ? e.message : "Speech synthesis failed");
    } finally {
      setTtsBusy(false);
    }
  }

  const voices = status?.voices[ttsLanguage] || (ttsLanguage === "ar" ? ["fahad"] : ["hannah"]);
  const maxChars = status?.max_tts_characters ?? 200;

  return (
    <div className="space-y-5">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{rtl ? "الذكاء الصوتي — Groq" : "Voice AI — Groq"}</CardTitle>
          <span className="text-xs font-semibold text-fg-muted" dir="ltr">
            {available ? "KEY CONFIGURED · REAL INFERENCE REQUIRED" : "NOT CONFIGURED"}
          </span>
        </div>
        <p className="text-sm text-fg-muted">
          {rtl
            ? "تفريغ Whisper Large V3 وتوليد أصوات Orpheus العربية والإنجليزية. هذا مسار مستقل للتجربة؛ لا يغيّر أدلة القضية، ولا يُعد تفريغًا جنائيًا معتمدًا."
            : "Whisper Large V3 transcription and Orpheus Arabic/English speech. Independent preview only: it never changes case evidence and is not a certified forensic transcript."}
        </p>
        {statusError && <Notice tone="danger">{statusError}</Notice>}
        {!available && <Notice tone="info">{rtl ? "لم يُفعّل مفتاح Groq في خدمة Backend." : "Groq is not configured on the backend."}</Notice>}
        {available && !status?.engine_verified && (
          <p className="text-xs text-fg-subtle">
            {rtl ? "وجود المفتاح لا يثبت صلاحية الاستدلال؛ النتيجة تتأكد بعد نجاح الطلب الحقيقي." : "Key presence alone is not a model inference test. A successful real request is required."}
          </p>
        )}
      </Card>

      <Card className="space-y-4">
        <div>
          <CardTitle>{rtl ? "التفريغ الصوتي (STT)" : "Speech to text (STT)"}</CardTitle>
          <p className="mt-1 text-sm text-fg-muted" dir="ltr">Groq · whisper-large-v3 · segment / word timestamps</p>
        </div>
        <label className="block space-y-1.5 text-sm">
          <span>{rtl ? "اختر التسجيل" : "Choose a recording"}</span>
          <input type="file" accept=".wav,.mp3,.m4a,.mp4,.flac,.ogg,.webm,audio/*" className="w-full" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span>{rtl ? "لغة التسجيل" : "Audio language"}</span>
          <select className="w-full rounded-lg border border-line bg-surface-2 p-2.5" value={sttLanguage} onChange={(e) => setSttLanguage(e.target.value as Locale | "auto")}>
            <option value="auto">{rtl ? "تعرّف تلقائي" : "Auto-detect"}</option>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="block space-y-1.5 text-sm">
          <span>{rtl ? "مصطلحات وأسماء مساعدة (اختياري)" : "Names and terminology (optional)"}</span>
          <textarea rows={2} maxLength={500} className="w-full rounded-lg border border-line bg-surface-2 p-3" value={sttContext} onChange={(e) => setSttContext(e.target.value)} />
        </label>
        <Button disabled={!available || !consent || !file || sttBusy} onClick={() => void transcribe()}>
          {sttBusy ? (rtl ? "جارٍ التفريغ…" : "Transcribing…") : (rtl ? "تحويل إلى نص" : "Transcribe")}
        </Button>
        {sttError && <Notice tone="danger">{sttError}</Notice>}
        {transcript && (
          <section className="space-y-3 rounded-xl border border-line p-4">
            <div className="text-xs text-fg-subtle" dir="ltr">
              {transcript.model} · {transcript.elapsed_ms}ms · SHA-256 {transcript.source_sha256}
            </div>
            <pre className="whitespace-pre-wrap break-words text-sm text-fg" dir="auto">{transcript.text}</pre>
            <details>
              <summary className="cursor-pointer text-xs text-fg-muted">
                {rtl ? "توقيتات المقاطع والكلمات" : "Segment and word timestamps"}
              </summary>
              <pre className="mt-2 max-h-[24rem] overflow-auto whitespace-pre-wrap break-all text-xs" dir="ltr">
                {JSON.stringify({ segments: transcript.segments, words: transcript.words }, null, 2)}
              </pre>
            </details>
            <Button variant="outline" onClick={() => void navigator.clipboard.writeText(transcript.text)}>
              {rtl ? "نسخ النص" : "Copy text"}
            </Button>
          </section>
        )}
      </Card>

      <Card className="space-y-4">
        <div>
          <CardTitle>{rtl ? "توليد صوت طبيعي (TTS)" : "Natural voice synthesis (TTS)"}</CardTitle>
          <p className="mt-1 text-sm text-fg-muted">Groq · Orpheus · WAV</p>
        </div>
        <label className="block space-y-1.5 text-sm">
          <span>{rtl ? "لغة الصوت" : "Speech language"}</span>
          <select className="w-full rounded-lg border border-line bg-surface-2 p-2.5" value={ttsLanguage} onChange={(e) => {
            const selected = e.target.value as Locale;
            setTtsLanguage(selected);
            setTtsVoice(selected === "ar" ? "fahad" : "hannah");
          }}>
            <option value="ar">{rtl ? "العربية (السعودية)" : "Arabic (Saudi)"}</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="block space-y-1.5 text-sm">
          <span>{rtl ? "الصوت" : "Voice"}</span>
          <select className="w-full rounded-lg border border-line bg-surface-2 p-2.5" value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)} dir="ltr">
            {voices.map((voice) => <option value={voice} key={voice}>{voice}</option>)}
          </select>
        </label>
        <label className="block space-y-1.5 text-sm">
          <span>{rtl ? "النص المراد توليده" : "Text to speak"}</span>
          <textarea
            rows={4}
            maxLength={maxChars}
            className="w-full rounded-lg border border-line bg-surface-2 p-3"
            value={ttsText}
            onChange={(e) => setTtsText(e.target.value)}
            placeholder={ttsLanguage === "ar" ? "مرحبًا بكم في تطبيق مورايلكس." : "Welcome to MURAILEX."}
            dir="auto"
          />
          <span className="block text-end text-xs text-fg-subtle" dir="ltr">{ttsText.length} / {maxChars}</span>
        </label>
        <Button disabled={!available || !consent || !ttsText.trim() || ttsBusy} onClick={() => void synthesize()}>
          {ttsBusy ? (rtl ? "جارٍ التوليد…" : "Generating…") : (rtl ? "توليد الصوت" : "Generate speech")}
        </Button>
        {ttsError && <Notice tone="danger">{ttsError}</Notice>}
        {wavUrl && (
          <div className="space-y-3">
            <audio ref={audioRef} src={wavUrl} controls className="w-full" aria-label={rtl ? "الصوت المولد" : "Generated speech"} />
            <a className="inline-flex rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface-2" href={wavUrl} download="murailex-orpheus.wav">
              {rtl ? "تنزيل WAV" : "Download WAV"}
            </a>
          </div>
        )}
      </Card>

      <Card>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
          <span>{rtl
            ? "أوافق على إرسال الملف أو النص المختار إلى Groq للمعالجة. هذه النتائج تجريبية ولا تشكّل تفريغًا قضائيًا معتمدًا."
            : "I consent to sending the selected audio or text to Groq. These results are a preview, not certified legal evidence."}</span>
        </label>
      </Card>
    </div>
  );
}
