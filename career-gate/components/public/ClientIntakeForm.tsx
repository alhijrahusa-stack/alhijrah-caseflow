"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ClientIntakeBrand, ClientIntakeShell, GlassCard } from "@/components/public/ClientIntakeShell";
import {
  CASE_STATUS_PATH,
  INTAKE_COPY,
  OFFICE_WHATSAPP_DISPLAY,
  OFFICE_WHATSAPP_URL,
  type IntakeLocale,
} from "@/components/public/intake-copy";
import { FIELD_GROUPS, FIELD_INPUT, validateIntakeField } from "@/components/public/intake-validate";
import { LocaleToggle } from "@/components/public/LocaleToggle";
import { SmartGuide, type GuideContext } from "@/components/public/SmartGuide";
import { CLIENT_EDITABLE_FIELDS, type ClientEditableField } from "@/lib/client-intake-fields";
import { SMART_IMPORT_LIMITS } from "@/lib/smart-client-import-core";
import { extractDeterministicClient } from "@/lib/smart-client-local";

/**
 * The client's own intake surface.
 *
 * It reuses the existing deterministic Smart intelligence
 * (`extractDeterministicClient`) to show what it read from the text as the
 * client types — there is no second extraction engine, no second submit path
 * and no second document path. Upload limits and accepted types are the
 * existing Smart import limits.
 *
 * Everything the client entered survives a language switch and a failed
 * submission: the state lives above the locale, and a failure never clears it.
 */

const ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const ACCEPT_ATTR = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Detected = Partial<Record<ClientEditableField, string>>;
/** A chosen document. The preview URL is local; nothing is uploaded until submit. */
type Attachment = { id: string; file: File; previewUrl: string | null };

function attach(file: File): Attachment {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    file,
    previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
  };
}

export function ClientIntakeForm({ token, targetCaseNumber = null }: { token: string; targetCaseNumber?: string | null }) {
  const [locale, setLocale] = useState<IntakeLocale>("ar");
  const t = INTAKE_COPY[locale];

  const [sourceText, setSourceText] = useState("");
  const [debounced, setDebounced] = useState("");
  // Only the fields the client actually changed. Everything else keeps showing
  // whatever the deterministic read produced.
  const [edits, setEdits] = useState<Detected>({});
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [existingCaseNumber, setExistingCaseNumber] = useState(targetCaseNumber ?? "");
  const [manualMode, setManualMode] = useState(false);
  const linkedCase = Boolean(targetCaseNumber);
  const [duplicateIdentity, setDuplicateIdentity] = useState(false);
  const [sharedEmailWarning, setSharedEmailWarning] = useState(false);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractionNotice, setExtractionNotice] = useState<string | null>(null);
  const [importedFields, setImportedFields] = useState<ClientEditableField[]>([]);
  const [caseNumber, setCaseNumber] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [touchedDocuments, setTouchedDocuments] = useState(false);
  const inFlight = useRef(false);
  const replacingId = useRef<string | null>(null);
  const replaceInput = useRef<HTMLInputElement | null>(null);
  const extractionVersion = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(sourceText), 180);
    return () => clearTimeout(timer);
  }, [sourceText]);

  // Object URLs are released when the component goes away, so a long session
  // does not accumulate them.
  useEffect(() => () => {
    for (const item of attachments) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }, [attachments]);

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

  const fieldErrors = useMemo(() => {
    const out: Partial<Record<ClientEditableField, string>> = {};
    for (const field of CLIENT_EDITABLE_FIELDS) {
      const problem = validateIntakeField(field, effective[field] ?? "", t);
      if (problem) out[field] = problem;
    }
    return out;
  }, [effective, t]);

  useEffect(() => {
    if (linkedCase) return;
    const email = (effective.email ?? "").trim().toLowerCase();
    const caseNumber = existingCaseNumber.trim().toUpperCase();
    const validEmail = email && !validateIntakeField("email", email, t) ? email : "";
    const validCase = /^CG-[0-9]{4}-[0-9]{6}$/.test(caseNumber) ? caseNumber : "";
    if (!validEmail && !validCase) {
      const reset = setTimeout(() => {
        setDuplicateIdentity(false);
        setSharedEmailWarning(false);
        setCheckingDuplicate(false);
      }, 0);
      return () => clearTimeout(reset);
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setCheckingDuplicate(true);
      try {
        const res = await fetch(`/api/public/client-intake/${encodeURIComponent(token)}/duplicate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: validEmail || undefined,
            caseNumber: validCase || undefined,
            fullName: effective.full_name || undefined,
            dateOfBirth: effective.date_of_birth || undefined,
            phone: effective.phone || undefined,
          }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.ok) {
          setDuplicateIdentity(data.duplicate === true);
          setSharedEmailWarning(data.shared_email === true);
        }
      } catch {
        if (!controller.signal.aborted) {
          setDuplicateIdentity(false);
          setSharedEmailWarning(false);
        }
      } finally {
        if (!controller.signal.aborted) setCheckingDuplicate(false);
      }
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [effective.email, effective.full_name, effective.date_of_birth, effective.phone, existingCaseNumber, t, token, linkedCase]);

  const started = Boolean(sourceText.trim());
  const hasAnything = started || attachments.length > 0 || Object.values(edits).some((value) => Boolean(value?.trim()));
  const blocked = Object.keys(fieldErrors).length > 0 || duplicateIdentity;

  /**
   * Once the client has entered anything, every reviewed field is shown — the
   * detected ones filled, the rest empty. Showing only what was detected would
   * leave a field the extraction missed invisible and impossible to supply,
   * which defeats the point of letting the client correct their own details.
   */
  const showReview = manualMode || started || Object.keys(edits).length > 0 || importedFields.length > 0;
  const visible = useMemo(
    () => new Set<ClientEditableField>(showReview ? CLIENT_EDITABLE_FIELDS : []),
    [showReview],
  );

  // One deterministic lookup: the context follows what the client has done.
  const guideContext: GuideContext = blocked
    ? "issue"
    : started && attachments.length > 0
      ? "ready"
      : attachments.length > 0 || touchedDocuments
        ? started ? "review" : "start"
        : started
          ? "documents"
          : "welcome";

  async function extractFromDocuments(next: Attachment[]) {
    if (!next.length) return;
    const version = ++extractionVersion.current;
    setExtracting(true);
    setExtractionNotice(t.extractingDocument);
    try {
      const form = new FormData();
      for (const item of next) form.append("files", item.file);
      const res = await fetch(`/api/public/client-intake/${encodeURIComponent(token)}/extract`, { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (version !== extractionVersion.current) return;
      if (!res.ok || !data?.ok) {
        setExtractionNotice(typeof data?.error?.message === "string" ? data.error.message : t.extractionUnavailable);
        return;
      }
      const fields = (data.fields && typeof data.fields === "object" ? data.fields : {}) as Detected;
      const keys = Object.keys(fields).filter((field): field is ClientEditableField =>
        (CLIENT_EDITABLE_FIELDS as readonly string[]).includes(field),
      );
      setEdits((current) => ({ ...fields, ...current }));
      setImportedFields(keys);
      setExtractionNotice(keys.length ? t.importedSuccess : t.noDataImported);
    } catch {
      if (version === extractionVersion.current) setExtractionNotice(t.extractionUnavailable);
    } finally {
      if (version === extractionVersion.current) setExtracting(false);
    }
  }

  function admit(incoming: FileList | null) {
    if (!incoming?.length) return;
    setError(null);
    setTouchedDocuments(true);
    const next = [...attachments];
    for (const file of Array.from(incoming)) {
      if (!ACCEPTED_MIME.includes(file.type)) { setError(t.unsupported); continue; }
      if (file.size > SMART_IMPORT_LIMITS.maxFileBytes) { setError(t.fileTooLarge); continue; }
      if (next.length >= SMART_IMPORT_LIMITS.maxFiles) { setError(t.tooManyFiles); break; }
      const candidate = attach(file);
      if (next.some((item) => item.id === candidate.id)) { if (candidate.previewUrl) URL.revokeObjectURL(candidate.previewUrl); continue; }
      next.push(candidate);
    }
    if (next.reduce((sum, item) => sum + item.file.size, 0) > SMART_IMPORT_LIMITS.maxTotalUploadBytes) {
      setError(t.totalTooLarge);
      return;
    }
    setAttachments(next);
    void extractFromDocuments(next);
  }

  function remove(id: string) {
    extractionVersion.current += 1;
    setExtracting(false);
    setAttachments((current) => {
      const going = current.find((item) => item.id === id);
      if (going?.previewUrl) URL.revokeObjectURL(going.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  function replace(incoming: FileList | null) {
    const target = replacingId.current;
    replacingId.current = null;
    if (!incoming?.length || !target) return;
    const file = incoming[0];
    if (!ACCEPTED_MIME.includes(file.type)) { setError(t.unsupported); return; }
    if (file.size > SMART_IMPORT_LIMITS.maxFileBytes) { setError(t.fileTooLarge); return; }
    setError(null);
    const next = attachments.map((item) => {
      if (item.id !== target) return item;
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return attach(file);
    });
    setAttachments(next);
    void extractFromDocuments(next);
  }

  async function submit() {
    if (inFlight.current) return;
    if (!hasAnything) { setError(t.needSomething); return; }
    if (blocked) { setError(null); return; }
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
      for (const item of attachments) form.append("files", item.file);
      if (existingCaseNumber.trim()) form.set("case_number", existingCaseNumber.trim().toUpperCase());

      const res = await fetch(`/api/public/client-intake/${encodeURIComponent(token)}`, { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        if (data?.error?.code === "duplicate_application") {
          setDuplicateIdentity(true);
          setError(null);
          return;
        }
        // Nothing the client entered is cleared: the exact reason is shown and
        // they can correct and retry.
        setError(typeof data?.error?.message === "string" ? data.error.message : t.genericError);
        return;
      }
      setCaseNumber(typeof data.case_number === "string" ? data.case_number : null);
      setSharedEmailWarning(data.shared_email_warning === true);
      setDone(true);
    } catch {
      setError(t.genericError);
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }

  const header = (
    <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <ClientIntakeBrand title={t.brand} subtitle={t.office} />
      <LocaleToggle locale={locale} onChange={setLocale} />
    </header>
  );

  if (done) {
    return (
      <ClientIntakeShell dir={t.dir}>
        {header}
        <GlassCard tone="success" className="mt-8 text-center" data-testid="intake-success" role="status">
          <div aria-hidden="true" className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-emerald-400/40 bg-emerald-100 text-emerald-700">
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12.8 9.4 17 19 7.4" /></svg>
          </div>
          <h1 className="mt-5 text-[23px] font-semibold tracking-tight text-slate-900 sm:text-[27px]">{t.successHeading}</h1>
          <p className="mx-auto mt-3 max-w-[48ch] text-[15px] leading-relaxed text-slate-600">{t.successBody}</p>
          <p className="mx-auto mt-2 max-w-[48ch] text-[14px] leading-relaxed text-slate-500">{t.successGuidance}</p>
          {caseNumber && (
            <div className="mx-auto mt-5 max-w-sm rounded-2xl border border-[#ff9f1a]/35 bg-gradient-to-b from-[#fff8eb] to-white px-5 py-4 shadow-[0_18px_42px_-28px_rgba(255,132,0,.65)]" data-testid="intake-case-number">
              <p className="text-[12px] font-semibold uppercase tracking-[.12em] text-slate-500">{t.caseNumberLabel}</p>
              <p className="mt-1 font-mono text-[22px] font-semibold tracking-[.04em] text-[#0a2d63]">{caseNumber}</p>
            </div>
          )}

          {sharedEmailWarning && (
            <div className="mx-auto mt-5 max-w-xl rounded-2xl border border-[#2f6fd0]/25 bg-[#eef5ff] px-5 py-4 text-center" data-testid="intake-shared-email-success">
              <p className="text-[15px] font-semibold text-[#0a2d63]">{t.sharedEmailHeading}</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-700">{t.sharedEmailBody}</p>
            </div>
          )}

          <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
            <a
              href={caseNumber ? `${CASE_STATUS_PATH}?ref=${encodeURIComponent(caseNumber)}` : CASE_STATUS_PATH}
              data-testid="intake-case-status"
              className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-[#2f6fd0]/35 bg-[#2f6fd0] px-4 text-[15px] font-semibold text-white shadow-[0_14px_34px_-18px_rgba(47,111,208,.7)] transition-[filter] duration-200 hover:brightness-105 motion-reduce:transition-none"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
              {t.caseStatus}
            </a>
            <a
              href={OFFICE_WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="intake-whatsapp"
              className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-emerald-500/35 bg-white px-4 text-[15px] font-semibold text-emerald-800 shadow-[0_10px_28px_-18px_rgba(16,122,87,.5)] transition-colors duration-200 hover:bg-emerald-50 motion-reduce:transition-none"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 11.7a7.9 7.9 0 0 1-11.6 7l-4 1.2 1.2-3.9A7.9 7.9 0 1 1 20 11.7Z" /></svg>
              {t.whatsappOffice}
            </a>
          </div>

          <p className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-[13px] text-slate-500" data-testid="intake-closed-note">
            {t.successClosed}
          </p>
        </GlassCard>
        <SmartGuide t={t} context="success" />
      </ClientIntakeShell>
    );
  }

  return (
    <ClientIntakeShell dir={t.dir}>
      {header}

      <div className="mt-5">
        <h1 className="break-words text-[24px] font-semibold tracking-tight text-[#f6e6b8] sm:text-[30px]">{t.heading}</h1>
        <p className="mt-2 max-w-[68ch] text-[14px] leading-relaxed text-slate-200">{t.lead}</p>
        <div className="mt-3 flex flex-wrap gap-2" role="status" aria-label="Intake progress"><span className="rounded-full border border-[#c5a059]/40 bg-[#0a122c]/70 px-3 py-2 text-[12px] text-[#f4dcac]">{attachments.length ? "✓ " : "1 · "}{locale === "ar" ? "المستندات" : "Documents"}</span><span className="rounded-full border border-[#c5a059]/30 bg-[#0a122c]/70 px-3 py-2 text-[12px] text-slate-100">{showReview ? "✓ " : "2 · "}{locale === "ar" ? "مراجعة البيانات" : "Review"}</span><span className="rounded-full border border-[#c5a059]/30 bg-[#0a122c]/70 px-3 py-2 text-[12px] text-slate-100">3 · {locale === "ar" ? "الإرسال" : "Submit"}</span></div>
      </div>

      {/* 1 — Document first: extract and auto-fill */}
      <div className="mt-5 grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 lg:gap-5" data-testid="intake-entry-grid">
      <GlassCard tone="accent" className="min-w-0" data-testid="intake-upload">
        <div className="flex items-start gap-3">
          <div aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[#d8b96a]/50 bg-white text-[#9c7a2e] shadow-[0_8px_20px_-14px_rgba(184,147,74,.7)]">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 16.5V5.5" /><path d="M7.8 9.7 12 5.5l4.2 4.2" /><path d="M5 16.5v1.8A2.2 2.2 0 0 0 7.2 20.5h9.6a2.2 2.2 0 0 0 2.2-2.2v-1.8" /></svg>
          </div>
          <div className="min-w-0">
            <h2 className="text-[21px] font-semibold tracking-tight text-slate-900 sm:text-[24px]">{t.uploadHeading}</h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-slate-600">{t.uploadHelper}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
          <label className="flex min-h-[56px] cursor-pointer items-center justify-center gap-2 rounded-2xl border border-[#c79f4f] bg-gradient-to-b from-[#e6c87f] to-[#c79f4f] px-4 text-[16px] font-semibold text-[#2a2008] shadow-[0_14px_32px_-18px_rgba(184,147,74,.8)] transition-[filter] duration-200 hover:brightness-105 focus-within:ring-4 focus-within:ring-[#c79f4f]/30 motion-reduce:transition-none">
            <input type="file" multiple accept={ACCEPT_ATTR} className="sr-only" data-testid="intake-choose-files" onChange={(event) => { admit(event.target.files); event.target.value = ""; }} />
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h3l2 2.5h6A2.5 2.5 0 0 1 20 10v6.5A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5Z" /></svg>
            {t.chooseFiles}
          </label>

          {/* The device's own camera, through a capture input — no SDK. */}
          <label className="flex min-h-[56px] cursor-pointer items-center justify-center gap-2 rounded-2xl border border-[#2f6fd0]/40 bg-white px-4 text-[16px] font-semibold text-[#1f4f9c] shadow-[0_10px_26px_-18px_rgba(47,111,208,.6)] transition-colors duration-200 hover:bg-[#f2f7ff] focus-within:ring-4 focus-within:ring-[#2f6fd0]/20 motion-reduce:transition-none">
            <input type="file" accept="image/*" capture="environment" className="sr-only" data-testid="intake-take-photo" onChange={(event) => { admit(event.target.files); event.target.value = ""; }} />
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3.5" y="7" width="17" height="12.5" rx="2.4" /><circle cx="12" cy="13.2" r="3.1" /><path d="M9 7l1.2-2h3.6L15 7" /></svg>
            {t.takePhoto}
          </label>
        </div>
        <p className="mt-3 text-[12px] text-slate-500">{t.uploadFormats}</p>
        {(extracting || extractionNotice) && (
          <div
            className={`mt-4 flex items-center gap-3 rounded-2xl border px-4 py-3 text-[14px] shadow-[0_10px_28px_-22px_rgba(10,45,99,.45)] ${
              extracting
                ? "border-[#2f6fd0]/25 bg-[#eef5ff] text-[#194b91]"
                : "border-[#ff9f1a]/30 bg-[#fff8eb] text-[#754300]"
            }`}
            role="status"
            data-testid="intake-extraction-status"
          >
            <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              extracting ? "bg-[#2f6fd0] motion-safe:animate-pulse" : "bg-[#ff8a00]"
            }`} />
            <span>{extracting ? t.extractingDocument : extractionNotice}</span>
          </div>
        )}

        {/* One hidden input serves every Replace action. */}
        <input ref={replaceInput} type="file" accept={ACCEPT_ATTR} className="sr-only" aria-hidden="true" tabIndex={-1} onChange={(event) => { replace(event.target.files); event.target.value = ""; }} />

        {attachments.length > 0 && (
          <div className="mt-5">
            <p className="text-[12px] font-semibold uppercase tracking-[.1em] text-slate-500">{t.filesHeading}</p>
            <ul className="mt-2.5 grid gap-2">
              {attachments.map((item) => (
                <li key={item.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-[0_6px_18px_-14px_rgba(23,42,77,.3)]" data-testid="intake-file">
                  <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-slate-400">
                    {item.previewUrl
                      ? <img src={item.previewUrl} alt="" className="h-full w-full object-cover" data-testid="intake-file-preview" />
                      : <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M7 3.5h7L19 8.5v12H7Z" /><path d="M14 3.5v5h5" /></svg>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] text-slate-800">{item.file.name}</span>
                    <span className="mt-0.5 block font-mono text-[11px] text-slate-500">{formatBytes(item.file.size)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => { replacingId.current = item.id; replaceInput.current?.click(); }}
                    data-testid="intake-file-replace"
                    className="min-h-[40px] shrink-0 rounded-xl border border-slate-300 px-3 text-[12px] font-semibold text-slate-600 transition-colors duration-200 hover:bg-slate-50 motion-reduce:transition-none"
                  >
                    {t.replace}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    data-testid="intake-file-remove"
                    className="min-h-[40px] shrink-0 rounded-xl border border-slate-300 px-3 text-[12px] font-semibold text-slate-600 transition-colors duration-200 hover:border-red-300 hover:bg-red-50 hover:text-red-700 motion-reduce:transition-none"
                  >
                    {t.remove}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </GlassCard>

      {/* 2 — Complete anything the document did not provide */}
      <GlassCard className="min-w-0" data-testid="intake-source">
        <h2 className="text-[20px] font-semibold tracking-tight text-slate-900 sm:text-[22px]">{t.sourceHeading}</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-slate-500">{t.sourceHelper}</p>
        <label className="mt-4 grid gap-1.5">
          <span className="text-[13px] font-medium text-slate-600">{t.existingCaseLabel}</span>
          <input
            readOnly={linkedCase}
            value={existingCaseNumber}
            onChange={(event) => {
              if (linkedCase) return;
              setExistingCaseNumber(event.target.value.toUpperCase().slice(0, 20));
              setDuplicateIdentity(false);
              setSharedEmailWarning(false);
            }}
            placeholder={t.existingCasePlaceholder}
            aria-description={linkedCase ? (locale === "ar" ? "رقم الملف الأصلي مرتبط بهذا الرابط بواسطة المكتب ولا يمكن تغييره." : "The office has linked this reference to your file; it cannot be changed.") : undefined}
            autoComplete="off"
            data-testid="intake-existing-case-number"
            className="min-h-[48px] w-full rounded-xl border border-slate-300 bg-white px-3.5 font-mono text-[16px] tracking-[.03em] text-slate-800 placeholder:text-slate-400 focus:border-[#2f6fd0] focus:outline-none focus:ring-4 focus:ring-[#2f6fd0]/15"
          />
        </label>
        <textarea
          value={sourceText}
          onChange={(event) => setSourceText(event.target.value.slice(0, SMART_IMPORT_LIMITS.maxRawTextLength))}
          placeholder={t.sourcePlaceholder}
          rows={9}
          aria-label={t.sourceHeading}
          data-testid="intake-source-text"
          className="mt-4 w-full resize-y rounded-2xl border border-slate-300 bg-white p-4 text-[16px] leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-[#2f6fd0] focus:outline-none focus:ring-4 focus:ring-[#2f6fd0]/15"
        />
      </GlassCard>
      </div>

      {/* 3 — Review what was understood */}
      <GlassCard className="mt-5 min-w-0" data-testid="intake-detected">
        <h2 className="text-[19px] font-semibold tracking-tight text-slate-900 sm:text-[21px]">{t.detectedHeading}</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-slate-500">{t.detectedHelper}</p>

        {visible.size === 0 && <button type="button" onClick={() => setManualMode(true)} className="mt-3 min-h-[44px] rounded-xl border border-[#c5a059]/60 bg-[#fdf5e3] px-4 text-[13px] font-semibold text-[#6e5120]" data-testid="intake-manual-entry">{locale === "ar" ? "إدخال البيانات يدويًا" : "Enter details manually"}</button>}
        {visible.size === 0 ? (
          <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-[14px] text-slate-500" data-testid="intake-detected-empty">
            {t.detectedEmpty}
          </p>
        ) : (
          <div className="mt-4 grid gap-5">
            {FIELD_GROUPS.map((group) => {
              const fields = group.fields.filter((field) => visible.has(field));
              if (!fields.length) return null;
              const label = group.key === "identity" ? t.groupIdentity : group.key === "contact" ? t.groupContact : group.key === "address" ? t.groupAddress : group.key === "work" ? t.groupWork : t.groupLanguage;
              return (
                <fieldset key={group.key} className="grid min-w-0 gap-2.5 sm:grid-cols-2 xl:grid-cols-3" data-group={group.key}>
                  <legend className="col-span-full text-[12px] font-semibold uppercase tracking-[.1em] text-slate-500">{label}</legend>
                  {fields.map((field) => {
                    const problem = fieldErrors[field];
                    const input = FIELD_INPUT[field];
                    return (
                      <label key={field} className="grid min-w-0 gap-1.5" data-field={field}>
                        <span className="flex items-center justify-between gap-2 text-[13px] font-medium text-slate-600">
                          <span>{t.fields[field]}</span>
                          {importedFields.includes(field) && (
                            <span className="rounded-full border border-[#ff9f1a]/30 bg-[#fff4df] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.08em] text-[#9a5a00]">
                              {t.importedField}
                            </span>
                          )}
                        </span>
                        <input
                          value={effective[field] ?? ""}
                          onChange={(event) => {
                            setEdits((current) => ({ ...current, [field]: event.target.value.slice(0, 200) }));
                            if (field === "email" || field === "full_name" || field === "date_of_birth" || field === "phone") {
                              setDuplicateIdentity(false);
                              setSharedEmailWarning(false);
                            }
                          }}
                          type={input.type ?? "text"}
                          inputMode={input.inputMode}
                          autoComplete={input.autoComplete}
                          aria-invalid={problem ? true : undefined}
                          aria-describedby={problem ? `intake-error-${field}` : undefined}
                          data-testid={`intake-field-${field}`}
                          className={`min-h-[48px] min-w-0 w-full rounded-xl border bg-white px-3.5 text-[16px] text-slate-800 focus:outline-none focus:ring-4 ${
                            problem
                              ? "border-red-400 focus:border-red-500 focus:ring-red-500/15"
                              : importedFields.includes(field)
                                ? "border-[#ff9f1a]/55 bg-[#fffdf8] focus:border-[#ff8a00] focus:ring-[#ff9f1a]/15"
                                : "border-slate-300 focus:border-[#2f6fd0] focus:ring-[#2f6fd0]/15"
                          }`}
                        />
                        {problem && (
                          <span id={`intake-error-${field}`} role="alert" data-testid={`intake-error-${field}`} className="flex items-start gap-1.5 text-[12.5px] text-red-700">
                            <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="12" cy="12" r="8.5" /><path d="M12 8v4.5" /><path d="M12 16h.01" /></svg>
                            {problem}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </fieldset>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* 4 — Submit */}
      <div className="mt-6">
        <p className="text-center text-[13px] leading-relaxed text-slate-500">{t.submitHelper}</p>
        {checkingDuplicate && (
          <p className="mt-3 rounded-2xl border border-[#2f6fd0]/20 bg-[#eef5ff] px-4 py-3 text-center text-[14px] text-[#194b91]" role="status" data-testid="intake-duplicate-checking">
            {t.checkingDuplicate}
          </p>
        )}
        {sharedEmailWarning && !duplicateIdentity && (
          <div className="mt-3 rounded-2xl border border-[#2f6fd0]/25 bg-[#eef5ff] px-4 py-4 text-center shadow-[0_14px_34px_-26px_rgba(47,111,208,.55)]" role="status" data-testid="intake-shared-email-alert">
            <p className="text-[16px] font-semibold text-[#0a2d63]">{t.sharedEmailHeading}</p>
            <p className="mx-auto mt-1.5 max-w-[48ch] text-[13.5px] leading-relaxed text-slate-700">{t.sharedEmailBody}</p>
          </div>
        )}
        {duplicateIdentity && (
          <div className="mt-3 rounded-2xl border border-[#b87975]/45 bg-[#fff3f1] px-4 py-4 text-center shadow-[0_14px_34px_-26px_rgba(158,91,83,.28)]" role="alert" data-testid="intake-duplicate-alert">
            <p className="text-[16px] font-semibold text-[#0a2d63]">{t.duplicateHeading}</p>
            <p className="mx-auto mt-1.5 max-w-[46ch] text-[13.5px] leading-relaxed text-slate-700">{t.duplicateBody}</p>
            <a
              href={OFFICE_WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mx-auto mt-3 inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-white px-4 text-[14px] font-semibold text-emerald-800 shadow-[0_10px_24px_-18px_rgba(16,122,87,.55)]"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 11.7a7.9 7.9 0 0 1-11.6 7l-4 1.2 1.2-3.9A7.9 7.9 0 1 1 20 11.7Z" /></svg>
              <span>{t.whatsappOffice} · {OFFICE_WHATSAPP_DISPLAY}</span>
            </a>
          </div>
        )}
        {error && !duplicateIdentity && (
          <p className="mt-3 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-center text-[14px] text-red-800" role="alert" data-testid="intake-error">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || blocked || checkingDuplicate}
          data-testid="intake-submit"
          className="mt-4 flex min-h-[58px] w-full items-center justify-center rounded-2xl border border-[#1f4f9c]/40 bg-gradient-to-b from-[#3f7fe0] to-[#2258b4] text-[17px] font-semibold text-white shadow-[0_20px_44px_-20px_rgba(34,88,180,.75)] transition-[filter,opacity] duration-200 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none"
        >
          {busy ? t.submitting : t.submit}
        </button>
        <a
          href={OFFICE_WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="intake-whatsapp-help"
          className="mt-3 flex min-h-[44px] items-center justify-center gap-2 text-[13.5px] font-medium text-emerald-800 underline-offset-4 hover:underline"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 11.7a7.9 7.9 0 0 1-11.6 7l-4 1.2 1.2-3.9A7.9 7.9 0 1 1 20 11.7Z" /></svg>
          {t.whatsappOffice}
        </a>
      </div>

      <SmartGuide t={t} context={guideContext} />
    </ClientIntakeShell>
  );
}
