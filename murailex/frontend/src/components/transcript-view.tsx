"use client";

import { AlertTriangle, Check, Copy, FileText, Pencil, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { usePlayer } from "@/components/player";
import { SummaryPanel } from "@/components/summary-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { api, ApiError } from "@/lib/api";
import { fmtTime, textDir } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Content, Item, Segment } from "@/lib/types";
import { cn } from "@/lib/utils";

const MARKERS = new Set(["[غير مسموع]", "[اسم غير واضح]", "[رقم غير واضح]", "[تداخل]", "[صمت]"]);
// Each speaker colour meets ≥ 4.5:1 contrast on every surface token.
const SPEAKER_COLORS = ["#E9CB8A", "#22D3EE", "#34D399", "#C4B5FD", "#F472B6", "#A3AEFF"];

export function segmentText(seg: Segment): string {
  return seg.items.map((i) => (i.kind === "dispute" ? "" : i.text)).filter(Boolean).join(" ");
}

function Token({ item, recordingId, onSeek, query }: { item: Item; recordingId: string; onSeek: (ms: number) => void; query: string }) {
  const { t } = useI18n();
  if (item.kind === "dispute") {
    // The span stays explicitly unresolved and is not part of the canonical text. What the
    // primary engine heard is shown in place, marked, so the record reads continuously
    // instead of breaking into gaps; resolving it is one click away.
    const primary = (item.provenance ?? []).find((p) => (p as { role?: string }).role === "primary_asr") as
      | { text?: string }
      | undefined;
    const heard = (primary?.text ?? "").trim();
    return (
      <Link
        href={`/review/${recordingId}#d-${item.dispute_id}`}
        title={t("disputed")}
        className="mx-0.5 inline items-baseline rounded-sm bg-danger/10 px-0.5 align-baseline text-danger decoration-danger/70 decoration-dotted underline-offset-4 hover:bg-danger/20"
        data-testid="dispute-chip"
      >
        <AlertTriangle className="mb-0.5 inline size-3" />{" "}
        {heard ? <bdi className="underline decoration-danger/70 decoration-dotted underline-offset-4">{heard}</bdi> : <span className="text-[13px] font-medium">{t("disputed")}</span>}
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
        title={risky ? item.risks.join(", ") : item.evidence_state === "LOW_CONFIDENCE" ? "LOW_CONFIDENCE — not confirmed by the independent verifier" : undefined}
        className={cn(
          "cursor-pointer rounded-sm transition-colors duration-150 hover:bg-primary/15",
          isMarker && "mx-0.5 rounded-md border border-line-strong bg-surface-3 px-1.5 text-[0.92em] text-fg-muted",
          risky && !isMarker && "underline decoration-warn/80 decoration-dotted underline-offset-4",
          item.evidence_state === "LOW_CONFIDENCE" && !risky && "text-fg-muted underline decoration-fg-subtle/60 decoration-dotted underline-offset-[6px]",
          item.source === "human" && "decoration-primary-text",
          highlighted && "bg-warn/25 text-fg",
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
  revision,
}: {
  recordingId: string;
  revision?: { id: string; status: string; number: number };
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
  const [view, setView] = useState<"summary" | "transcript">("transcript");
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
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-surface-2 p-1">
        <button
          type="button"
          aria-pressed={view === "summary"}
          onClick={() => setView("summary")}
          className={cn(
            "flex h-10 items-center justify-center gap-2 rounded-md text-sm font-semibold transition-colors duration-150",
            view === "summary" ? "bg-surface-3 text-fg shadow-card" : "text-fg-muted hover:text-fg",
          )}
        >
          <Sparkles className="size-4" /> {rtl ? "الملخص" : "Summary"}
        </button>
        <button
          type="button"
          aria-pressed={view === "transcript"}
          onClick={() => setView("transcript")}
          className={cn(
            "flex h-10 items-center justify-center gap-2 rounded-md text-sm font-semibold transition-colors duration-150",
            view === "transcript" ? "bg-surface-3 text-fg shadow-card" : "text-fg-muted hover:text-fg",
          )}
        >
          <FileText className="size-4" /> {rtl ? "النص الكامل" : "Transcript"}
        </button>
      </div>

      {view === "summary" ? (
        revision ? (
          <SummaryPanel recordingId={recordingId} revision={revision} rtl={rtl} onSeek={(ms) => player.seek(ms, true)} />
        ) : null
      ) : (
        <div className="fade-in space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-fg-subtle" aria-label={rtl ? "دليل حالات الأدلة" : "Evidence state legend"}>
              <li className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-ok" aria-hidden />{rtl ? "مؤكَّد بمحرك مستقل" : "Confirmed by independent engine"}</li>
              <li className="inline-flex items-center gap-1.5"><span className="text-fg-muted underline decoration-fg-subtle/60 decoration-dotted underline-offset-4">{rtl ? "كلمة" : "word"}</span>{rtl ? "ثقة منخفضة" : "Low confidence"}</li>
              <li className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-danger" aria-hidden />{rtl ? "متنازع عليه — مراجعة" : "Disputed — review"}</li>
            </ul>
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
                    "group relative overflow-hidden rounded-lg border px-3.5 py-3 transition-colors duration-150 sm:px-4",
                    active ? "border-primary/50 bg-primary/10" : "border-line bg-surface-2/40 hover:border-line-strong hover:bg-surface-2",
                  )}
                  data-testid="segment"
                >
                  <span className="absolute inset-y-3 start-0 w-[3px] rounded-full" style={{ background: color }} aria-hidden />
                  <div className="mb-1.5 flex items-center gap-2 text-xs">
                    <button className="font-mono tabular-nums text-primary-text hover:underline" dir="ltr" onClick={() => {
                        player.highlight(seg.start_ms, seg.end_ms);
                        player.seek(seg.start_ms, true);
                      }}>
                      {fmtTime(seg.start_ms)}
                    </button>
                    {label && (
                      <button
                        className={cn("font-semibold", editable ? "hover:underline" : "cursor-default")}
                        style={{ color }}
                        onClick={() => editable && setSpeakerFor(seg)}
                        disabled={!editable}
                        data-testid="speaker-label"
                      >
                        <bdi>{label}</bdi>
                        {info?.verified_name && <span className="ms-1 text-fg-subtle">(<bdi>{info.verified_name}</bdi> ✓)</span>}
                      </button>
                    )}
                    {editable && !hasDispute && (
                      <button
                        className="ms-auto rounded-md p-1.5 text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
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
                  <p className="bidi-auto text-[17px] leading-8 text-fg" dir={textDir(text || label)}>
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
          <p className="mb-3 text-xs text-fg-muted">{t("controlling")}</p>
          {editing && (
            <Button variant="secondary" size="sm" className="mb-3" onClick={() => player.playWindow(editing.start_ms, editing.end_ms)}>
              {t("play_exact")} · {fmtTime(editing.start_ms)}
            </Button>
          )}
          <Textarea dir="auto" className="bidi-auto" value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} />
          {error && <Notice tone="danger" role="alert" className="mt-2">{error}</Notice>}
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
                {info.verified_name && <span className="text-fg-subtle">({info.verified_name})</span>}
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
    if (!speaker) return "#8B96AA";
    const idx = Math.max(0, keys.indexOf(speaker));
    return SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
  };
}
