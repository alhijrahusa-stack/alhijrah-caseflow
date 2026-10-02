"use client";

import { Copy, Download, FileLock2, ListChecks, RefreshCcw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { PlayerBar, PlayerProvider } from "@/components/player";
import { PROCESSING, StatusBadge } from "@/components/status";
import { TranscriptView } from "@/components/transcript-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, Stat } from "@/components/ui/card";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { api, ApiError } from "@/lib/api";
import { fmtBytes, fmtTime, shortHash, textDir } from "@/lib/format";
import { type Key, useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { ExportInfo, ProviderRun, Recording, Revision, Translation } from "@/lib/types";

type Detail = { recording: Recording; provider_runs: ProviderRun[]; job: { status: string; last_error: string | null } | null };

function CopyHash({ value }: { value: string | null }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  if (!value) return <span className="text-fg-subtle">—</span>;
  return (
    <button
      className="inline-flex items-center gap-1 rounded-sm font-mono text-xs text-fg hover:text-primary-text"
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
      {shortHash(value)} <Copy className="size-3" /> {done && <span className="text-ok">{t("copied")}</span>}
    </button>
  );
}

const STEPS = ["queued", "analyzing", "transcribing", "aligning", "verifying", "building"];

export default function TranscriptPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const { user } = useSession();
  const isAdmin = user?.role === "admin";
  const [detail, setDetail] = useState<Detail | null>(null);
  const [revision, setRevision] = useState<Revision | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [speaker, setSpeaker] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    return <div className="py-20 text-center text-sm text-fg-muted">{error ?? "…"}</div>;
  }
  const rec = detail.recording;
  const content = revision?.content;
  const isLatest = revision && revisions.length > 0 && revision.id === revisions[revisions.length - 1].id;
  const editable = !!(revision && revision.status === "draft" && isLatest);
  const openDisputes = content ? content.segments.flatMap((s) => s.items).filter((i) => i.kind === "dispute").length : 0;

  return (
    <div className="space-y-5 fade-in">
      <PageHeader title={rec.title} back="/transcriptions" actions={<StatusBadge status={rec.status} />} />

      <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 sm:p-5">
        <Stat label={t("duration")}><span className="font-mono" dir="ltr">{fmtTime(rec.duration_ms)}</span></Stat>
        <Stat label={t("uploaded")}><span dir="ltr">{new Date(rec.uploaded_at).toLocaleString()}</span></Stat>
        <Stat label={t("original_sha")}><CopyHash value={rec.sha256} /></Stat>
        <Stat label={t("transcript_sha")}><CopyHash value={revision?.sha256 ?? null} /></Stat>
        <div className="col-span-2 truncate border-t border-line pt-3 text-xs text-fg-subtle sm:col-span-4" dir="auto">
          {rec.original_filename} · {rec.mime_type} · {fmtBytes(rec.byte_size)}
        </div>
      </Card>

      {error && <Notice tone="danger" role="alert">{error}</Notice>}

      {PROCESSING.has(rec.status) && (
        <Card className="space-y-4">
          <CardTitle>{t("processing")}</CardTitle>
          <ol className="grid gap-2">
            {STEPS.map((s, i) => {
              const idx = STEPS.indexOf(rec.status);
              return (
                <li key={s} className="flex items-center gap-3 text-sm">
                  <span className={`size-2 rounded-full ${i < idx ? "bg-ok" : i === idx ? "animate-pulse bg-primary-text" : "bg-line-strong"}`} aria-hidden />
                  <span className={i === idx ? "font-medium text-fg" : "text-fg-subtle"}>{t(`st_${s}` as Key)}</span>
                </li>
              );
            })}
          </ol>
          {rec.status_detail && <p className="text-xs text-fg-muted">{rec.status_detail}</p>}
        </Card>
      )}

      {(rec.status === "failed" || rec.status === "provider_not_configured") && (
        <Card tone="danger" className="space-y-3">
          <p className="text-sm text-fg">{rec.status_detail}</p>
          {detail.job?.last_error && <p className="break-words font-mono text-xs text-fg-muted" dir="ltr">{detail.job.last_error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => act(() => api(`/api/recordings/${id}/reprocess`, { method: "POST" }))} disabled={busy}>
              <RefreshCcw /> {t("reprocess")}
            </Button>
            <Button asChild variant="secondary">
              <Link href="/settings#advanced">{t("advanced")}</Link>
            </Button>
          </div>
          {isAdmin && <EngineSelfTests recordingId={id} />}
        </Card>
      )}

      {content && (
        <PlayerProvider recordingId={id} durationHint={rec.duration_ms}>
          <div className="sticky top-16 z-20 lg:top-2">
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
              <Select
                className="h-9"
                value={revision?.id}
                onChange={(e) => setSelected(e.target.value)}
                aria-label={t("revision")}
              >
                {revisions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {t("revision")} {r.number} · {r.status === "locked" ? t("locked") : t("draft")}
                  </option>
                ))}
              </Select>
            )}
            <Badge tone={revision?.status === "locked" ? "ok" : "neutral"}>
              {t("revision")} {revision?.number} · {revision?.status === "locked" ? t("locked") : t("draft")}
            </Badge>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Input type="search" aria-label={t("search")} placeholder={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} dir="auto" className="sm:max-w-xs" />
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

          <Card className="p-3 sm:p-4">
            <p className="px-2 pb-3 text-center text-xs text-fg-subtle">
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
        <div key={sid} className="grid gap-2 rounded-lg border border-line bg-surface-2/50 p-3 sm:grid-cols-[8rem_1fr_auto] sm:items-center">
          <bdi className="text-sm font-medium text-fg">{info.label}</bdi>
          <div className="space-y-1.5">
            <Input
              placeholder={info.verified_name ?? t("verify_name")}
              value={names[sid] ?? ""}
              onChange={(e) => setNames({ ...names, [sid]: e.target.value })}
              dir="auto"
            />
            <Checkbox label={t("verify_confirm")} checked={!!confirm[sid]} onChange={(e) => setConfirm({ ...confirm, [sid]: e.target.checked })} />
          </div>
          <Button size="sm" onClick={() => verify(sid)} disabled={!!names[sid] && !confirm[sid]}>
            {t("save")}
          </Button>
        </div>
      ))}
      {msg && <Notice tone="danger" role="alert">{msg}</Notice>}
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
        <p className="break-all font-mono text-xs text-fg-muted" dir="ltr" data-testid="export-result">
          {last.filename} · SHA-256 {last.sha256}
        </p>
      )}
      {err && <Notice tone="danger" role="alert">{err}</Notice>}
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
      <p className="text-xs text-fg-muted">{t("translation_note")}</p>
      <div className="flex flex-wrap gap-2">
        {(["ar_en", "en_ar", "bilingual"] as const).map((m) => (
          <Button key={m} size="sm" variant="secondary" onClick={() => create(m)}>
            {t(`mode_${m}` as Key)}
          </Button>
        ))}
      </div>
      {err && <Notice tone="danger" role="alert">{err}</Notice>}
      {items.map((tr) => (
        <div key={tr.id} className="rounded-lg border border-line bg-surface-2/50 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-fg">{t(`mode_${tr.mode}` as Key)}</span>
            <Badge tone={tr.status === "succeeded" ? "ok" : tr.status === "failed" ? "danger" : "accent"}>{tr.status}</Badge>
            <span className="text-xs text-fg-subtle">{tr.provider} {tr.model}</span>
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
          {tr.error && <p className="mt-1 text-xs text-danger">{tr.error}</p>}
          {open === tr.id && tr.segments && (
            <div className="mt-3 space-y-3">
              {tr.segments.map((s) => (
                <div key={s.segment_id} className="grid gap-1 text-sm text-fg sm:grid-cols-2 sm:gap-4">
                  <p className="bidi-auto" dir={textDir(s.source_text)}>
                    <span className="me-2 font-mono text-xs text-fg-subtle" dir="ltr">{fmtTime(s.start_ms)}</span>
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
    <details className="rounded-xl border border-line bg-surface p-4 text-xs shadow-card sm:p-5">
      <summary className="cursor-pointer text-sm font-semibold text-fg">{t("provider_runs")}</summary>
      <div className="mt-3 space-y-1.5" dir="ltr">
        {runs.map((r) => (
          <div key={r.id} className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-line pb-1.5 last:border-0">
            <span className="font-medium text-fg">{r.provider}</span>
            <span className="text-fg-muted">{r.model}</span>
            <span className="text-fg-muted">{r.role}</span>
            <span className="text-fg-subtle">{r.scope}</span>
            <span className={r.status === "succeeded" ? "text-ok" : r.status === "failed" || r.status === "not_configured" ? "text-danger" : "text-fg-muted"}>
              {r.status === "not_configured" ? "NOT CONFIGURED" : r.status}
            </span>
            {r.error && <span className="w-full text-danger">{r.error}</span>}
          </div>
        ))}
      </div>
    </details>
  );
}

type SelfTest = {
  id: string;
  provider: string;
  model: string;
  locale: string;
  role: string;
  status: string;
  latency_ms: number | null;
  error: string | null;
  completed_at: string | null;
};

/** Admin action: run the real engine self-tests for this recording's locale routes. */
function EngineSelfTests({ recordingId }: { recordingId: string }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [tests, setTests] = useState<SelfTest[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await api<{ self_tests: SelfTest[] }>(`/api/recordings/${recordingId}/engine-self-tests`);
    setTests(r.self_tests);
  }, [recordingId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load().catch(() => undefined);
  }, [load]);
  const pending = tests.some((x) => !x.completed_at);
  useEffect(() => {
    if (!pending) return;
    const h = setInterval(() => void load().catch(() => undefined), 5000);
    return () => clearInterval(h);
  }, [pending, load]);
  async function run() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/recordings/${recordingId}/engine-self-tests`, { method: "POST" });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }
  const latest = new Map<string, SelfTest>();
  for (const x of tests) if (!latest.has(`${x.provider}:${x.role}`)) latest.set(`${x.provider}:${x.role}`, x);
  return (
    <div className="space-y-3 border-t border-line pt-4" data-testid="engine-self-tests">
      <p className="text-sm text-fg-muted">
        {ar
          ? "إذا كان سبب الإيقاف عدم جاهزية المحركات: شغّل الاختبار الذاتي الحقيقي على هذا التسجيل، ثم أعد المعالجة بعد أن تصبح الحالة READY."
          : "If processing was blocked because engines are not ready, run the real engine self-test on this recording, then retry processing once every engine is READY."}
      </p>
      <Button variant="secondary" size="sm" onClick={run} disabled={busy || pending}>
        {pending ? (ar ? "الاختبار جارٍ…" : "Self-test running…") : ar ? "تشغيل الاختبار الذاتي للمحركات" : "Run engine self-test"}
      </Button>
      {[...latest.values()].map((x) => (
        <div key={x.id} className="flex flex-wrap items-center gap-2 text-xs" dir="ltr">
          <Badge tone={x.status === "READY" ? "ok" : x.completed_at ? "danger" : "accent"}>{x.completed_at ? x.status : "RUNNING"}</Badge>
          <span className="font-medium text-fg">{x.provider}</span>
          <span className="text-fg-muted">{x.model} · {x.role} · {x.locale}</span>
          {x.latency_ms != null && <span className="text-fg-subtle">{(x.latency_ms / 1000).toFixed(1)} s</span>}
          {x.completed_at && x.status !== "READY" && x.error && <span className="w-full text-danger">{x.error}</span>}
        </div>
      ))}
      {err && <Notice tone="danger" role="alert">{err}</Notice>}
    </div>
  );
}
