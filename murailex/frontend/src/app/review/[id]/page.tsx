"use client";

import { Check, Play } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { PlayerBar, PlayerProvider, usePlayer } from "@/components/player";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { fmtTime, textDir } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Dispute, Recording } from "@/lib/types";

const CONTEXT_MS = 3000;

function MiniWave({ peaks, start, end }: { peaks: number[] | null; start: number; end: number }) {
  if (!peaks) return <div className="h-12" />;
  const pps = 50;
  const from = Math.max(0, Math.floor(((start - CONTEXT_MS) / 1000) * pps));
  const to = Math.min(peaks.length, Math.ceil(((end + CONTEXT_MS) / 1000) * pps));
  const slice = peaks.slice(from, to);
  const max = Math.max(0.05, ...slice);
  const w = Math.max(1, slice.length);
  const hs = ((start / 1000) * pps - from) / w;
  const he = ((end / 1000) * pps - from) / w;
  return (
    <svg viewBox={`0 0 ${w} 40`} preserveAspectRatio="none" className="h-12 w-full" style={{ direction: "ltr" }} aria-hidden>
      <rect x={hs * w} width={Math.max(0.5, (he - hs) * w)} y={0} height={40} fill="rgba(245,185,70,0.18)" />
      {slice.map((p, i) => {
        const h = Math.max(0.6, (p / max) * 38);
        return <rect key={i} x={i} y={20 - h / 2} width={0.7} height={h} fill={i / w >= hs && i / w <= he ? "#a3aeff" : "#364056"} />;
      })}
    </svg>
  );
}

function DisputeCard({ d, peaks, speakerLabel, onResolved }: { d: Dispute; peaks: number[] | null; speakerLabel: string; onResolved: () => void }) {
  const { t } = useI18n();
  const player = usePlayer();
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function resolve(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/disputes/${d.id}/resolve`, { method: "POST", json: body });
      onResolved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  const reasons = d.reasons.map((r) => r.replace("risk:", ""));
  return (
    <Card id={`d-${d.id}`} className="space-y-4 scroll-mt-40" data-testid="dispute-card">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono text-primary-text" dir="ltr">
          {fmtTime(d.start_ms, true)} – {fmtTime(d.end_ms, true)}
        </span>
        {speakerLabel && <bdi className="font-medium text-fg">{speakerLabel}</bdi>}
        {d.status === "resolved" && <Badge tone="ok"><Check className="size-3" /> {t("resolved")}</Badge>}
        <div className="flex flex-wrap gap-1">
          {reasons.map((r) => (
            <Badge key={r} tone={["engine_disagreement", "low_confidence", "overlap", "single_engine_token"].includes(r) ? "danger" : "warn"}>{r}</Badge>
          ))}
        </div>
      </div>

      <button className="block w-full rounded-lg border border-line bg-surface-2/50 px-2" aria-label={t("play_region")} onClick={() => { player.highlight(d.start_ms, d.end_ms); player.playWindow(Math.max(0, d.start_ms - CONTEXT_MS), d.end_ms + CONTEXT_MS); }}>
        <MiniWave peaks={peaks} start={d.start_ms} end={d.end_ms} />
      </button>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => { player.highlight(d.start_ms, d.end_ms); player.playWindow(d.start_ms, d.end_ms, 1); }} data-testid="play-exact">
          <Play /> {t("play_exact")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => player.playWindow(Math.max(0, d.start_ms - CONTEXT_MS), d.end_ms + CONTEXT_MS, 1)}>
          <Play /> {t("play_region")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => player.playWindow(Math.max(0, d.start_ms - CONTEXT_MS), d.end_ms + CONTEXT_MS, 0.6)}>
          {t("slow")} 0.6×
        </Button>
        <Button size="sm" variant="ghost" onClick={() => player.setRate(1)}>
          {t("normal")}
        </Button>
      </div>

      <div className="space-y-2">
        <div className="eyebrow">{t("candidates")}</div>
        {d.candidates.map((c, i) => (
          <div key={`${c.provider}-${i}`} className="flex flex-wrap items-start gap-3 rounded-lg border border-line bg-surface-2/50 p-3 sm:flex-nowrap">
            <div className="min-w-0 flex-1">
              <p className="bidi-auto text-[17px] leading-8" dir={textDir(c.text)}>
                {c.text ? <bdi className="text-fg">{c.text}</bdi> : <span className="text-sm text-fg-subtle">∅</span>}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-fg-subtle" dir="ltr">
                <span>{c.provider} · {c.model}</span>
                <span>{c.role === "verification_asr" ? "verification" : "primary"}</span>
                {c.mean_confidence != null && <span>{t("confidence")} {c.mean_confidence.toFixed(2)} (min {c.min_confidence?.toFixed(2)})</span>}
                {c.agrees_with.length > 0 ? <span className="text-ok">{t("agrees_with")} {c.agrees_with.join(", ")}</span> : <span className="text-danger">no agreement</span>}
              </div>
            </div>
            {d.status === "open" && c.text && (
              <Button size="sm" variant="subtle" disabled={busy} onClick={() => resolve({ action: "accept_candidate", candidate_index: i })} data-testid="accept-candidate">
                {t("accept_candidate")}
              </Button>
            )}
          </div>
        ))}
      </div>

      {d.status === "open" ? (
        <div className="space-y-3">
          {typing ? (
            <div className="space-y-2">
              <Textarea dir="auto" className="bidi-auto" value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder={t("type_exact")} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setTyping(false)}>{t("cancel")}</Button>
                <Button size="sm" disabled={!text.trim() || busy} onClick={() => resolve({ action: "type_exact", text })}>{t("save")}</Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Button size="sm" variant="secondary" onClick={() => setTyping(true)} className="col-span-2 sm:col-span-1">{t("type_exact")}</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve({ action: "mark_inaudible" })} data-testid="mark-inaudible">[غير مسموع]</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve({ action: "mark_unclear_name" })}>[اسم غير واضح]</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve({ action: "mark_unclear_number" })}>[رقم غير واضح]</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve({ action: "mark_overlap" })}>[تداخل]</Button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-fg" dir="auto">
          <span className="text-fg-muted">{d.resolution?.action}: </span>
          <bdi>{d.resolution?.text}</bdi> <span className="text-xs text-fg-subtle">— {d.resolution?.by}</span>
        </p>
      )}
      {err && <Notice tone="danger" role="alert">{err}</Notice>}
    </Card>
  );
}

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const [rec, setRec] = useState<Recording | null>(null);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [speakers, setSpeakers] = useState<Record<string, { label: string }>>({});

  const load = useCallback(async () => {
    const [r, d, tr] = await Promise.all([
      api<{ recording: Recording }>(`/api/recordings/${id}`),
      api<{ disputes: Dispute[] }>(`/api/recordings/${id}/disputes`),
      api<{ revision: { content?: { speakers: Record<string, { label: string }> } } | null }>(`/api/recordings/${id}/transcript`),
    ]);
    setRec(r.recording);
    setDisputes(d.disputes);
    setSpeakers(tr.revision?.content?.speakers ?? {});
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load().catch(() => undefined);
    api<{ peaks: number[] }>(`/api/recordings/${id}/peaks`).then((p) => setPeaks(p.peaks)).catch(() => setPeaks(null));
  }, [id, load]);

  if (!rec)
    return (
      <div className="space-y-5" role="status" aria-label="Loading">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-36 w-full rounded-2xl" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    );
  const open = disputes.filter((d) => d.status === "open");
  const shown = showResolved ? disputes : open;
  return (
    <PlayerProvider recordingId={id} durationHint={rec.duration_ms}>
      <div className="space-y-5 fade-in">
        <PageHeader
          title={rec.title}
          back={`/transcriptions/${id}`}
          actions={<Badge tone={open.length ? "warn" : "ok"} data-testid="open-count">{open.length} {t("open_regions")}</Badge>}
        />
        <div className="sticky top-16 z-20 lg:top-2"><PlayerBar /></div>
        <div className="flex items-center justify-between">
          <Checkbox label={t("show_resolved")} checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          {open.length === 0 && (
            <Button asChild size="sm"><Link href={`/transcriptions/${id}`}>{t("lock")}</Link></Button>
          )}
        </div>
        {shown.length === 0 && <p className="py-10 text-center text-sm text-fg-muted">{t("no_open_regions")}</p>}
        {shown.map((d) => (
          <DisputeCard key={d.id} d={d} peaks={peaks} speakerLabel={d.speaker ? speakers[d.speaker]?.label ?? d.speaker : ""} onResolved={load} />
        ))}
        <p className="text-center text-xs text-fg-subtle">{t("controlling")}</p>
      </div>
    </PlayerProvider>
  );
}
