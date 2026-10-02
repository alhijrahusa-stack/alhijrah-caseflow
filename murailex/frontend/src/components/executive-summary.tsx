"use client";

import { AlertTriangle, Check, Clock3, Copy, FileText, ShieldCheck, Users } from "lucide-react";
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
    <div className="space-y-4 fade-in">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow">MURAILEX</div>
            <h2 className="mt-1 text-lg font-semibold text-fg">{rtl ? "الملخص التنفيذي" : "Executive Summary"}</h2>
          </div>
          <Button variant="secondary" size="sm" onClick={copySummary}>
            {copied ? <Check /> : <Copy />} {copied ? (rtl ? "تم النسخ" : "Copied") : (rtl ? "نسخ الملخص" : "Copy summary")}
          </Button>
        </div>
        <p className="mt-3 text-[15px] leading-7 text-fg-muted">{data.overview}</p>
      </Card>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { icon: Users, value: data.speakers, label: rtl ? "متحدثون" : "Speakers", tone: "text-primary-text" },
          { icon: FileText, value: data.wordCount.toLocaleString(), label: rtl ? "كلمة" : "Words", tone: "text-primary-text" },
          { icon: AlertTriangle, value: data.unresolved, label: rtl ? "غير محسوم" : "Unresolved", tone: data.unresolved ? "text-warn" : "text-ok" },
        ].map(({ icon: Icon, value, label, tone }) => (
          <Card key={label} className="p-3.5 sm:p-4">
            <Icon className={`mb-2 size-4 ${tone}`} aria-hidden />
            <div className="text-xl font-semibold tabular-nums text-fg">{value}</div>
            <div className="mt-0.5 text-xs text-fg-subtle">{label}</div>
          </Card>
        ))}
      </div>

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary-text" aria-hidden />
          <h3 className="text-[15px] font-semibold text-fg">{rtl ? "النقاط الرئيسية" : "Key Points"}</h3>
        </div>
        <div className="space-y-2">
          {data.keyPoints.map((p, i) => (
            <div key={`${p.startMs}-${i}`} className="rounded-lg border border-line bg-surface-2/50 p-3.5">
              <div className="mb-1 flex items-center gap-2 text-xs">
                <Clock3 className="size-3.5 text-fg-subtle" aria-hidden />
                <span className="font-mono text-primary-text" dir="ltr">{fmtTime(p.startMs)}</span>
                {p.label && <span className="text-fg-subtle"><bdi>{p.label}</bdi></span>}
              </div>
              <p className="bidi-auto text-[15px] leading-7 text-fg" dir="auto">{p.text}</p>
            </div>
          ))}
        </div>
      </Card>

      {data.critical.length > 0 && (
        <Card tone="warn" className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-warn" aria-hidden />
            <h3 className="text-[15px] font-semibold text-fg">{rtl ? "مقاطع تستحق المراجعة" : "Review-worthy moments"}</h3>
          </div>
          <p className="text-xs leading-5 text-fg-muted">
            {rtl
              ? "اختيار آلي لمواضع تحتوي مؤشرات لغوية أو مناطق متنازعاً عليها. لا يمثل استنتاجاً قانونياً ولا حكماً على محتوى التسجيل."
              : "Automatically surfaced passages containing linguistic signals or disputed regions. This is not a legal conclusion or judgment about the recording."}
          </p>
          {data.critical.map((p, i) => (
            <div key={`${p.startMs}-${i}`} className="flex gap-3 border-t border-line pt-3 first:border-0 first:pt-0">
              <span className="shrink-0 font-mono text-xs text-warn" dir="ltr">{fmtTime(p.startMs)}</span>
              <p className="bidi-auto text-sm leading-6 text-fg" dir="auto">{p.text}</p>
            </div>
          ))}
        </Card>
      )}

      <p className="px-1 text-center text-xs leading-5 text-fg-subtle">
        {rtl
          ? "الملخص مشتق من النص الحالي. عند أي تعارض، التسجيل الصوتي الأصلي هو المرجع الحاكم."
          : "This summary is derived from the current transcript. If anything conflicts, the original audio recording controls."}
      </p>
    </div>
  );
}
