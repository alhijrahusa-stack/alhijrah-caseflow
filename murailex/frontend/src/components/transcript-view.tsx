"use client";

import { AlertTriangle, Pencil, UserRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { usePlayer } from "@/components/player";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { fmtTime, textDir } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Content, Item, Segment } from "@/lib/types";
import { cn } from "@/lib/utils";

const MARKERS = new Set(["[غير مسموع]", "[اسم غير واضح]", "[رقم غير واضح]", "[تداخل]", "[صمت]"]);

export function segmentText(seg: Segment): string {
  return seg.items.map((i) => (i.kind === "dispute" ? "" : i.text)).filter(Boolean).join(" ");
}

function Token({ item, recordingId, onSeek }: { item: Item; recordingId: string; onSeek: (ms: number) => void }) {
  const { t } = useI18n();
  if (item.kind === "dispute") {
    return (
      <Link
        href={`/review/${recordingId}#d-${item.dispute_id}`}
        className="mx-0.5 inline-flex items-center gap-1 rounded-lg bg-rose-100 px-1.5 py-0.5 align-baseline text-[13px] text-rose-700 dark:bg-rose-500/15 dark:text-rose-200"
        data-testid="dispute-chip"
      >
        <AlertTriangle className="size-3" /> {t("disputed")}
      </Link>
    );
  }
  const isMarker = item.kind === "marker" || MARKERS.has(item.text);
  const risky = item.risks?.length > 0;
  return (
    <>
      <span
        role="button"
        tabIndex={-1}
        onClick={() => onSeek(item.start_ms)}
        title={risky ? item.risks.join(", ") : undefined}
        className={cn(
          "cursor-pointer rounded-md transition-colors hover:bg-accent-100/70 dark:hover:bg-accent-500/15",
          isMarker && "mx-0.5 rounded-lg bg-black/[0.05] px-1.5 text-[0.92em] muted dark:bg-white/[0.07]",
          risky && !isMarker && "underline decoration-amber-400/80 decoration-dotted underline-offset-4",
          item.source === "human" && "decoration-accent-400",
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
  const { t } = useI18n();
  const player = usePlayer();
  const [editing, setEditing] = useState<Segment | null>(null);
  const [draft, setDraft] = useState("");
  const [speakerFor, setSpeakerFor] = useState<Segment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const segments = useMemo(() => {
    const q = query.trim().toLowerCase();
    return content.segments.filter(
      (s) => (!speakerFilter || s.speaker === speakerFilter) && (!q || segmentText(s).toLowerCase().includes(q)),
    );
  }, [content.segments, query, speakerFilter]);

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

  return (
    <div className="space-y-1.5" data-testid="transcript">
      {segments.map((seg) => {
        const active = player.timeMs >= seg.start_ms && player.timeMs < seg.end_ms + 200;
        const info = seg.speaker ? content.speakers[seg.speaker] : null;
        const label = info?.label ?? (seg.speaker ? `[المتحدث ${seg.speaker.slice(1)}]` : "");
        const text = segmentText(seg);
        const hasDispute = seg.items.some((i) => i.kind === "dispute");
        return (
          <article
            key={seg.id}
            id={seg.id}
            className={cn(
              "group rounded-2xl px-3 py-3 transition-colors sm:px-4",
              active ? "bg-accent-50/90 ring-1 ring-accent-200 dark:bg-accent-500/10 dark:ring-accent-500/30" : "hover:bg-white/50 dark:hover:bg-white/[0.03]",
            )}
            data-testid="segment"
          >
            <div className="mb-1 flex items-center gap-2 text-xs">
              <button className="font-mono tabular-nums text-accent-600 hover:underline dark:text-accent-300" dir="ltr" onClick={() => player.seek(seg.start_ms, true)}>
                {fmtTime(seg.start_ms)}
              </button>
              {label && (
                <button
                  className={cn("font-medium", editable ? "hover:text-accent-600" : "cursor-default")}
                  onClick={() => editable && setSpeakerFor(seg)}
                  disabled={!editable}
                  data-testid="speaker-label"
                >
                  <bdi>{label}</bdi>
                  {info?.verified_name && (
                    <span className="muted ms-1">
                      (<bdi>{info.verified_name}</bdi> ✓)
                    </span>
                  )}
                </button>
              )}
              {editable && !hasDispute && (
                <button
                  className="ms-auto rounded-lg p-1 opacity-60 hover:bg-black/5 hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 dark:hover:bg-white/10"
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
            <p className="bidi-auto text-[17px] leading-8" dir={textDir(text || label)}>
              {seg.items.map((it, i) => (
                <Token key={i} item={it} recordingId={recordingId} onSeek={(ms) => player.seek(ms, true)} />
              ))}
            </p>
          </article>
        );
      })}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title={t("type_exact")}>
          <p className="muted mb-3 text-xs">{t("controlling")}</p>
          {editing && (
            <Button variant="secondary" size="sm" className="mb-3" onClick={() => player.playWindow(editing.start_ms, editing.end_ms)}>
              {t("play_exact")} · {fmtTime(editing.start_ms)}
            </Button>
          )}
          <Textarea dir="auto" className="bidi-auto" value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} />
          {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t("cancel")}
            </Button>
            <Button onClick={saveText} disabled={!draft.trim()}>
              {t("save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!speakerFor} onOpenChange={(o) => !o && setSpeakerFor(null)}>
        <DialogContent title={t("change_speaker")}>
          <div className="grid gap-2">
            {Object.entries(content.speakers).map(([sid, info]) => (
              <Button key={sid} variant={speakerFor?.speaker === sid ? "default" : "secondary"} onClick={() => setSpeaker(sid)} className="justify-start">
                <UserRound /> <bdi>{info.label}</bdi>
                {info.verified_name && <span className="muted">({info.verified_name})</span>}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
