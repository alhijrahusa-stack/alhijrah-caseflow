"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ClientIntakeBrand, ClientIntakeShell } from "@/components/public/ClientIntakeShell";
import { INTAKE_COPY, type IntakeLocale } from "@/components/public/intake-copy";
import { LocaleToggle } from "@/components/public/LocaleToggle";
import { CLIENT_EDITABLE_FIELDS, type ClientEditableField } from "@/lib/client-intake-fields";
import { SMART_IMPORT_LIMITS } from "@/lib/smart-client-import-core";
import { extractDeterministicClient } from "@/lib/smart-client-local";

/**
 * The client's own intake surface.
 *
 * It reuses the existing deterministic Smart intelligence
 * (`extractDeterministicClient`) to show what it read from the text as the
 * client types — there is no second extraction engine here. The client may
 * correct any detected value, and those corrections are sent as the fields the
 * server writes ahead of the original text, so the existing pipeline stays
 * authoritative.
 *
 * Upload limits and accepted types are the existing Smart import limits; this
 * surface does not define its own.
 */

const ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const ACCEPT_ATTR = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Detected = Partial<Record<ClientEditableField, string>>;

export function ClientIntakeForm({ token }: { token: string }) {
  const [locale, setLocale] = useState<IntakeLocale>("ar");
  const t = INTAKE_COPY[locale];

  const [sourceText, setSourceText] = useState("");
  const [debounced, setDebounced] = useState("");
  // Only the fields the client actually changed. Everything else keeps showing
  // whatever the deterministic read produced.
  const [edits, setEdits] = useState<Detected>({});
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(sourceText), 180);
    return () => clearTimeout(timer);
  }, [sourceText]);

  const detected = useMemo<Detected>(() => {
    if (!debounced.trim()) return {};
    const local = extractDeterministicClient(debounced);
    const out: Detected = {};
    for (const field of CLIENT_EDITABLE_FIELDS) {
      const value = local.row[field];
      if (typeof value === "string" && value.trim()) out[field] = value.trim();
    }
    return out;
  }, [debounced]);

  // What the client sees and what is submitted: their edit if they made one,
  // otherwise the detected value.
  const effective = useMemo<Detected>(() => ({ ...detected, ...edits }), [detected, edits]);
  const visibleFields = CLIENT_EDITABLE_FIELDS.filter((field) => (effective[field] ?? "").trim() || field in edits);

  function admitFiles(incoming: FileList | null) {
    if (!incoming?.length) return;
    setError(null);
    const next = [...files];
    for (const file of Array.from(incoming)) {
      if (!ACCEPTED_MIME.includes(file.type)) { setError(t.unsupported); continue; }
      if (file.size > SMART_IMPORT_LIMITS.maxFileBytes) { setError(t.fileTooLarge); continue; }
      if (next.length >= SMART_IMPORT_LIMITS.maxFiles) { setError(t.tooManyFiles); break; }
      if (next.some((existing) => existing.name === file.name && existing.size === file.size)) continue;
      next.push(file);
    }
    const total = next.reduce((sum, file) => sum + file.size, 0);
    if (total > SMART_IMPORT_LIMITS.maxTotalUploadBytes) { setError(t.totalTooLarge); return; }
    setFiles(next);
  }

  async function submit() {
    if (inFlight.current) return;
    if (!sourceText.trim() && files.length === 0) { setError(t.needSomething); return; }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("source_text", sourceText);
      for (const field of CLIENT_EDITABLE_FIELDS) {
        const value = (effective[field] ?? "").trim();
        if (value) form.set(`field_${field}`, value);
      }
      for (const file of files) form.append("files", file);

      const res = await fetch(`/api/public/client-intake/${encodeURIComponent(token)}`, { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(typeof data?.error?.message === "string" ? data.error.message : t.genericError);
        return;
      }
      setDone(true);
    } catch {
      setError(t.genericError);
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }

  if (done) {
    return (
      <ClientIntakeShell dir={t.dir}>
        <header className="flex flex-wrap items-center justify-between gap-4">
          <ClientIntakeBrand title={t.brand} subtitle={t.office} />
          <LocaleToggle locale={locale} onChange={setLocale} />
        </header>
        <section
          className="mt-10 rounded-3xl border border-emerald-300/20 bg-emerald-300/[.05] p-7 text-center shadow-[0_28px_70px_-40px_rgba(0,0,0,.9)] backdrop-blur-xl sm:p-10"
          data-testid="intake-success"
          role="status"
        >
          <div aria-hidden="true" className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-emerald-300/30 bg-emerald-300/[.1] text-emerald-200">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M5 12.8 9.4 17 19 7.4" />
            </svg>
          </div>
          <h1 className="mt-5 text-[20px] font-semibold tracking-tight text-white sm:text-[23px]">{t.successHeading}</h1>
          <p className="mx-auto mt-3 max-w-[46ch] text-[14px] leading-relaxed text-slate-300">{t.successClosed}</p>
        </section>
      </ClientIntakeShell>
    );
  }

  return (
    <ClientIntakeShell dir={t.dir}>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <ClientIntakeBrand title={t.brand} subtitle={t.office} />
        <LocaleToggle locale={locale} onChange={setLocale} />
      </header>

      <div className="mt-7">
        <h1 className="text-[22px] font-semibold tracking-tight text-white sm:text-[26px]">{t.heading}</h1>
        <p className="mt-2 max-w-[56ch] text-[13px] leading-relaxed text-slate-400">{t.lead}</p>
      </div>

      {/* 1 — Client source data */}
      <section className="mt-6 rounded-3xl border border-white/[.07] bg-white/[.025] p-5 shadow-[0_24px_60px_-40px_rgba(0,0,0,.9)] backdrop-blur-xl sm:p-7" data-testid="intake-source">
        <h2 className="text-[19px] font-semibold tracking-tight text-white sm:text-[21px]">{t.sourceHeading}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-400">{t.sourceHelper}</p>
        <textarea
          value={sourceText}
          onChange={(event) => setSourceText(event.target.value.slice(0, SMART_IMPORT_LIMITS.maxRawTextLength))}
          placeholder={t.sourcePlaceholder}
          rows={9}
          aria-label={t.sourceHeading}
          data-testid="intake-source-text"
          className="mt-4 w-full resize-y rounded-2xl border border-white/[.09] bg-black/35 p-4 text-[15px] leading-relaxed text-slate-100 placeholder:text-slate-600 focus:border-cyan-300/45 focus:outline-none focus:ring-2 focus:ring-cyan-300/15"
        />
      </section>

      {/* 2 — Upload: the strongest action on the page */}
      <section
        className="mt-5 rounded-3xl border border-[#e3c884]/25 bg-gradient-to-b from-[#e3c884]/[.07] to-transparent p-5 shadow-[0_0_60px_-28px_rgba(227,200,132,.35)] backdrop-blur-xl sm:p-7"
        data-testid="intake-upload"
      >
        <div className="flex items-start gap-3">
          <div aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#e3c884]/30 bg-[#e3c884]/[.1] text-[#f3dda4]">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M12 16.5V5.5" /><path d="M7.8 9.7 12 5.5l4.2 4.2" /><path d="M5 16.5v1.8A2.2 2.2 0 0 0 7.2 20.5h9.6a2.2 2.2 0 0 0 2.2-2.2v-1.8" />
            </svg>
          </div>
          <div className="min-w-0">
            <h2 className="text-[20px] font-semibold tracking-tight text-white sm:text-[23px]">{t.uploadHeading}</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-300">{t.uploadHelper}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
          <label className="flex min-h-[52px] cursor-pointer items-center justify-center gap-2 rounded-2xl border border-[#e3c884]/35 bg-[#e3c884]/[.12] px-4 text-[15px] font-semibold text-[#f6e6b8] transition hover:bg-[#e3c884]/[.18] focus-within:ring-2 focus-within:ring-[#e3c884]/35">
            <input type="file" multiple accept={ACCEPT_ATTR} className="sr-only" data-testid="intake-choose-files" onChange={(event) => { admitFiles(event.target.files); event.target.value = ""; }} />
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h3l2 2.5h6A2.5 2.5 0 0 1 20 10v6.5A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5Z" /></svg>
            {t.chooseFiles}
          </label>

          {/* A dedicated capture input, so a phone opens the camera directly. */}
          <label className="flex min-h-[52px] cursor-pointer items-center justify-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-300/[.08] px-4 text-[15px] font-semibold text-cyan-100 transition hover:bg-cyan-300/[.14] focus-within:ring-2 focus-within:ring-cyan-300/30">
            <input type="file" accept="image/*" capture="environment" className="sr-only" data-testid="intake-take-photo" onChange={(event) => { admitFiles(event.target.files); event.target.value = ""; }} />
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3.5" y="7" width="17" height="12.5" rx="2.4" /><circle cx="12" cy="13.2" r="3.1" /><path d="M9 7l1.2-2h3.6L15 7" /></svg>
            {t.takePhoto}
          </label>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">{t.uploadFormats}</p>

        {files.length > 0 && (
          <div className="mt-5">
            <p className="text-[11px] uppercase tracking-[.14em] text-slate-500">{t.filesHeading}</p>
            <ul className="mt-2.5 grid gap-2">
              {files.map((file, index) => (
                <li key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-3 rounded-2xl border border-white/[.07] bg-black/30 px-3.5 py-2.5" data-testid="intake-file">
                  <span className="min-w-0 flex-1 truncate text-[14px] text-slate-100">{file.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-slate-500">{formatBytes(file.size)}</span>
                  <button
                    type="button"
                    onClick={() => setFiles(files.filter((_, i) => i !== index))}
                    data-testid="intake-file-remove"
                    className="min-h-[32px] shrink-0 rounded-lg border border-white/[.08] px-2.5 text-[11px] font-medium text-slate-400 transition hover:border-red-300/30 hover:text-red-200"
                  >
                    {t.remove}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 3 — Live intelligence, editable */}
      <section className="mt-5 rounded-3xl border border-white/[.07] bg-white/[.02] p-5 backdrop-blur-xl sm:p-7" data-testid="intake-detected">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,.6)] motion-safe:animate-pulse" />
          <h2 className="text-[17px] font-semibold tracking-tight text-white sm:text-[19px]">{t.detectedHeading}</h2>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-400">{t.detectedHelper}</p>

        {visibleFields.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-white/[.06] bg-black/25 px-4 py-5 text-center text-[13px] text-slate-500" data-testid="intake-detected-empty">
            {t.detectedEmpty}
          </p>
        ) : (
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {visibleFields.map((field) => (
              <label key={field} className="grid gap-1.5" data-field={field}>
                <span className="text-[11px] uppercase tracking-[.1em] text-slate-500">{t.fields[field]}</span>
                <input
                  value={effective[field] ?? ""}
                  onChange={(event) => setEdits((current) => ({ ...current, [field]: event.target.value.slice(0, 200) }))}
                  data-testid={`intake-field-${field}`}
                  className="min-h-[44px] w-full rounded-xl border border-white/[.09] bg-black/35 px-3.5 text-[14px] text-slate-100 focus:border-cyan-300/45 focus:outline-none focus:ring-2 focus:ring-cyan-300/15"
                />
              </label>
            ))}
          </div>
        )}
      </section>

      {/* 4 — Submit */}
      <section className="mt-6">
        <p className="text-center text-[12.5px] leading-relaxed text-slate-400">{t.submitHelper}</p>
        {error && (
          <p className="mt-3 rounded-2xl border border-red-400/25 bg-red-400/[.07] px-4 py-3 text-center text-[13px] text-red-200" role="alert" data-testid="intake-error">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          data-testid="intake-submit"
          className="mt-4 flex min-h-[56px] w-full items-center justify-center rounded-2xl border border-[#e3c884]/40 bg-gradient-to-b from-[#e3c884] to-[#b8934a] text-[16px] font-semibold text-[#1b1403] shadow-[0_18px_44px_-20px_rgba(227,200,132,.6)] transition hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? t.submitting : t.submit}
        </button>
      </section>
    </ClientIntakeShell>
  );
}
