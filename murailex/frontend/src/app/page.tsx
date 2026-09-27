"use client";

import { Activity, ArrowUpRight, ChevronLeft, ChevronRight, FileAudio2, Mic, ShieldCheck, Sparkles, UploadCloud, Waves } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SendFn = (blob: Blob, name: string, title: string, source: "upload" | "recording", storedId?: string) => Promise<void>;
type ReadyState = { ready: boolean; checks?: { database?: { ok: boolean }; storage?: { ok: boolean } } };
type ProviderState = { providers: { name: string; status: string; role: string }[] };

import { extFor, Recorder } from "@/components/recorder";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { fmtBytes, fmtTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { recordingsStore, type StoredRecording } from "@/lib/idb";
import type { Recording } from "@/lib/types";
import { forgetPending, pendingUploads, resumableUpload, type PendingUpload } from "@/lib/upload";

type Active = { name: string; progress: number; error?: string; retry?: () => void };

function greeting(rtl: boolean): string {
  const h = new Date().getHours();
  if (rtl) return h < 12 ? "صباح الخير" : h < 18 ? "مساء الخير" : "مساء الخير";
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function HomePage() {
  const { t, dir } = useI18n();
  const rtl = dir === "rtl";
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);
  const [active, setActive] = useState<Active | null>(null);
  const [recent, setRecent] = useState<Recording[]>([]);
  const [stored, setStored] = useState<StoredRecording[]>([]);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [ready, setReady] = useState<ReadyState | null>(null);
  const [providers, setProviders] = useState<ProviderState | null>(null);
  const Chevron = rtl ? ChevronLeft : ChevronRight;
  const sendRef = useRef<SendFn | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ recordings: Recording[] }>("/api/recordings");
      setRecent(r.recordings.slice(0, 4));
    } catch {
      /* handled by api() */
    }
    try {
      setStored((await recordingsStore.all()).filter((s) => s.chunks.length > 0));
    } catch {
      setStored([]);
    }
    setPending(pendingUploads().filter((p) => !p.storedRecordingId));
    try {
      setReady(await api<ReadyState>("/api/ready"));
    } catch {
      setReady({ ready: false });
    }
    try {
      setProviders(await api<ProviderState>("/api/providers"));
    } catch {
      setProviders(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const configured = useMemo(() => providers?.providers.filter((p) => p.status === "CONFIGURED").length ?? 0, [providers]);

  const send = useCallback(
    async (blob: Blob, name: string, title: string, source: "upload" | "recording", storedId?: string) => {
      setActive({ name, progress: 0 });
      try {
        const rec = await resumableUpload(blob, {
          name,
          title,
          source,
          storedRecordingId: storedId,
          onProgress: (p) => setActive({ name, progress: p }),
        });
        if (storedId) await recordingsStore.remove(storedId);
        setActive(null);
        router.push(`/transcriptions/${rec.id}`);
      } catch (e) {
        const retry = () => void sendRef.current?.(blob, name, title, source, storedId);
        setActive({ name, progress: 0, error: e instanceof Error ? e.message : t("upload_failed"), retry });
      }
    },
    [router, t],
  );

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  useEffect(() => {
    if (!active?.retry) return;
    const onOnline = () => active.retry?.();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [active]);

  function uploadStored(s: StoredRecording) {
    const blob = new Blob(s.chunks, { type: s.mime.split(";")[0] });
    const stamp = new Date(s.startedAt).toISOString().replace(/[:.]/g, "-");
    void send(blob, `recording-${stamp}.${extFor(s.mime)}`, `Recording ${new Date(s.startedAt).toLocaleString()}`, "recording", s.id);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const title = f.name.replace(/\.[^.]+$/, "");
    const match = pendingUploads().find((p) => p.name === f.name && p.size === f.size);
    if (match) forgetPending(match.fingerprint);
    void send(f, f.name, match?.title ?? title, "upload");
  }

  return (
    <div className="space-y-7 fade-in">
      <header className="pt-3 sm:pt-1">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="tech-label">FORENSIC AUDIO INTELLIGENCE</div>
            <h1 className="brand-gradient mt-1 text-[34px] font-extrabold leading-none tracking-[0.18em] sm:text-[40px]">MURAILEX</h1>
            <p className="mt-2 text-sm font-medium text-slate-300">{rtl ? "الذكاء الجنائي للصوت" : "Forensic Audio Intelligence"}</p>
          </div>
          <div className="hidden items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-[11px] text-slate-400 sm:flex">
            <ShieldCheck className="size-4 text-cyan-300" />
            <span>SHA-256 · AUDIT · IMMUTABLE</span>
          </div>
        </div>

        <div className="mt-7">
          <div className="text-[13px] text-slate-500">{greeting(rtl)},</div>
          <div className="mt-0.5 text-[22px] font-bold tracking-tight text-slate-100">
            {rtl ? "جاهز لمعالجة تسجيل جديد؟" : "Ready for a new recording?"}
          </div>
        </div>
      </header>

      <Card className="glass-elevated overflow-hidden p-0">
        <div className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`glow-dot size-2.5 shrink-0 rounded-full ${ready?.ready ? "bg-emerald-400" : ready === null ? "bg-slate-500" : "bg-amber-400"}`} />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-100">
                {ready?.ready ? (rtl ? "البنية التشغيلية متصلة" : "Core system online") : ready === null ? (rtl ? "جارٍ فحص النظام" : "Checking system") : (rtl ? "يتطلب النظام مراجعة" : "System requires attention")}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-slate-500">
                {rtl ? `قاعدة البيانات · التخزين · ${configured} محرك مهيأ` : `Database · Storage · ${configured} engine${configured === 1 ? "" : "s"} configured`}
              </div>
            </div>
          </div>
          <Activity className={`size-5 ${ready?.ready ? "text-emerald-300" : "text-amber-300"}`} />
        </div>
      </Card>

      <Card className="glass-elevated relative overflow-hidden px-5 py-8 sm:px-8 sm:py-10">
        <div className="pointer-events-none absolute -start-16 top-0 size-48 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -end-12 bottom-0 size-48 rounded-full bg-cyan-500/[0.07] blur-3xl" />

        {recording ? (
          <Recorder
            onCancel={() => setRecording(false)}
            onFinished={(r) => {
              setRecording(false);
              uploadStored(r);
            }}
          />
        ) : active ? (
          <div className="relative space-y-5 py-3">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="truncate font-semibold text-slate-100" dir="auto">{active.name}</span>
              <span className="font-mono text-indigo-300 tabular-nums">{Math.round(active.progress * 100)}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full border border-white/[0.05] bg-black/30" dir="ltr">
              <div className="primary-gradient h-full rounded-full shadow-[0_0_18px_rgba(99,102,241,.55)] transition-[width] duration-300" style={{ width: `${active.progress * 100}%` }} />
            </div>
            {active.error ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-400/15 bg-rose-400/[0.05] p-3.5">
                <p className="text-sm text-rose-300">{t("upload_failed")}: {active.error}</p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setActive(null)}>{t("cancel")}</Button>
                  <Button size="sm" onClick={active.retry}>{t("upload_retry")}</Button>
                </div>
              </div>
            ) : (
              <p className="text-center text-xs text-slate-500">{t("uploading")}…</p>
            )}
          </div>
        ) : (
          <div className="relative flex flex-col items-center py-2">
            <button
              type="button"
              onClick={() => setRecording(true)}
              className="hero-record primary-gradient grid size-[142px] place-items-center rounded-full border border-white/15 text-white transition duration-300 hover:scale-[1.025] active:scale-[.97]"
              aria-label={t("record")}
            >
              <span className="flex flex-col items-center gap-2">
                <Mic className="size-10 drop-shadow-[0_4px_12px_rgba(0,0,0,.25)]" strokeWidth={1.8} />
                <span className="text-sm font-bold">{t("record")}</span>
              </span>
            </button>
            <div className="mt-10 grid w-full gap-3 sm:grid-cols-2">
              <Button size="lg" variant="secondary" className="glass-interactive h-16 rounded-[20px]" onClick={() => fileRef.current?.click()}>
                <UploadCloud className="!size-5 text-cyan-300" /> {t("upload")}
              </Button>
              <Button asChild size="lg" variant="secondary" className="glass-interactive h-16 rounded-[20px]">
                <Link href="/transcriptions">
                  <FileAudio2 className="!size-5 text-violet-300" /> {t("transcriptions")}
                </Link>
              </Button>
            </div>
            <input ref={fileRef} type="file" accept="audio/*,.m4a,.mp3,.wav,.aac,.flac,.ogg,.opus,.webm,.amr,.3gp,.caf,.wma,.mp4,.mov" hidden onChange={onFile} data-testid="file-input" />
            <div className="mt-5 flex items-center gap-2 text-[11px] text-slate-500">
              <Waves className="size-3.5 text-indigo-300" /> {t("controlling")}
            </div>
          </div>
        )}
      </Card>

      {(stored.length > 0 || pending.length > 0) && !active && !recording && (
        <section className="space-y-3">
          <h2 className="tech-label px-1">{t("pending_uploads")}</h2>
          {stored.map((s) => (
            <Card key={s.id} className="glass-interactive flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-100">{t("recovered_recording")}</div>
                <div className="mt-1 text-xs text-slate-500">{new Date(s.startedAt).toLocaleString()} · {fmtBytes(s.chunks.reduce((a, c) => a + c.size, 0))}</div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={async () => { await recordingsStore.remove(s.id); void load(); }}>{t("discard")}</Button>
                <Button size="sm" onClick={() => uploadStored(s)}>{t("upload_resume")}</Button>
              </div>
            </Card>
          ))}
          {pending.map((p) => (
            <Card key={p.fingerprint} className="glass-interactive flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-100" dir="auto">{p.name}</div>
                <div className="mt-1 text-xs text-slate-500">{t("reselect_to_resume")}</div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>{t("upload_resume")}</Button>
            </Card>
          ))}
        </section>
      )}

      <section className="space-y-3 pb-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="tech-label">{t("recent")}</h2>
          <Link href="/transcriptions" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-300 hover:text-indigo-200">
            {rtl ? "عرض الكل" : "See all"} <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
        {recent.length ? recent.map((r) => (
          <Link key={r.id} href={`/transcriptions/${r.id}`} className="glass glass-interactive flex items-center gap-4 rounded-[20px] p-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl border border-white/[0.07] bg-white/[0.035]">
              <FileAudio2 className="size-5 text-violet-300" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-100" dir="auto">{r.title}</div>
              <div className="mt-1 font-mono text-[10px] text-slate-500" dir="ltr" style={{ textAlign: rtl ? "right" : "left" }}>
                {fmtTime(r.duration_ms)} · {new Date(r.uploaded_at).toLocaleDateString()}
              </div>
            </div>
            <StatusBadge status={r.status} />
            <Chevron className="size-4 text-slate-600" />
          </Link>
        )) : (
          <Card className="p-7 text-center">
            <Sparkles className="mx-auto mb-2 size-5 text-indigo-300" />
            <p className="text-sm text-slate-400">{t("no_recordings")}</p>
          </Card>
        )}
      </section>
    </div>
  );
}
