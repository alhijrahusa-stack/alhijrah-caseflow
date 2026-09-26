"use client";

import { AlertTriangle, Check, Clock3, Copy, FileText, ShieldCheck, Sparkles, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fmtTime } from "@/lib/format";
import type { Content, Recording, Segment } from "@/lib/types";

const STOP = new Set(
  [
    "the","a","an","and","or","but","of","to","in","on","for","with","is","are","was","were","be","been","this","that","it","i","you","he","she","we","they","my","your","his","her","our","their","do","did","does","not","yes","no",
    "في","من","على","إلى","الى","عن","مع","هذا","هذه","ذلك","تلك","هو","هي","انا","أنا","انت","أنت","نحن","هم","كان","كانت","يكون","ما","ماذا","لم","لن","لا","نعم","و","او","أو","ثم","قد","كل","أي","اي","بعد","قبل","عند",
  ],
);

const SIGNAL_TERMS = [
  "أقر", "اقر", "اعترف", "أكد", "اكد", "أنكر", "انكر", "دفع", "مبلغ", "دولار", "موعد", "تاريخ", "وقت", "اتفق", "وافق", "رفض", "تحويل", "نقد", "كاش",
  "admit", "admitted", "acknowledge", "acknowledged", "confirm", "confirmed", "deny", "denied", "money", "dollar", "payment", "date", "time", "agreed", "refused", "cash", "transfer",
];

function textOf(seg: Segment): string {
  return seg.items.filter((i) => i.kind !== "dispute").map((i) => i.text).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}$]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

function clip(text: string, max = 185): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

function segmentLabel(content: Content, seg: Segment): string {
  if (!seg.speaker) return "";
  const info = content.speakers[seg.speaker];
  return info?.verified_name || info?.label || seg.speaker;
}

export type SummaryData = {
  overview: string;
  keyPoints: { startMs: number; label: string; text: string }[];
  critical: { startMs: number; label: string; text: string }[];
  speakers: number;
  unresolved: number;
  wordCount: number;
};

export function buildExecutiveSummary(content: Content, recording: Recording, rtl: boolean): SummaryData {
  const rows = content.segments
    .map((seg) => ({ seg, text: textOf(seg), label: segmentLabel(content, seg) }))
    .filter((r) => r.text && !/^\[(غير مسموع|صمت)\]$/u.test(r.text));

  const freq = new Map<string, number>();
  for (const row of rows) for (const token of new Set(terms(row.text))) freq.set(token, (freq.get(token) ?? 0) + 1);
  const totalRows = Math.max(rows.length, 1);
  const scored = rows.map((row, index) => {
    const ts = terms(row.text);
    let score = 0;
    for (const token of new Set(ts)) {
      const df = freq.get(token) ?? 1;
      score += Math.log(1 + totalRows / df);
    }
    const signal = SIGNAL_TERMS.some((s) => row.text.toLowerCase().includes(s));
    if (signal) score += 1.8;
    score /= Math.max(1, Math.sqrt(ts.length));
    return { ...row, index, score };
  });

  const take = Math.min(5, Math.max(3, Math.ceil(rows.length / 7)));
  const keyPoints = scored
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, take)
    .sort((a, b) => a.index - b.index)
    .map((r) => ({ startMs: r.seg.start_ms, label: r.label, text: clip(r.text) }));

  const critical = rows
    .filter((r) => {
      const low = r.text.toLowerCase();
      const risky = r.seg.items.some((i) => i.kind === "dispute" || (i.risks?.length ?? 0) > 0);
      return risky || SIGNAL_TERMS.some((s) => low.includes(s));
    })
    .slice(0, 5)
    .map((r) => ({ startMs: r.seg.start_ms, label: r.label, text: clip(r.text, 145) }));

  const speakers = Object.keys(content.speakers).length;
  const unresolved = content.segments.flatMap((s) => s.items).filter((i) => i.kind === "dispute").length;
  const wordCount = rows.reduce((n, r) => n + r.text.split(/\s+/).filter(Boolean).length, 0);
  const duration = fmtTime(recording.duration_ms ?? content.recording.duration_ms ?? 0);
  const overview = rtl
    ? `يتضمن هذا التسجيل ${speakers || "—"} متحدثين على مدى ${duration}. الملخص أدناه استخراجي ومبني حصراً على النص الحالي، ويعرض المقاطع الأعلى دلالة دون إضافة وقائع أو استنتاجات غير موجودة في التسجيل.`
    : `This recording contains ${speakers || "—"} speakers over ${duration}. The summary below is extractive and based only on the current transcript, surfacing the most information-dense passages without adding facts or conclusions not present in the recording.`;

  return { overview, keyPoints, critical, speakers, unresolved, wordCount };
}

export function summaryPlainText(data: SummaryData, rtl: boolean): string {
  const lines = [rtl ? "MURAILEX — الملخص التنفيذي" : "MURAILEX — Executive Summary", "", data.overview, ""];
  lines.push(rtl ? "النقاط الرئيسية" : "Key Points");
  for (const p of data.keyPoints) lines.push(`[${fmtTime(p.startMs)}] ${p.label ? `${p.label}: ` : ""}${p.text}`);
  if (data.critical.length) {
    lines.push("", rtl ? "مقاطع تستحق المراجعة" : "Review-worthy moments");
    for (const p of data.critical) lines.push(`[${fmtTime(p.startMs)}] ${p.label ? `${p.label}: ` : ""}${p.text}`);
  }
  lines.push("", rtl ? "ملاحظة: التسجيل الصوتي الأصلي هو المرجع الحاكم." : "Notice: The original audio recording is the controlling source.");
  return lines.join("\n");
}

export function ExecutiveSummary({ content, recording, rtl }: { content: Content; recording: Recording; rtl: boolean }) {
  const data = useMemo(() => buildExecutiveSummary(content, recording, rtl), [content, recording, rtl]);
  const [copied, setCopied] = useState(false);

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summaryPlainText(data, rtl));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4 float-in">
      <Card className="glass-elevated relative overflow-hidden border-indigo-400/15 p-5 sm:p-7">
        <div className="pointer-events-none absolute -end-12 -top-16 size-48 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="relative flex items-start gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl border border-indigo-300/20 bg-indigo-400/10 text-indigo-200 shadow-[0_0_28px_rgba(99,102,241,.18)]">
            <Sparkles className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="tech-label">MURAILEX INTELLIGENCE</div>
                <h2 className="mt-1 text-xl font-bold tracking-tight text-white">{rtl ? "الملخص التنفيذي" : "Executive Summary"}</h2>
              </div>
              <Button variant="secondary" size="sm" onClick={copySummary}>
                {copied ? <Check /> : <Copy />} {copied ? (rtl ? "تم النسخ" : "Copied") : (rtl ? "نسخ الملخص" : "Copy summary")}
              </Button>
            </div>
            <p className="mt-4 text-[15px] leading-7 text-slate-300">{data.overview}</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Card className="p-3.5 sm:p-4">
          <Users className="mb-2 size-4 text-cyan-300" />
          <div className="text-xl font-bold tabular-nums">{data.speakers}</div>
          <div className="muted mt-1 text-[11px]">{rtl ? "متحدثون" : "Speakers"}</div>
        </Card>
        <Card className="p-3.5 sm:p-4">
          <FileText className="mb-2 size-4 text-violet-300" />
          <div className="text-xl font-bold tabular-nums">{data.wordCount.toLocaleString()}</div>
          <div className="muted mt-1 text-[11px]">{rtl ? "كلمة" : "Words"}</div>
        </Card>
        <Card className="p-3.5 sm:p-4">
          <AlertTriangle className={`mb-2 size-4 ${data.unresolved ? "text-amber-300" : "text-emerald-300"}`} />
          <div className="text-xl font-bold tabular-nums">{data.unresolved}</div>
          <div className="muted mt-1 text-[11px]">{rtl ? "غير محسوم" : "Unresolved"}</div>
        </Card>
      </div>

      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-indigo-300" />
          <h3 className="font-semibold text-white">{rtl ? "النقاط الرئيسية" : "Key Points"}</h3>
        </div>
        <div className="space-y-2.5">
          {data.keyPoints.map((p, i) => (
            <div key={`${p.startMs}-${i}`} className="group rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3.5 transition hover:border-indigo-400/20 hover:bg-indigo-400/[0.045]">
              <div className="mb-1.5 flex items-center gap-2 text-[11px]">
                <Clock3 className="size-3.5 text-indigo-300" />
                <span className="font-mono text-indigo-300" dir="ltr">{fmtTime(p.startMs)}</span>
                {p.label && <span className="muted"><bdi>{p.label}</bdi></span>}
              </div>
              <p className="bidi-auto text-[15px] leading-7 text-slate-200" dir="auto">{p.text}</p>
            </div>
          ))}
        </div>
      </Card>

      {data.critical.length > 0 && (
        <Card className="space-y-3 border-amber-300/10">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-300" />
            <h3 className="font-semibold text-white">{rtl ? "مقاطع تستحق المراجعة" : "Review-worthy moments"}</h3>
          </div>
          <p className="muted text-xs leading-5">
            {rtl
              ? "اختيار آلي لمواضع تحتوي مؤشرات لغوية أو مناطق متنازعاً عليها. لا يمثل استنتاجاً قانونياً ولا حكماً على محتوى التسجيل."
              : "Automatically surfaced passages containing linguistic signals or disputed regions. This is not a legal conclusion or judgment about the recording."}
          </p>
          {data.critical.map((p, i) => (
            <div key={`${p.startMs}-${i}`} className="flex gap-3 border-t border-white/[0.06] pt-3 first:border-0 first:pt-0">
              <span className="shrink-0 font-mono text-[11px] text-amber-300" dir="ltr">{fmtTime(p.startMs)}</span>
              <p className="bidi-auto text-sm leading-6 text-slate-300" dir="auto">{p.text}</p>
            </div>
          ))}
        </Card>
      )}

      <p className="px-1 text-center text-[11px] leading-5 text-slate-500">
        {rtl
          ? "الملخص مشتق من النص الحالي. عند أي تعارض، التسجيل الصوتي الأصلي هو المرجع الحاكم."
          : "This summary is derived from the current transcript. If anything conflicts, the original audio recording controls."}
      </p>
    </div>
  );
}
