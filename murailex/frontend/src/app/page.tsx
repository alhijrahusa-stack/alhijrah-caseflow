"use client";

import {
  Activity,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  FileAudio2,
  Gauge,
  History,
  Mic,
  Settings2,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Waves,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { extFor, Recorder } from "@/components/recorder";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { fmtBytes, fmtTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { recordingsStore, type StoredRecording } from "@/lib/idb";
import type { Recording } from "@/lib/types";
import {
  forgetPending,
  pendingUploads,
  resumableUpload,
  type ArabicLocale,
  type PendingUpload,
  type RecordingType,
} from "@/lib/upload";

type SendFn = (
  blob: Blob,
  name: string,
  title: string,
  source: "upload" | "recording",
  storedId?: string,
) => Promise<void>;
type ReadyState = { ready: boolean; checks?: { database?: { ok: boolean }; storage?: { ok: boolean } } };
type ProviderState = { providers: { name: string; status: string; role: string; model?: string }[] };
type Active = { name: string; progress: number; error?: string; retry?: () => void };

const RECORDING_TYPES: { value: RecordingType; ar: string; en: string }[] = [
  { value: "interrogation", ar: "استجواب", en: "Interrogation" },
  { value: "witness_testimony", ar: "شهادة", en: "Witness Testimony" },
  { value: "meeting", ar: "اجتماع", en: "Meeting" },
  { value: "phone_call", ar: "مكالمة", en: "Phone Call" },
  { value: "court_session", ar: "جلسة محكمة", en: "Court Session" },
  { value: "third_circuit_transcript", ar: "Transcript لمحكمة Third Circuit", en: "3rd Circuit Court Transcript" },
  {
    value: "michigan_appellate_transcript",
    ar: "Transcript لمحكمة استئناف ميشيغان",
    en: "Michigan Court of Appeals Transcript",
  },
  { value: "other", ar: "أخرى", en: "Other" },
];

function greeting(rtl: boolean): string {
  const hour = new Date().getHours();
  if (rtl) return hour < 12 ? "صباح الخير" : "مساء الخير";
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export default function HomePage() {
  const { t, dir } = useI18n();
  const rtl = dir === "rtl";
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const sendRef = useRef<SendFn | null>(null);
  const [recording, setRecording] = useState(false);
  const [languageLocale, setLanguageLocale] = useState<ArabicLocale | "">("");
  const [recordingType, setRecordingType] = useState<RecordingType | "">("");
  const [expectedTermsInput, setExpectedTermsInput] = useState("");
  const [active, setActive] = useState<Active | null>(null);
  const [recent, setRecent] = useState<Recording[]>([]);
  const [stored, setStored] = useState<StoredRecording[]>([]);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [ready, setReady] = useState<ReadyState | null>(null);
  const [providers, setProviders] = useState<ProviderState | null>(null);
  const Chevron = rtl ? ChevronLeft : ChevronRight;

  const load = useCallback(async () => {
    try {
      const result = await api<{ recordings: Recording[] }>("/api/recordings");
      setRecent(result.recordings.slice(0, 4));
    } catch {
      /* authenticated API surface handles the error state */
    }
    try {
      setStored((await recordingsStore.all()).filter((item) => item.chunks.length > 0));
    } catch {
      setStored([]);
    }
    setPending(pendingUploads().filter((item) => !item.storedRecordingId));
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

  const configured = useMemo(
    () => providers?.providers.filter((provider) => provider.status === "READY").length ?? 0,
    [providers],
  );
  const providerTotal = providers?.providers.length ?? 0;
  const expectedTerms = useMemo(
    () =>
      expectedTermsInput
        .split(/[،,\n]/)
        .map((term) => term.trim())
        .filter(Boolean)
        .slice(0, 50),
    [expectedTermsInput],
  );

  const send = useCallback(
    async (
      blob: Blob,
      name: string,
      title: string,
      source: "upload" | "recording",
      storedId?: string,
    ) => {
      if (!languageLocale) {
        setActive({
          name,
          progress: 0,
          error: rtl ? "اختر اللغة/اللهجة قبل الرفع." : "Select the recording language/locale before upload.",
        });
        return;
      }
      if (!recordingType) {
        setActive({
          name,
          progress: 0,
          error: rtl ? "اختر نوع التسجيل قبل الرفع." : "Select the recording type before upload.",
        });
        return;
      }
      setActive({ name, progress: 0 });
      try {
        const rec = await resumableUpload(blob, {
          name,
          title,
          source,
          storedRecordingId: storedId,
          languageLocale,
          recordingType,
          expectedTerms,
          onProgress: (progress) => setActive({ name, progress }),
        });
        if (storedId) await recordingsStore.remove(storedId);
        setActive(null);
        router.push(`/transcriptions/${rec.id}`);
      } catch (error) {
        const retry = () => void sendRef.current?.(blob, name, title, source, storedId);
        setActive({
          name,
          progress: 0,
          error: error instanceof Error ? error.message : t("upload_failed"),
          retry,
        });
      }
    },
    [expectedTerms, languageLocale, recordingType, router, rtl, t],
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

  function uploadStored(item: StoredRecording) {
    const blob = new Blob(item.chunks, { type: item.mime.split(";")[0] });
    const stamp = new Date(item.startedAt).toISOString().replace(/[:.]/g, "-");
    void send(
      blob,
      `recording-${stamp}.${extFor(item.mime)}`,
      `Recording ${new Date(item.startedAt).toLocaleString()}`,
      "recording",
      item.id,
    );
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const title = file.name.replace(/\.[^.]+$/, "");
    const match = pendingUploads().find((item) => item.name === file.name && item.size === file.size);
    if (match) forgetPending(match.fingerprint);
    void send(file, file.name, match?.title ?? title, "upload");
  }

  return (
    <div className="space-y-7 fade-in">
      <header className="pt-3 sm:pt-1">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="tech-label">FORENSIC AUDIO INTELLIGENCE</div>
            <h1 className="brand-gradient mt-1 text-[34px] font-extrabold leading-none tracking-[0.18em] sm:text-[40px]">
              MURAILEX
            </h1>
            <p className="mt-2 text-sm font-medium text-slate-300">
              {rtl ? "الذكاء الجنائي للصوت" : "Forensic Audio Intelligence"}
            </p>
          </div>
          <div className="glass flex items-start gap-3 rounded-2xl px-3.5 py-3 text-[11px] text-slate-400">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-cyan-300" />
            <div className="leading-5">
              <div className="tech-label !text-[9px]">OPERATED BY</div>
              <div className="font-semibold text-slate-200">مكتب الهجره — عبدالله المريسي</div>
              <div>ALHIJRAH VISA &amp; IMMIGRATION SERVICES LLC</div>
              <div>Dearborn, Michigan · 313-339-3566</div>
              <div>WhatsApp · 313-414-0904</div>
            </div>
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
            <span
              className={`glow-dot size-2.5 shrink-0 rounded-full ${
                ready?.ready ? "bg-emerald-400" : ready === null ? "bg-slate-500" : "bg-amber-400"
              }`}
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-100">
                {ready?.ready
                  ? rtl
                    ? "البنية التشغيلية متصلة"
                    : "Core system online"
                  : ready === null
                    ? rtl
                      ? "جارٍ فحص النظام"
                      : "Checking system"
                    : rtl
                      ? "يتطلب النظام مراجعة"
                      : "System requires attention"}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-slate-500">
                {rtl
                  ? `قاعدة البيانات · التخزين · ${configured} من ${providerTotal || "—"} محركات جاهزة`
                  : `Database · Storage · ${configured} of ${providerTotal || "—"} engines ready`}
              </div>
            </div>
          </div>
          <Activity className={`size-5 ${ready?.ready ? "text-emerald-300" : "text-amber-300"}`} />
        </div>
        {providers?.providers.length ? (
          <div className="border-t border-white/[0.06] px-5 py-3 sm:px-6">
            <div className="flex flex-wrap gap-1.5">
              {providers.providers.map((provider) => (
                <span
                  key={`${provider.name}-${provider.role}`}
                  className={`rounded-full border px-2.5 py-1 text-[10px] ${
                    provider.status === "READY"
                      ? "border-emerald-400/15 bg-emerald-400/[0.06] text-emerald-300"
                      : "border-amber-400/15 bg-amber-400/[0.05] text-amber-300"
                  }`}
                >
                  {provider.name} · {provider.status}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="glass-elevated relative overflow-hidden px-5 py-7 sm:px-8 sm:py-9">
        <div className="pointer-events-none absolute -start-16 top-0 size-48 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -end-12 bottom-0 size-48 rounded-full bg-cyan-500/[0.07] blur-3xl" />

        {recording ? (
          <Recorder
            onCancel={() => setRecording(false)}
            onFinished={(item) => {
              setRecording(false);
              uploadStored(item);
            }}
          />
        ) : active ? (
          <div className="relative space-y-5 py-3">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="truncate font-semibold text-slate-100" dir="auto">
                {active.name}
              </span>
              <span className="font-mono text-indigo-300 tabular-nums">{Math.round(active.progress * 100)}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full border border-white/[0.05] bg-black/30" dir="ltr">
              <div
                className="primary-gradient h-full rounded-full shadow-[0_0_18px_rgba(99,102,241,.55)] transition-[width] duration-300"
                style={{ width: `${active.progress * 100}%` }}
              />
            </div>
            {active.error ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-400/15 bg-rose-400/[0.05] p-3.5">
                <p className="text-sm text-rose-300">{active.error}</p>
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
              <p className="text-center text-xs text-slate-500">{t("uploading")}…</p>
            )}
          </div>
        ) : (
          <div className="relative flex flex-col items-center py-2">
            <div className="mb-6 grid w-full max-w-2xl gap-3 sm:grid-cols-2">
              <label className="space-y-2 text-xs font-semibold text-slate-300">
                <span>{rtl ? "اللغة / اللهجة — إلزامي" : "Language / locale — required"}</span>
                <select
                  value={languageLocale}
                  onChange={(event) => setLanguageLocale(event.target.value as ArabicLocale)}
                  className="h-12 w-full rounded-2xl border border-white/[0.10] bg-slate-950/70 px-4 text-sm text-slate-100 outline-none focus:border-indigo-400/60"
                >
                  <option value="" disabled>{rtl ? "اختر اللغة/اللهجة" : "Select language/locale"}</option>
                  <option value="ar">العربية العامة / الفصحى / المختلطة — ar</option>
                  <option value="ar-YE">العربية اليمنية — ar-YE</option>
                  <option value="ar-EG">العربية المصرية — ar-EG</option>
                  <option value="ar-SY">العربية السورية — ar-SY</option>
                  <option value="ar-LB">العربية اللبنانية — ar-LB</option>
                  <option value="ar-IQ">العربية العراقية — ar-IQ</option>
                </select>
              </label>
              <label className="space-y-2 text-xs font-semibold text-slate-300">
                <span>{rtl ? "نوع التسجيل — إلزامي" : "Recording type — required"}</span>
                <select
                  value={recordingType}
                  onChange={(event) => setRecordingType(event.target.value as RecordingType)}
                  className="h-12 w-full rounded-2xl border border-white/[0.10] bg-slate-950/70 px-4 text-sm text-slate-100 outline-none focus:border-indigo-400/60"
                >
                  <option value="" disabled>{rtl ? "اختر نوع التسجيل" : "Select recording type"}</option>
                  {RECORDING_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{rtl ? type.ar : type.en}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="mb-6 w-full max-w-2xl space-y-2 text-xs font-semibold text-slate-300">
              <span>{rtl ? "مصطلحات متوقعة — أسماء، مبالغ، أرقام قضايا" : "Expected terms — names, amounts, case numbers"}</span>
              <input
                value={expectedTermsInput}
                onChange={(event) => setExpectedTermsInput(event.target.value)}
                placeholder={rtl ? "مثال: عبدالله المريسي، 25-108101-DM، $159,123" : "Example: party names, case numbers, expected amounts"}
                className="h-12 w-full rounded-2xl border border-white/[0.10] bg-slate-950/70 px-4 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-indigo-400/60"
                dir="auto"
              />
            </label>

            <div className="mb-5 grid w-full max-w-2xl grid-cols-2 gap-2 rounded-2xl border border-white/[0.07] bg-black/20 p-3 text-[11px] text-slate-400 sm:grid-cols-4">
              <div><span className="block text-slate-600">Version</span>Draft v1</div>
              <div><span className="block text-slate-600">Locale</span>{languageLocale || "—"}</div>
              <div><span className="block text-slate-600">Type</span>{recordingType || "—"}</div>
              <div><span className="block text-slate-600">Engines</span>{configured} / {providerTotal || "—"}</div>
            </div>

            <button
              type="button"
              onClick={() => {
                if (!languageLocale || !recordingType) {
                  setActive({
                    name: rtl ? "تسجيل جديد" : "New recording",
                    progress: 0,
                    error: rtl ? "حدد اللغة/اللهجة ونوع التسجيل أولاً." : "Select locale and recording type first.",
                  });
                  return;
                }
                setRecording(true);
              }}
              className="hero-record primary-gradient grid size-[142px] place-items-center rounded-full border border-white/15 text-white transition duration-300 hover:scale-[1.025] active:scale-[.97]"
              aria-label={t("record")}
            >
              <span className="flex flex-col items-center gap-2">
                <Mic className="size-10 drop-shadow-[0_4px_12px_rgba(0,0,0,.25)]" strokeWidth={1.8} />
                <span className="text-sm font-bold">{t("record")}</span>
              </span>
            </button>

            <div className="mt-8 grid w-full gap-3 sm:grid-cols-2">
              <Button
                size="lg"
                variant="secondary"
                className="glass-interactive h-16 rounded-[20px]"
                onClick={() => {
                  if (!languageLocale || !recordingType) {
                    setActive({
                      name: rtl ? "رفع ملف" : "Upload audio",
                      progress: 0,
                      error: rtl ? "حدد اللغة/اللهجة ونوع التسجيل أولاً." : "Select locale and recording type first.",
                    });
                    return;
                  }
                  fileRef.current?.click();
                }}
              >
                <UploadCloud className="!size-5 text-cyan-300" /> {t("upload")}
              </Button>
              <Button asChild size="lg" variant="secondary" className="glass-interactive h-16 rounded-[20px]">
                <Link href="/transcriptions">
                  <FileAudio2 className="!size-5 text-violet-300" /> {t("transcriptions")}
                </Link>
              </Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,.m4a,.mp3,.wav,.aac,.flac,.ogg,.opus,.webm,.amr,.3gp,.caf,.wma,.mp4,.mov"
              hidden
              onChange={onFile}
              data-testid="file-input"
            />
            <div className="mt-5 flex items-center gap-2 text-[11px] text-slate-500">
              <Waves className="size-3.5 text-indigo-300" /> {t("controlling")}
            </div>
          </div>
        )}
      </Card>

      {(stored.length > 0 || pending.length > 0) && !active && !recording && (
        <section className="space-y-3">
          <h2 className="tech-label px-1">{t("pending_uploads")}</h2>
          {stored.map((item) => (
            <Card key={item.id} className="glass-interactive flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-100">{t("recovered_recording")}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {new Date(item.startedAt).toLocaleString()} · {fmtBytes(item.chunks.reduce((sum, chunk) => sum + chunk.size, 0))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={async () => { await recordingsStore.remove(item.id); void load(); }}>
                  {t("discard")}
                </Button>
                <Button size="sm" onClick={() => uploadStored(item)}>{t("upload_resume")}</Button>
              </div>
            </Card>
          ))}
          {pending.map((item) => (
            <Card key={item.fingerprint} className="glass-interactive flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-100" dir="auto">{item.name}</div>
                <div className="mt-1 text-xs text-slate-500">{t("reselect_to_resume")}</div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>{t("upload_resume")}</Button>
            </Card>
          ))}
        </section>
      )}

      <section className="grid gap-2 sm:grid-cols-2">
        <Button asChild variant="secondary" className="glass-interactive h-14 rounded-[18px]">
          <Link href="/transcriptions"><History className="text-violet-300" />{rtl ? "آخر التسجيلات" : "Recent recordings"}</Link>
        </Button>
        <Button asChild variant="secondary" className="glass-interactive h-14 rounded-[18px]">
          <Link href={recent[0] ? `/transcriptions/${recent[0].id}` : "/transcriptions"}><FileAudio2 className="text-cyan-300" />{rtl ? "استئناف آخر تسجيل" : "Resume last recording"}</Link>
        </Button>
        <Button asChild variant="secondary" className="glass-interactive h-14 rounded-[18px]">
          <Link href="/settings#advanced"><Settings2 className="text-indigo-300" />{rtl ? "إعدادات المحركات" : "Engine settings"}</Link>
        </Button>
        <Button asChild variant="secondary" className="glass-interactive h-14 rounded-[18px]">
          <Link href="/settings"><Gauge className="text-emerald-300" />{rtl ? "حالة النظام" : "System status"}</Link>
        </Button>
      </section>

      <section className="space-y-3 pb-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="tech-label">{t("recent")}</h2>
          <Link href="/transcriptions" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-300 hover:text-indigo-200">
            {rtl ? "عرض الكل" : "See all"} <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
        {recent.length ? recent.map((item) => (
          <Link key={item.id} href={`/transcriptions/${item.id}`} className="glass glass-interactive flex items-center gap-4 rounded-[20px] p-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl border border-white/[0.07] bg-white/[0.035]">
              <FileAudio2 className="size-5 text-violet-300" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-100" dir="auto">{item.title}</div>
              <div className="mt-1 font-mono text-[10px] text-slate-500" dir="ltr" style={{ textAlign: rtl ? "right" : "left" }}>
                {fmtTime(item.duration_ms)} · {new Date(item.uploaded_at).toLocaleDateString()}
              </div>
            </div>
            <StatusBadge status={item.status} />
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
