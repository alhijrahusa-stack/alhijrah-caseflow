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
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { extFor, Recorder } from "@/components/recorder";
import { StatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, rowClass, Stat } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { api } from "@/lib/api";
import { fmtBytes, fmtTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { recordingsStore, type StoredRecording } from "@/lib/idb";
import type { Recording } from "@/lib/types";
import { cn } from "@/lib/utils";
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

  const guardIntake = (name: string): boolean => {
    if (languageLocale && recordingType) return true;
    setActive({
      name,
      progress: 0,
      error: rtl ? "حدد اللغة/اللهجة ونوع التسجيل أولاً." : "Select locale and recording type first.",
    });
    return false;
  };

  const systemTone = ready?.ready ? "ok" : ready === null ? "neutral" : "warn";

  return (
    <div className="space-y-6 fade-in">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-sm text-fg-subtle">{greeting(rtl)}</div>
          <h1 className="mt-1 text-2xl font-semibold text-fg sm:text-[28px]">
            {rtl ? "جاهز لمعالجة تسجيل جديد؟" : "Ready for a new recording?"}
          </h1>
          <p className="mt-1.5 text-sm text-fg-muted">{t("controlling")}</p>
        </div>
        <div className="flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-5 text-fg-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />
          <div>
            <div className="eyebrow">{rtl ? "التشغيل" : "Operated by"}</div>
            <div className="font-semibold text-fg">مكتب الهجره — عبدالله المريسي</div>
            <div>ALHIJRAH VISA &amp; IMMIGRATION SERVICES LLC</div>
            <div dir="ltr" className="text-start">Dearborn, Michigan · 313-339-3566 · WhatsApp 313-414-0904</div>
          </div>
        </div>
      </header>

      <Card className="p-0">
        <div className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={cn(
                "size-2.5 shrink-0 rounded-full",
                systemTone === "ok" ? "bg-ok" : systemTone === "warn" ? "bg-warn" : "bg-fg-subtle",
              )}
              aria-hidden
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-fg" role="status">
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
              <div className="mt-0.5 truncate text-xs text-fg-subtle">
                {rtl
                  ? `قاعدة البيانات · التخزين · ${configured} من ${providerTotal || "—"} محركات جاهزة`
                  : `Database · Storage · ${configured} of ${providerTotal || "—"} engines ready`}
              </div>
            </div>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/settings#advanced">
              <Activity /> {rtl ? "التفاصيل" : "Details"}
            </Link>
          </Button>
        </div>
        {providers?.providers.length ? (
          <details className="group border-t border-line px-5 py-3 sm:px-6">
            <summary className="cursor-pointer list-none text-xs font-medium text-fg-muted hover:text-fg">
              {rtl ? `حالة المحركات (${providerTotal})` : `Engine status (${providerTotal})`}
            </summary>
            <div className="mt-3 flex flex-wrap gap-1.5" dir="ltr">
              {providers.providers.map((provider, index) => (
                <Badge key={`${provider.name}-${provider.role}-${index}`} tone={provider.status === "READY" ? "ok" : "warn"}>
                  {provider.name} · {provider.status}
                </Badge>
              ))}
            </div>
          </details>
        ) : null}
      </Card>

      <Card className="px-5 py-6 sm:px-8 sm:py-8">
        {recording ? (
          <Recorder
            onCancel={() => setRecording(false)}
            onFinished={(item) => {
              setRecording(false);
              uploadStored(item);
            }}
          />
        ) : active ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="truncate font-semibold text-fg" dir="auto">
                {active.name}
              </span>
              <span className="font-mono tabular-nums text-primary-text">{Math.round(active.progress * 100)}%</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-surface-3"
              dir="ltr"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(active.progress * 100)}
            >
              <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${active.progress * 100}%` }} />
            </div>
            {active.error ? (
              <Notice tone="danger" role="alert">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>{active.error}</span>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setActive(null)}>
                      {t("cancel")}
                    </Button>
                    {active.retry && (
                      <Button size="sm" onClick={active.retry}>
                        {t("upload_retry")}
                      </Button>
                    )}
                  </div>
                </div>
              </Notice>
            ) : (
              <p className="text-center text-xs text-fg-subtle">{t("uploading")}…</p>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-semibold text-fg">{rtl ? "تسجيل أو رفع ملف صوتي" : "Record or upload audio"}</h2>
              <p className="mt-1 text-sm text-fg-muted">
                {rtl ? "حدد اللغة ونوع التسجيل قبل البدء. الحقول المعلّمة إلزامية." : "Set the language and recording type before you start. Marked fields are required."}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={rtl ? "اللغة / اللهجة — إلزامي" : "Language / locale — required"}>
                <Select value={languageLocale} onChange={(event) => setLanguageLocale(event.target.value as ArabicLocale)} className="h-11">
                  <option value="" disabled>{rtl ? "اختر اللغة/اللهجة" : "Select language/locale"}</option>
                  <option value="ar">العربية العامة / الفصحى / المختلطة — ar</option>
                  <option value="ar-YE">العربية اليمنية — ar-YE</option>
                  <option value="ar-EG">العربية المصرية — ar-EG</option>
                  <option value="ar-SY">العربية السورية — ar-SY</option>
                  <option value="ar-LB">العربية اللبنانية — ar-LB</option>
                  <option value="ar-IQ">العربية العراقية — ar-IQ</option>
                </Select>
              </Field>
              <Field label={rtl ? "نوع التسجيل — إلزامي" : "Recording type — required"}>
                <Select value={recordingType} onChange={(event) => setRecordingType(event.target.value as RecordingType)} className="h-11">
                  <option value="" disabled>{rtl ? "اختر نوع التسجيل" : "Select recording type"}</option>
                  {RECORDING_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{rtl ? type.ar : type.en}</option>
                  ))}
                </Select>
              </Field>
              <Field label={rtl ? "مصطلحات متوقعة — أسماء، مبالغ، أرقام قضايا" : "Expected terms — names, amounts, case numbers"} className="sm:col-span-2">
                <Input
                  value={expectedTermsInput}
                  onChange={(event) => setExpectedTermsInput(event.target.value)}
                  placeholder={rtl ? "مثال: عبدالله المريسي، 25-108101-DM، $159,123" : "Example: party names, case numbers, expected amounts"}
                  className="h-11"
                  dir="auto"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface-2/60 p-3.5 sm:grid-cols-4">
              <Stat label="Version">Draft v1</Stat>
              <Stat label="Locale"><span dir="ltr">{languageLocale || "—"}</span></Stat>
              <Stat label="Type"><span dir="ltr">{recordingType || "—"}</span></Stat>
              <Stat label="Engines"><span dir="ltr">{configured} / {providerTotal || "—"}</span></Stat>
            </div>

            <div className="grid gap-3 sm:grid-cols-[auto_1fr_1fr] sm:items-stretch">
              <Button
                size="lg"
                className="h-14 px-8"
                onClick={() => {
                  if (guardIntake(rtl ? "تسجيل جديد" : "New recording")) setRecording(true);
                }}
                aria-label={t("record")}
              >
                <Mic className="!size-5" /> {t("record")}
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="h-14"
                onClick={() => {
                  if (guardIntake(rtl ? "رفع ملف" : "Upload audio")) fileRef.current?.click();
                }}
              >
                <UploadCloud className="!size-5 text-primary-text" /> {t("upload")}
              </Button>
              <Button asChild size="lg" variant="secondary" className="h-14">
                <Link href="/transcriptions">
                  <FileAudio2 className="!size-5 text-primary-text" /> {t("transcriptions")}
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
          </div>
        )}
      </Card>

      {(stored.length > 0 || pending.length > 0) && !active && !recording && (
        <section className="space-y-2.5">
          <h2 className="eyebrow px-1">{t("pending_uploads")}</h2>
          {stored.map((item) => (
            <Card key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-fg">{t("recovered_recording")}</div>
                <div className="mt-1 text-xs text-fg-subtle">
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
            <Card key={item.fingerprint} className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-4">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-fg" dir="auto">{item.name}</div>
                <div className="mt-1 text-xs text-fg-subtle">{t("reselect_to_resume")}</div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>{t("upload_resume")}</Button>
            </Card>
          ))}
        </section>
      )}

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { href: "/transcriptions", icon: History, label: rtl ? "آخر التسجيلات" : "Recent recordings" },
          { href: recent[0] ? `/transcriptions/${recent[0].id}` : "/transcriptions", icon: FileAudio2, label: rtl ? "استئناف آخر تسجيل" : "Resume last recording" },
          { href: "/settings#advanced", icon: Settings2, label: rtl ? "إعدادات المحركات" : "Engine settings" },
          { href: "/settings", icon: Gauge, label: rtl ? "حالة النظام" : "System status" },
        ].map(({ href, icon: Icon, label }) => (
          <Link key={label} href={href} className={cn(rowClass, "gap-3 p-3.5 text-sm font-medium text-fg")}>
            <Icon className="size-4 shrink-0 text-primary-text" />
            <span className="truncate">{label}</span>
          </Link>
        ))}
      </section>

      <section className="space-y-2.5 pb-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="eyebrow">{t("recent")}</h2>
          <Link href="/transcriptions" className="inline-flex items-center gap-1 text-xs font-medium text-primary-text hover:underline">
            {rtl ? "عرض الكل" : "See all"} <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
        {recent.length ? recent.map((item) => (
          <Link key={item.id} href={`/transcriptions/${item.id}`} className={rowClass}>
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-3">
              <FileAudio2 className="size-[18px] text-primary-text" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-fg" dir="auto">{item.title}</div>
              <div className="mt-1 font-mono text-[11.5px] text-fg-subtle" dir="ltr" style={{ textAlign: rtl ? "right" : "left" }}>
                {fmtTime(item.duration_ms)} · {new Date(item.uploaded_at).toLocaleDateString()}
              </div>
            </div>
            <StatusBadge status={item.status} />
            <Chevron className="size-4 shrink-0 text-fg-subtle" />
          </Link>
        )) : (
          <Card className="py-8 text-center">
            <FileAudio2 className="mx-auto mb-2 size-5 text-fg-subtle" />
            <p className="text-sm text-fg-muted">{t("no_recordings")}</p>
          </Card>
        )}
      </section>
    </div>
  );
}
