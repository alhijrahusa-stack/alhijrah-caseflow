"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { csrf } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : "Request failed.";
}

async function readError(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  if (payload && typeof payload === "object" && "error" in payload) {
    const value = (payload as { error: unknown }).error;
    if (typeof value === "string") return value;
  }
  return "Request failed (HTTP " + response.status + ").";
}

export default function VoiceStudioPage() {
  const { dir } = useI18n();
  const rtl = dir === "rtl";
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"tts" | "stt" | null>(null);
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const urlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  async function generate() {
    if (!text.trim() || busy) return;
    setBusy("tts");
    setError("");
    setAudioUrl("");
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrf() },
        body: JSON.stringify({ text }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await readError(res));
      if (!(res.headers.get("content-type") || "").includes("audio/mpeg")) {
        throw new Error("Unexpected response format.");
      }
      const mp3 = await res.blob();
      if (mp3.size < 64) throw new Error("Provider returned empty audio.");
      const url = URL.createObjectURL(mp3);
      urlRef.current = url;
      setAudioUrl(url);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function transcribe() {
    if (!file || busy) return;
    setBusy("stt");
    setError("");
    setTranscript("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/stt", {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-csrf-token": csrf() },
        body: form,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await readError(res));
      const result: unknown = await res.json();
      if (!result || typeof result !== "object" || !("text" in result) || typeof result.text !== "string") {
        throw new Error("Invalid transcription response.");
      }
      setTranscript(result.text);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 fade-in">
      <PageHeader title={rtl ? "مختبر الصوت — MURAILEX" : "MURAILEX Voice Studio"} />
      <Notice tone="info">
        {rtl
          ? "معالجة صوتية مستقلة. المخرجات تجريبية ولا تُعد محضرًا جنائيًا معتمدًا، ولن تغيّر التسجيلات الأصلية."
          : "Independent voice processing. Output is not a certified forensic transcript and never modifies source evidence."}
      </Notice>
      {error && <Notice tone="danger" role="alert">{error}</Notice>}
      <Card className="space-y-4">
        <CardTitle>{rtl ? "تحويل النص إلى صوت" : "Text to Speech"}</CardTitle>
        <p className="text-sm text-fg-muted">{rtl ? "الصوت العربي: شاكر — Microsoft Edge Neural" : "Arabic voice: Shakir — Microsoft Edge Neural"}</p>
        <label className="block space-y-2 text-sm">
          <span>{rtl ? "النص" : "Text"}</span>
          <textarea
            className="w-full rounded-lg border border-line bg-surface-2 p-3 text-fg"
            rows={5}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={rtl ? "اكتب النص الذي تريد سماعه" : "Type the text you want to hear"}
            dir="auto"
          />
          <span className="block text-end text-xs text-fg-subtle" dir="ltr">{text.length}/1000</span>
        </label>
        <Button disabled={!text.trim() || busy !== null} onClick={() => void generate()}>
          {busy === "tts" ? (rtl ? "جارٍ التوليد…" : "Generating…") : (rtl ? "توليد الصوت" : "Generate Speech")}
        </Button>
        {audioUrl && (
          <div className="space-y-3">
            <audio controls src={audioUrl} className="w-full" aria-label={rtl ? "الصوت الناتج" : "Generated speech"} />
            <a href={audioUrl} download="audio.mp3" className="inline-flex rounded-lg border border-line px-4 py-2 text-sm text-fg hover:bg-surface-2">
              {rtl ? "تنزيل MP3" : "Download MP3"}
            </a>
          </div>
        )}
      </Card>
      <Card className="space-y-4">
        <CardTitle>{rtl ? "تحويل الصوت إلى نص" : "Speech to Text"}</CardTitle>
        <p className="text-sm text-fg-muted" dir="ltr">Groq Whisper Large V3 · Arabic</p>
        <label className="block space-y-2 text-sm">
          <span>{rtl ? "الملف الصوتي" : "Audio file"}</span>
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.webm"
            className="w-full text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <Button disabled={!file || busy !== null} onClick={() => void transcribe()}>
          {busy === "stt" ? (rtl ? "جارٍ التفريغ…" : "Transcribing…") : (rtl ? "رفع الصوت وتفريغه" : "Upload Audio for STT")}
        </Button>
        {transcript && (
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <p className="whitespace-pre-wrap text-sm text-fg" dir="auto">{transcript}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
