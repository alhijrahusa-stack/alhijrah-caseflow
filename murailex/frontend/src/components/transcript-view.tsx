"use client";

import { AlertTriangle, Check, Copy, FileText, Pencil, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ExecutiveSummary } from "@/components/executive-summary";
import { usePlayer } from "@/components/player";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { fmtTime, textDir } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Content, Item, Recording, Segment } from "@/lib/types";
import { cn } from "@/lib/utils";

const MARKERS = new Set(["[غير مسموع]", "[اسم غير واضح]", "[رقم غير واضح]", "[تداخل]", "[صمت]"]);
const SPEAKER_COLORS = ["#818CF8", "#22D3EE", "#10B981", "#F59E0B", "#F472B6", "#A78BFA"];

export function segmentText(seg: Segment): string {
  return seg.items.map((i) => (i.kind === "dispute" ? "" : i.text)).filter(Boolean).join(" ");
}

function Token({ item, recordingId, onSeek, query }: { item: Item; recordingId: string; onSeek: (ms: number) => void; query: string }) {
  const { t } = useI18n();
  if (item.kind === "dispute") {
    return (
      <Link
        href={`/review/${recordingId}#d-${item.dispute_id}`}
        className="mx-0.5 inline-flex items-center gap-1 rounded-lg border border-rose-400/15 bg-rose-400/10 px-1.5 py-0.5 align-baseline text-[13px] text-rose-200"
        data-testid="dispute-chip"
      >
        <AlertTriangle className="size-3" /> {t("disputed")}
      </Link>
    );
  }
  const isMarker = item.kind === "marker" || MARKERS.has(item.text);
  const risky = item.risks?.length > 0;
  const highlighted = query.trim() && item.text.toLowerCase().includes(query.trim().toLowerCase());
  return (
    <>
      <span
        role="button"
        tabIndex={-1}
        onClick={() => onSeek(item.start_ms)}
        title={risky ? item.risks.join(", ") : undefined}
        className={cn(
          "cursor-pointer rounded-md transition-colors duration-150 hover:bg-indigo-400/10",
          isMarker && "mx-0.5 rounded-lg border border-white/[0.06] bg-white/[0.045] px-1.5 text-[0.92em] text-slate-400",
          risky && !isMarker && "underline decoration-amber-400/80 decoration-dotted underline-offset-4",
          item.source === "human" && "decoration-indigo-400",
          highlighted && "bg-indigo-400/20 text-white shadow-[0_0_18px_rgba(99,102,241,.18)]",
        )}
      >
        <bdi>{item.text}</bdi>
      </span>{" "}
    </>
  );
}

export function TranscriptView({
  recordingId,
  content,
  editable,
  query,
  speakerFilter,
  onChanged,
}: {
  recordingId: string;
  content: Content;
  editable: boolean;
  query: string;
  speakerFilter: string | null;
  onChanged: () => void;
}) {
  const { t, dir } = useI18n();
  const rtl = dir === "rtl";
  const player = usePlayer();
  const [editing, setEditing] = useState<Segment | null>(null);
  const [draft, setDraft] = useState("");
  const [speakerFor, setSpeakerFor] = useState<Segment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"summary" | "transcript">("summary");
  const [copied, setCopied] = useState(false);

  const segments = useMemo(() => {
    const q = query.trim().toLowerCase();
    return content.segments.filter(
      (s) => (!speakerFilter || s.speaker === speakerFilter) && (!q || segmentText(s).toLowerCase().includes(q)),
    );
  }, [content.segments, query, speakerFilter]);

  const speakerColor = useCallbackSpeakerColor(content);

  async function saveText() {
    if (!editing) return;
    setError(null);
    try {
      await api(`/api/recordings/${recordingId}/segments/${editing.id}/text`, { method: "POST", json: { text: draft } });
      setEditing(null);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("error"));
    }
  }

  async function setSpeaker(sid: string) {
    if (!speakerFor) return;
    try {
      await api(`/api/recordings/${recordingId}/segments/${speakerFor.id}/speaker`, { method: "POST", json: { speaker: sid } });
      setSpeakerFor(null);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("error"));
    }
  }

  async function copyTranscript() {
    const lines: string[] = [];
    for (const seg of content.segments) {
      const text = segmentText(seg).trim();
      if (!text) continue;
      const info = seg.speaker ? content.speakers[seg.speaker] : null;
      const label = info?.verified_name || info?.label || (seg.speaker ? `[المتحدث ${seg.speaker.slice(1)}]` : "");
      lines.push(`[${fmtTime(seg.start_ms)}] ${label}`.trim(), text, "");
    }
    lines.push(rtl ? "التسجيل الصوتي الأصلي هو المرجع الحاكم." : "The original audio recording is the controlling source.");
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="transcript">
      <div className="glass-strong grid grid-cols-2 rounded-[18px] p-1.5">
        <button
          type="button"
          onClick={() => setView("summary")}
          className={cn(
            "flex h-11 items-center justify-center gap-2 rounded-[14px] text-sm font-semibold transition-all duration-200",
            view === "summary" ? "summary-tab bg-white/[0.075] text-white shadow-[0_10px_30px_-20px_rgba(99,102,241,.8)]" : "text-slate-500 hover:text-slate-300",
          )}
        >
          <Sparkles className="size-4" /> {rtl ? "الملخص" : "Summary"}
        </button>
        <button
          type="button"
          onClick={() => setView("transcript")}
          className={cn(
            "flex h-11 items-center justify-center gap-2 rounded-[14px] text-sm font-semibold transition-all duration-200",
            view === "transcript" ? "summary-tab bg-white/[0.075] text-white shadow-[0_10px_30px_-20px_rgba(99,102,241,.8)]" : "text-slate-500 hover:text-slate-300",
          )}
        >
          <FileText className="size-4" /> {rtl ? "النص الكامل" : "Transcript"}
        </button>
      </div>

      {view === "summary" ? (
        <ExecutiveSummary
          content={content}
          recording={{ duration_ms: content.recording.duration_ms } as Recording}
          rtl={rtl}
        />
      ) : (
        <div className="float-in space-y-3">
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" onClick={copyTranscript}>
              {copied ? <Check /> : <Copy />} {copied ? (rtl ? "تم النسخ" : "Copied") : (rtl ? "نسخ النص" : "Copy transcript")}
            </Button>
          </div>

          <div className="space-y-2">
            {segments.map((seg) => {
              const active = player.timeMs >= seg.start_ms && player.timeMs < seg.end_ms + 200;
              const info = seg.speaker ? content.speakers[seg.speaker] : null;
              const label = info?.label ?? (seg.speaker ? `[المتحدث ${seg.speaker.slice(1)}]` : "");
              const text = segmentText(seg);
              const hasDispute = seg.items.some((i) => i.kind === "dispute");
              const color = speakerColor(seg.speaker);
              return (
                <article
                  key={seg.id}
                  id={seg.id}
                  className={cn(
                    "group relative overflow-hidden rounded-[18px] border px-3.5 py-3.5 transition-all duration-200 sm:px-4",
                    active
                      ? "border-indigo-400/25 bg-indigo-400/[0.085] shadow-[0_12px_38px_-24px_rgba(99,102,241,.75)]"
                      : "border-white/[0.055] bg-white/[0.018] hover:border-white/[0.10] hover:bg-white/[0.035]",
                  )}
                  data-testid="segment"
                >
                  <span className="absolute inset-y-3 start-0 w-[2px] rounded-full" style={{ background: color, boxShadow: active ? `0 0 16px ${color}` : undefined }} />
                  <div className="mb-1.5 flex items-center gap-2 text-xs">
                    <button className="font-mono tabular-nums text-indigo-300 hover:text-indigo-200 hover:underline" dir="ltr" onClick={() => player.seek(seg.start_ms, true)}>
                      {fmtTime(seg.start_ms)}
                    </button>
                    {label && (
                      <button
                        className={cn("font-semibold", editable ? "hover:text-indigo-300" : "cursor-default")}
                        style={{ color }}
                        onClick={() => editable && setSpeakerFor(seg)}
                        disabled={!editable}
                        data-testid="speaker-label"
                      >
                        <bdi>{label}</bdi>
                        {info?.verified_name && <span className="ms-1 text-slate-500">(<bdi>{info.verified_name}</bdi> ✓)</span>}
                      </button>
                    )}
                    {editable && !hasDispute && (
                      <button
                        className="ms-auto rounded-lg p-1 text-slate-500 opacity-70 transition hover:bg-white/[0.06] hover:text-slate-200 sm:opacity-0 sm:group-hover:opacity-100"
                        onClick={() => {
                          setDraft(text);
                          setEditing(seg);
                        }}
                        aria-label={t("edit")}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="bidi-auto text-[17px] leading-8 text-slate-200" dir={textDir(text || label)}>
                    {seg.items.map((it, i) => (
                      <Token key={i} item={it} recordingId={recordingId} onSeek={(ms) => player.seek(ms, true)} query={query} />
                    ))}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title={t("type_exact")}>
          <p className="muted mb-3 text-xs">{t("controlling")}</p>
          {editing && (
            <Button variant="secondary" size="sm" className="mb-3" onClick={() => player.playWindow(editing.start_ms, editing.end_ms)}>
              {t("play_exact")} · {fmtTime(editing.start_ms)}
            </Button>
          )}
          <Textarea dir="auto" className="bidi-auto" value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} />
          {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>{t("cancel")}</Button>
            <Button onClick={saveText} disabled={!draft.trim()}>{t("save")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!speakerFor} onOpenChange={(o) => !o && setSpeakerFor(null)}>
        <DialogContent title={t("change_speaker")}>
          <div className="grid gap-2">
            {Object.entries(content.speakers).map(([sid, info]) => (
              <Button key={sid} variant={speakerFor?.speaker === sid ? "default" : "secondary"} onClick={() => setSpeaker(sid)} className="justify-start">
                <UserRound /> <bdi>{info.label}</bdi>
                {info.verified_name && <span className="text-slate-500">({info.verified_name})</span>}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function useCallbackSpeakerColor(content: Content) {
  const keys = useMemo(() => Object.keys(content.speakers), [content.speakers]);
  return (speaker: string | null) => {
    if (!speaker) return "#64748B";
    const idx = Math.max(0, keys.indexOf(speaker));
    return SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
  };
}
