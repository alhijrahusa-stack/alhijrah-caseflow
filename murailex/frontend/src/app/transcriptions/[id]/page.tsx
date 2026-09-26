"use client";

import { ArrowLeft, ArrowRight, Copy, Download, FileLock2, ListChecks, RefreshCcw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { PlayerBar, PlayerProvider } from "@/components/player";
import { PROCESSING, StatusBadge } from "@/components/status";
import { TranscriptView } from "@/components/transcript-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { fmtBytes, fmtTime, shortHash, textDir } from "@/lib/format";
import { type Key, useI18n } from "@/lib/i18n";
import type { ExportInfo, ProviderRun, Recording, Revision, Translation } from "@/lib/types";

type Detail = { recording: Recording; provider_runs: ProviderRun[]; job: { status: string; last_error: string | null } | null };

function CopyHash({ value }: { value: string | null }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  if (!value) return <span className="muted">—</span>;
  return (
    <button
      className="inline-flex items-center gap-1 font-mono text-[11px] hover:text-accent-600"
      dir="ltr"
      title={value}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {shortHash(value)} <Copy className="size-3" /> {done && <span className="text-emerald-600">{t("copied")}</span>}
    </button>
  );
}

const STEPS = ["queued", "analyzing", "transcribing", "aligning", "verifying", "building"];

export default function TranscriptPage() {
  const { id } = useParams<{ id: string }>();
  const { t, dir } = useI18n();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [revision, setRevision] = useState<Revision | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [speaker, setSpeaker] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const load = useCallback(async () => {
    try {
      const d = await api<Detail>(`/api/recordings/${id}`);
      setDetail(d);
      const tr = await api<{ revision: Revision | null; revisions: Revision[] }>(
        `/api/recordings/${id}/transcript${selected ? `?revision=${selected}` : ""}`,
      );
      setRevision(tr.revision);
      setRevisions(tr.revisions);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("error"));
    }
  }, [id, selected, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount / selection change
    void load();
  }, [load]);

  const status = detail?.recording.status;
  useEffect(() => {
    if (!status || !PROCESSING.has(status)) return;
    const h = setInterval(() => void load(), 3000);
    return () => clearInterval(h);
  }, [status, load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return <div className="muted py-20 text-center text-sm">{error ?? "…"}</div>;
  }
  const rec = detail.recording;
  const content = revision?.content;
  const isLatest = revision && revisions.length > 0 && revision.id === revisions[revisions.length - 1].id;
  const editable = !!(revision && revision.status === "draft" && isLatest);
  const openDisputes = content ? content.segments.flatMap((s) => s.items).filter((i) => i.kind === "dispute").length : 0;

  return (
    <div className="space-y-5 fade-in">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label={t("back")}>
          <Link href="/transcriptions">
            <Back />
          </Link>
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold" dir="auto">
          {rec.title}
        </h1>
        <StatusBadge status={rec.status} />
      </div>

      <Card className="grid grid-cols-2 gap-3 p-4 text-xs sm:grid-cols-4">
        <div>
          <div className="muted">{t("duration")}</div>
          <div className="font-mono" dir="ltr">{fmtTime(rec.duration_ms)}</div>
        </div>
        <div>
          <div className="muted">{t("uploaded")}</div>
          <div dir="ltr">{new Date(rec.uploaded_at).toLocaleString()}</div>
        </div>
        <div>
          <div className="muted">{t("original_sha")}</div>
          <CopyHash value={rec.sha256} />
        </div>
        <div>
          <div className="muted">{t("transcript_sha")}</div>
          <CopyHash value={revision?.sha256 ?? null} />
        </div>
        <div className="col-span-2 muted sm:col-span-4" dir="auto">
          {rec.original_filename} · {rec.mime_type} · {fmtBytes(rec.byte_size)}
        </div>
      </Card>

      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}

      {PROCESSING.has(rec.status) && (
        <Card className="space-y-4">
          <CardTitle>{t("processing")}</CardTitle>
          <ol className="grid gap-2">
            {STEPS.map((s, i) => {
              const idx = STEPS.indexOf(rec.status);
              return (
                <li key={s} className="flex items-center gap-3 text-sm">
                  <span className={`size-2 rounded-full ${i < idx ? "bg-emerald-500" : i === idx ? "animate-pulse bg-accent-500" : "bg-black/10 dark:bg-white/15"}`} />
                  <span className={i === idx ? "font-medium" : "muted"}>{t(`st_${s}` as Key)}</span>
                </li>
              );
            })}
          </ol>
          {rec.status_detail && <p className="muted text-xs">{rec.status_detail}</p>}
        </Card>
      )}

      {(rec.status === "failed" || rec.status === "provider_not_configured") && (
        <Card className="space-y-3 border-rose-200">
          <p className="text-sm">{rec.status_detail}</p>
          {detail.job?.last_error && <p className="muted font-mono text-xs" dir="ltr">{detail.job.last_error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => act(() => api(`/api/recordings/${id}/reprocess`, { method: "POST" }))} disabled={busy}>
              <RefreshCcw /> {t("reprocess")}
            </Button>
            <Button asChild variant="secondary">
              <Link href="/settings#advanced">{t("advanced")}</Link>
            </Button>
          </div>
        </Card>
      )}

      {content && (
        <PlayerProvider recordingId={id} durationHint={rec.duration_ms}>
          <div className="sticky top-2 z-30">
            <PlayerBar />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {openDisputes > 0 && editable && (
              <Button asChild>
                <Link href={`/review/${id}`}>
                  <ListChecks /> {t("review_now")} · {openDisputes}
                </Link>
              </Button>
            )}
            {editable && openDisputes === 0 && (
              <Button
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t("lock_confirm"))) void act(() => api(`/api/recordings/${id}/lock`, { method: "POST" }));
                }}
                data-testid="lock"
              >
                <FileLock2 /> {t("lock")}
              </Button>
            )}
            {revision?.status === "locked" && isLatest && (
              <Button variant="secondary" disabled={busy} onClick={() => act(() => api(`/api/recordings/${id}/revisions`, { method: "POST" }))}>
                {t("new_revision")}
              </Button>
            )}
            {revisions.length > 1 && (
              <select
                className="glass rounded-2xl px-3 py-2 text-sm"
                value={revision?.id}
                onChange={(e) => setSelected(e.target.value)}
                aria-label={t("revision")}
              >
                {revisions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {t("revision")} {r.number} · {r.status === "locked" ? t("locked") : t("draft")}
                  </option>
                ))}
              </select>
            )}
            <Badge tone={revision?.status === "locked" ? "ok" : "neutral"}>
              {t("revision")} {revision?.number} · {revision?.status === "locked" ? t("locked") : t("draft")}
            </Badge>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Input placeholder={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} dir="auto" className="sm:max-w-xs" />
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant={speaker === null ? "subtle" : "ghost"} onClick={() => setSpeaker(null)}>
                {t("all_speakers")}
              </Button>
              {Object.entries(content.speakers).map(([sid, info]) => (
                <Button key={sid} size="sm" variant={speaker === sid ? "subtle" : "ghost"} onClick={() => setSpeaker(sid)}>
                  <bdi>{info.label}</bdi>
                </Button>
              ))}
            </div>
          </div>

          <Card className="p-2 sm:p-3">
            <p className="muted px-3 pt-2 text-center text-[11px] tracking-wide">
              {content.title} · {content.controlling_source}
            </p>
            <TranscriptView recordingId={id} content={content} editable={editable} query={query} speakerFilter={speaker} onChanged={load} />
          </Card>

          {editable && <SpeakerPanel recordingId={id} speakers={content.speakers} onChanged={load} />}
          {revision?.status === "locked" && <ExportPanel recordingId={id} revisionId={revision.id} />}
          {revision?.status === "locked" && <TranslationPanel recordingId={id} />}
        </PlayerProvider>
      )}

      <RunsPanel runs={detail.provider_runs} />
    </div>
  );
}

function SpeakerPanel({ recordingId, speakers, onChanged }: { recordingId: string; speakers: NonNullable<Revision["content"]>["speakers"]; onChanged: () => void }) {
  const { t } = useI18n();
  const [names, setNames] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);
  async function verify(sid: string) {
    try {
      await api(`/api/recordings/${recordingId}/speakers/${sid}/verify`, {
        method: "POST",
        json: { name: names[sid] ?? "", confirm_human_verification: !!confirm[sid] },
      });
      onChanged();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : t("error"));
    }
  }
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <CardTitle>{t("speaker")}</CardTitle>
        <Button size="sm" variant="secondary" onClick={async () => { await api(`/api/recordings/${recordingId}/speakers`, { method: "POST" }); onChanged(); }}>
          {t("add_speaker")}
        </Button>
      </div>
      {Object.entries(speakers).map(([sid, info]) => (
        <div key={sid} className="grid gap-2 rounded-2xl border hairline p-3 sm:grid-cols-[8rem_1fr_auto] sm:items-center">
          <bdi className="text-sm font-medium">{info.label}</bdi>
          <div className="space-y-1.5">
            <Input
              placeholder={info.verified_name ?? t("verify_name")}
              value={names[sid] ?? ""}
              onChange={(e) => setNames({ ...names, [sid]: e.target.value })}
              dir="auto"
            />
            <label className="flex items-center gap-2 text-xs muted">
              <input type="checkbox" checked={!!confirm[sid]} onChange={(e) => setConfirm({ ...confirm, [sid]: e.target.checked })} />
              {t("verify_confirm")}
            </label>
          </div>
          <Button size="sm" onClick={() => verify(sid)} disabled={!!names[sid] && !confirm[sid]}>
            {t("save")}
          </Button>
        </div>
      ))}
      {msg && <p className="text-sm text-rose-600">{msg}</p>}
    </Card>
  );
}

function ExportPanel({ recordingId, revisionId }: { recordingId: string; revisionId: string }) {
  const { t } = useI18n();
  const [last, setLast] = useState<ExportInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function run(format: string) {
    setBusy(format);
    setErr(null);
    try {
      const r = await api<{ export: ExportInfo }>(`/api/recordings/${recordingId}/exports`, { method: "POST", json: { format, revision_id: revisionId } });
      setLast(r.export);
      const a = document.createElement("a");
      a.href = r.export.download_url;
      a.download = r.export.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("error"));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card className="space-y-3" id="export">
      <CardTitle>{t("export")}</CardTitle>
      <div className="flex flex-wrap gap-2">
        {["txt", "docx", "pdf", "json"].map((f) => (
          <Button key={f} variant="secondary" size="sm" disabled={!!busy} onClick={() => run(f)} data-testid={`export-${f}`}>
            <Download /> {f.toUpperCase()}
          </Button>
        ))}
        <Button size="sm" disabled={!!busy} onClick={() => run("zip")} data-testid="export-zip">
          <Download /> {t("evidence_package")}
        </Button>
      </div>
      {last && (
        <p className="muted text-xs" dir="ltr" data-testid="export-result">
          {last.filename} · SHA-256 {last.sha256}
        </p>
      )}
      {err && <p className="text-sm text-rose-600">{err}</p>}
    </Card>
  );
}

function TranslationPanel({ recordingId }: { recordingId: string }) {
  const { t } = useI18n();
  const [items, setItems] = useState<Translation[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ translations: Translation[] }>(`/api/recordings/${recordingId}/translations`);
    setItems(r.translations);
  }, [recordingId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load().catch(() => undefined);
  }, [load]);
  useEffect(() => {
    if (!items.some((i) => i.status === "queued" || i.status === "running")) return;
    const h = setInterval(() => void load(), 3000);
    return () => clearInterval(h);
  }, [items, load]);
  async function create(mode: string) {
    setErr(null);
    try {
      await api(`/api/recordings/${recordingId}/translations`, { method: "POST", json: { mode } });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("error"));
    }
  }
  async function exportTr(id: string, format: string) {
    const r = await api<{ export: ExportInfo }>(`/api/recordings/${recordingId}/exports`, { method: "POST", json: { format, translation_id: id } });
    const a = document.createElement("a");
    a.href = r.export.download_url;
    a.download = r.export.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  return (
    <Card className="space-y-3">
      <CardTitle>{t("translate")}</CardTitle>
      <p className="muted text-xs">{t("translation_note")}</p>
      <div className="flex flex-wrap gap-2">
        {(["ar_en", "en_ar", "bilingual"] as const).map((m) => (
          <Button key={m} size="sm" variant="secondary" onClick={() => create(m)}>
            {t(`mode_${m}` as Key)}
          </Button>
        ))}
      </div>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      {items.map((tr) => (
        <div key={tr.id} className="rounded-2xl border hairline p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{t(`mode_${tr.mode}` as Key)}</span>
            <Badge tone={tr.status === "succeeded" ? "ok" : tr.status === "failed" ? "danger" : "accent"}>{tr.status}</Badge>
            <span className="muted text-xs">{tr.provider} {tr.model}</span>
            {tr.status === "succeeded" && (
              <div className="ms-auto flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setOpen(open === tr.id ? null : tr.id)}>
                  {open === tr.id ? t("cancel") : t("translate")}
                </Button>
                {["txt", "docx", "pdf"].map((f) => (
                  <Button key={f} size="sm" variant="ghost" onClick={() => exportTr(tr.id, f)}>
                    {f.toUpperCase()}
                  </Button>
                ))}
              </div>
            )}
          </div>
          {tr.error && <p className="mt-1 text-xs text-rose-600">{tr.error}</p>}
          {open === tr.id && tr.segments && (
            <div className="mt-3 space-y-3">
              {tr.segments.map((s) => (
                <div key={s.segment_id} className="grid gap-1 text-sm sm:grid-cols-2 sm:gap-4">
                  <p className="bidi-auto" dir={textDir(s.source_text)}>
                    <span className="muted me-2 font-mono text-[11px]" dir="ltr">{fmtTime(s.start_ms)}</span>
                    <bdi className="font-medium">{s.speaker_label}</bdi> {s.source_text}
                  </p>
                  <p className="bidi-auto" dir={textDir(s.translation)}>{s.translation}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

function RunsPanel({ runs }: { runs: ProviderRun[] }) {
  const { t } = useI18n();
  if (!runs.length) return null;
  return (
    <details className="glass rounded-3xl p-4 text-xs">
      <summary className="cursor-pointer text-sm font-medium">{t("provider_runs")}</summary>
      <div className="mt-3 space-y-1.5" dir="ltr">
        {runs.map((r) => (
          <div key={r.id} className="flex flex-wrap gap-x-3 gap-y-0.5 border-b hairline pb-1.5">
            <span className="font-medium">{r.provider}</span>
            <span className="muted">{r.model}</span>
            <span className="muted">{r.role}</span>
            <span className="muted">{r.scope}</span>
            <span className={r.status === "succeeded" ? "text-emerald-600" : r.status === "failed" || r.status === "not_configured" ? "text-rose-600" : ""}>
              {r.status === "not_configured" ? "NOT CONFIGURED" : r.status}
            </span>
            {r.error && <span className="w-full text-rose-600">{r.error}</span>}
          </div>
        ))}
      </div>
    </details>
  );
}
