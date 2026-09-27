"use client";

import { ChevronLeft, ChevronRight, Mic, UploadCloud } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type SendFn = (blob: Blob, name: string, title: string, source: "upload" | "recording", storedId?: string) => Promise<void>;

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

export default function HomePage() {
  const { t, dir } = useI18n();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);
  const [active, setActive] = useState<Active | null>(null);
  const [recent, setRecent] = useState<Recording[]>([]);
  const [stored, setStored] = useState<StoredRecording[]>([]);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const Chevron = dir === "rtl" ? ChevronLeft : ChevronRight;
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
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
  }, [load]);

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
    <div className="space-y-8 fade-in">
      <header className="pt-6 text-center lg:pt-2 lg:text-start">
        <h1 className="text-[34px] font-semibold leading-tight tracking-[0.2em]">MURAILEX</h1>
        <p className="muted mt-1 text-[15px]">{t("tagline")}</p>
      </header>

      <Card className="p-6 sm:p-8">
        {recording ? (
          <Recorder
            onCancel={() => setRecording(false)}
            onFinished={(r) => {
              setRecording(false);
              uploadStored(r);
            }}
          />
        ) : active ? (
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="truncate font-medium" dir="auto">
                {active.name}
              </span>
              <span className="muted tabular-nums">{Math.round(active.progress * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-black/5 dark:bg-white/10" dir="ltr">
              <div className="h-full rounded-full bg-accent-500 transition-[width]" style={{ width: `${active.progress * 100}%` }} />
            </div>
            {active.error ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-rose-600">
                  {t("upload_failed")}: {active.error}
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setActive(null)}>
                    {t("cancel")}
                  </Button>
                  <Button size="sm" onClick={active.retry}>
                    {t("upload_retry")}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="muted text-xs">{t("uploading")}…</p>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Button size="lg" className="h-20 rounded-3xl text-base" onClick={() => setRecording(true)}>
              <Mic className="!size-6" /> {t("record")}
            </Button>
            <Button size="lg" variant="secondary" className="h-20 rounded-3xl text-base" onClick={() => fileRef.current?.click()}>
              <UploadCloud className="!size-6" /> {t("upload")}
            </Button>
            <input ref={fileRef} type="file" accept="audio/*,.m4a,.mp3,.wav,.aac,.flac,.ogg,.opus,.webm,.amr,.3gp,.caf,.wma,.mp4,.mov" hidden onChange={onFile} data-testid="file-input" />
          </div>
        )}
        <p className="muted mt-5 text-center text-xs">{t("controlling")}</p>
      </Card>

      {(stored.length > 0 || pending.length > 0) && !active && !recording && (
        <section className="space-y-3">
          <h2 className="muted px-1 text-xs font-medium uppercase tracking-wider">{t("pending_uploads")}</h2>
          {stored.map((s) => (
            <Card key={s.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="text-sm font-medium">{t("recovered_recording")}</div>
                <div className="muted text-xs">
                  {new Date(s.startedAt).toLocaleString()} · {fmtBytes(s.chunks.reduce((a, c) => a + c.size, 0))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={async () => { await recordingsStore.remove(s.id); void load(); }}>
                  {t("discard")}
                </Button>
                <Button size="sm" onClick={() => uploadStored(s)}>
                  {t("upload_resume")}
                </Button>
              </div>
            </Card>
          ))}
          {pending.map((p) => (
            <Card key={p.fingerprint} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium" dir="auto">{p.name}</div>
                <div className="muted text-xs">{t("reselect_to_resume")}</div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
                {t("upload_resume")}
              </Button>
            </Card>
          ))}
        </section>
      )}

      {recent.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="muted text-xs font-medium uppercase tracking-wider">{t("recent")}</h2>
            <Link href="/transcriptions" className="text-xs text-accent-600 dark:text-accent-300">
              {t("transcriptions")}
            </Link>
          </div>
          {recent.map((r) => (
            <Link key={r.id} href={`/transcriptions/${r.id}`} className="glass flex items-center gap-4 rounded-3xl p-4 transition hover:bg-white/70 dark:hover:bg-white/[0.06]">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium" dir="auto">{r.title}</div>
                <div className="muted mt-0.5 text-xs" dir="ltr" style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
                  {fmtTime(r.duration_ms)} · {new Date(r.uploaded_at).toLocaleDateString()}
                </div>
              </div>
              <StatusBadge status={r.status} />
              <Chevron className="muted size-4" />
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
