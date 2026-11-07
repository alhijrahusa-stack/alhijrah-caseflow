"use client";

import { ArrowDownToLine, Check, Clipboard, FileText, Languages, LoaderCircle, Sparkles } from "lucide-react";
import { useState } from "react";

import { api } from "@/lib/api";

type DerivedAnalysis = {
  cleaned_transcript: string;
  summary: string;
  translation: string;
  analysis: string;
};

type View = "cleaned" | "raw" | "summary" | "translation" | "analysis";

export function TranscriptAnalysisPanel({
  rawText,
  sourceSha256,
  rtl,
}: {
  rawText: string;
  sourceSha256: string;
  rtl: boolean;
}) {
  const [derived, setDerived] = useState<DerivedAnalysis | null>(null);
  const [view, setView] = useState<View>("raw");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function analyze() {
    if (!rawText.trim() || loading) return;
    setLoading(true);
    setError("");
    try {
      const result = await api<DerivedAnalysis>("/api/analyze", {
        method: "POST",
        json: { text: rawText },
      });
      if (!result || !["cleaned_transcript", "summary", "translation", "analysis"].every(
        (key) => typeof result[key as keyof DerivedAnalysis] === "string",
      ) || !result.cleaned_transcript.trim()) {
        throw new Error("Invalid analysis response.");
      }
      setDerived(result);
      setView("cleaned");
      setCopied(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The analysis request failed.");
    } finally {
      setLoading(false);
    }
  }

  const items: { key: View; ar: string; en: string }[] = [
    { key: "raw", ar: "النص الأصلي (Whisper)", en: "Original (Whisper)" },
    ...(derived
      ? [
          { key: "cleaned" as const, ar: "النص المنقح", en: "Cleaned transcript" },
          { key: "summary" as const, ar: "الملخص", en: "Summary" },
          { key: "translation" as const, ar: "الترجمة", en: "Translation" },
          { key: "analysis" as const, ar: "الأسماء والتواريخ والمبالغ", en: "Entities" },
        ]
      : []),
  ];
  const displayedText = view === "raw" ? rawText : derived?.[
    view === "cleaned" ? "cleaned_transcript" : view
  ] || rawText;

  async function copy() {
    try {
      await navigator.clipboard.writeText(displayedText);
      setCopied(true);
    } catch {
      setError(rtl ? "تعذّر النسخ إلى الحافظة." : "Clipboard access was denied.");
    }
  }

  function download() {
    const blob = new Blob([displayedText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "murailex-" + view + ".txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-sky-200">
          <FileText className="size-4" aria-hidden="true" />
          {rtl ? "التفريغ والتحليل" : "Transcription and analysis"}
        </span>
        <button
          type="button"
          disabled={loading || !rawText.trim() || rawText.length > 7000}
          onClick={() => void analyze()}
          className="inline-flex items-center gap-2 rounded-lg border border-indigo-200/20 bg-indigo-300/10 px-3.5 py-2 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-300/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
          {loading ? (rtl ? "جارٍ التحليل…" : "Analyzing…") : (rtl ? "تنقيح وتلخيص وترجمة" : "Clean, summarize and translate")}
        </button>
      </div>
      {rawText.length > 7000 && (
        <p className="text-xs text-amber-200" role="status">
          {rtl
            ? "هذا النص أطول من حد التحليل (7000 حرف). النص الأصلي محفوظ للعرض والنسخ؛ لم يُختصر."
            : "This transcript exceeds the 7,000-character analysis limit. The original remains available without truncation."}
        </p>
      )}
      {error && <p className="rounded-xl border border-red-300/20 bg-red-400/10 p-3 text-xs text-red-200" role="alert">{error}</p>}

      <div role="tablist" aria-label={rtl ? "أقسام النص" : "Transcript views"} className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={view === item.key}
            onClick={() => {
              setView(item.key);
              setCopied(false);
            }}
            className={
              "rounded-lg border px-3 py-2 text-xs font-medium transition " +
              (view === item.key
                ? "border-sky-200/30 bg-sky-300/15 text-sky-100"
                : "border-white/10 bg-white/[0.035] text-white/55 hover:text-white/90")
            }
          >
            {rtl ? item.ar : item.en}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="max-h-80 overflow-auto rounded-xl border border-white/10 bg-black/20 p-3.5">
        <p className="whitespace-pre-wrap break-words text-sm leading-8 text-white/85" dir="auto">{displayedText}</p>
      </div>
      {view !== "raw" && derived && (
        <p className="inline-flex items-start gap-1.5 text-[11px] leading-5 text-amber-100/70">
          <Languages className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {rtl
            ? "هذه معالجة آلية مشتقة قابلة للخطأ. لا تُنسب كلمات أو هويات أو مبالغ إلى التسجيل دون مراجعة الصوت الأصلي."
            : "AI-derived output may contain errors. Verify words, identities and amounts against the original audio."}
        </p>
      )}
      {sourceSha256 && <p className="break-all text-[10px] text-white/35" dir="ltr">Audio SHA-256 {sourceSha256}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-2 rounded-lg border border-sky-200/20 bg-sky-200/10 px-3.5 py-2 text-xs font-semibold text-sky-100 hover:bg-sky-200/15">
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Clipboard className="size-4" aria-hidden="true" />}
          {copied ? (rtl ? "تم النسخ" : "Copied") : (rtl ? "نسخ النص" : "Copy text")}
        </button>
        <button type="button" onClick={download} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.055] px-3.5 py-2 text-xs font-semibold text-white/85 hover:bg-white/10">
          <ArrowDownToLine className="size-4" aria-hidden="true" />
          {rtl ? "تنزيل TXT" : "Download TXT"}
        </button>
      </div>
    </div>
  );
}
