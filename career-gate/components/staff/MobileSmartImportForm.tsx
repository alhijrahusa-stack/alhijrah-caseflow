"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DigitalHandshake, useDigitalHandshake } from "@/components/staff/smart/DigitalHandshake";
import {
  SMART_FIELDS,
  SMART_FIELD_GROUPS,
  SMART_REQUIRED_FIELDS,
  smartAuthorityClass,
  smartFieldText,
  smartRequiredReadiness,
  smartStateClass,
  type SmartEvidence,
  type SmartField,
  type SmartFieldState,
} from "@/components/staff/smart/field-contract";
import {
  SMART_DOCUMENT_ACCEPT,
  SMART_DOCUMENT_POLICY,
  admitDocuments,
  advanceDocuments,
  documentStatusLabel,
  documentTotals,
  formatDocumentSize,
  releaseDocuments,
  removeDocument,
  type QueuedDocument,
} from "@/components/staff/smart/document-queue";
import { DocumentIcon, PreviewIcon, RemoveIcon, VolumeOffIcon, VolumeOnIcon } from "@/components/staff/smart/icons";
import { VoiceDictation } from "@/components/staff/smart/VoiceDictation";
import { SmartProgressRail, type RailState } from "@/components/staff/smart/SmartProgressRail";
import { isOvernightShift } from "@/lib/smart-client-fields";
import {
  localDisplayValue,
  localProvenance,
  readLocalFields,
  sourceMatchState,
  type LocalFieldReading,
} from "@/components/staff/smart/intelligence";
import { extractDeterministicClient } from "@/lib/smart-client-local";

const AUDIO_PREF_KEY = "career-gate-smart-import-audio";
const SOURCE_DEBOUNCE_MS = 200;
const MAX_SOURCE_LENGTH = 10000;

type Stage = "DRAFT" | "CAPTURING" | "CAPTURED" | "ENRICHING" | "REVIEW_REQUIRED" | "READY";
type TelemetryStatus = "CAPTURING" | "PROCESSING" | "REVIEW_REQUIRED" | "READY_TO_REVIEW" | "READY_TO_SUBMIT" | "SUBMITTING" | "COMPLETE";
type SubmitResult = {
  case_id: string;
  created_at: string;
  uploaded_by_name: string;
  mapped_draft?: { profile?: Record<string, unknown>; review_fields?: Record<string, unknown> };
  verification_result?: Record<string, unknown>;
  field_evidence?: SmartEvidence[];
  enrichment_url?: string | null;
  enrichment_error?: string | null;
};
type IssueAction = "ADD_FILES" | "RETRY_EXTRACTION";
type Issue = { id: string; scope: string; problem: string; action: string; actionKind?: IssueAction; actionLabel?: string };

function formatElapsed(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function telemetryStatus(stage: Stage, hasSource: boolean): TelemetryStatus {
  switch (stage) {
    case "CAPTURING": return "SUBMITTING";
    case "CAPTURED":
    case "ENRICHING": return "PROCESSING";
    case "REVIEW_REQUIRED": return "REVIEW_REQUIRED";
    case "READY": return "READY_TO_REVIEW";
    default: return hasSource ? "READY_TO_SUBMIT" : "CAPTURING";
  }
}

const STATUS_TONE: Record<TelemetryStatus, string> = {
  CAPTURING: "border-white/12 bg-white/[.03] text-slate-300",
  READY_TO_SUBMIT: "border-[#d4b06a]/40 bg-[#b8934a]/[.12] text-[#f0d99d]",
  SUBMITTING: "border-cyan-300/35 bg-cyan-300/[.10] text-cyan-200",
  PROCESSING: "border-cyan-300/35 bg-cyan-300/[.10] text-cyan-200",
  REVIEW_REQUIRED: "border-amber-300/35 bg-amber-300/[.10] text-amber-200",
  READY_TO_REVIEW: "border-emerald-300/35 bg-emerald-300/[.10] text-emerald-200",
  COMPLETE: "border-emerald-300/35 bg-emerald-300/[.10] text-emerald-200",
};

/** The viewer's motion preference, read at the moment it matters. */
function prefersReducedMotionNow() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const NOTES_FIELD = SMART_FIELDS.find((field) => field.key === "additional_notes")!;
const SHIFT_START_FIELD = SMART_FIELDS.find((field) => field.key === "shift_start_time")!;
const SHIFT_END_FIELD = SMART_FIELDS.find((field) => field.key === "shift_end_time")!;

/** Captured job preferences and English proficiency, in contract order. */
const JOB_PREFERENCE_FIELDS: readonly SmartField[] = SMART_FIELD_GROUPS
  .filter((group) => group.title === "JOB PREFERENCES" || group.title === "LANGUAGE & ENGLISH")
  .flatMap((group) => group.fields)
  .filter((field) => field.key !== "preferred_language");

const CORE_INTELLIGENCE_GROUPS = SMART_FIELD_GROUPS
  .map((group) => ({
    ...group,
    fields: group.fields.filter((field) => !JOB_PREFERENCE_FIELDS.some((preference) => preference.key === field.key)),
  }))
  .filter((group) => group.fields.length > 0);

/** Level 2 depth: a major functional panel. */
const PANEL =
  "relative overflow-hidden rounded-[22px] border border-[#b8934a]/[.14] bg-[linear-gradient(145deg,rgba(12,35,68,.76),rgba(4,11,25,.72))] shadow-[0_24px_70px_-30px_rgba(0,0,0,.78),inset_0_1px_0_rgba(255,255,255,.065)] backdrop-blur-xl transition-transform duration-200 will-change-transform motion-reduce:transition-none hover:-translate-y-[3px] hover:scale-[1.004] hover:border-[#d4b06a]/25 focus-within:translate-y-0 focus-within:scale-100";
/** An active panel carries a stronger edge and a faint local illumination. */
const PANEL_ACTIVE = "!border-[#d4b06a]/35 shadow-[0_26px_74px_-30px_rgba(0,0,0,.8),inset_0_1px_0_rgba(255,255,255,.085),0_0_0_1px_rgba(227,200,132,.07)]";
/** Level 3 depth: an inner information surface. */
const INNER = "rounded-2xl border border-white/[.08] bg-black/25";

export function MobileSmartImportForm({ staff }: { staff: { display_name: string } }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionStart = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const documentsRef = useRef<QueuedDocument[]>([]);
  const ambientRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);

  const [elapsed, setElapsed] = useState(0);
  const [documents, setDocuments] = useState<QueuedDocument[]>([]);
  const [rejected, setRejected] = useState<{ name: string; reason: string }[]>([]);
  const [notes, setNotes] = useState("");
  const [debouncedNotes, setDebouncedNotes] = useState("");
  const [stage, setStage] = useState<Stage>("DRAFT");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [serverDraft, setServerDraft] = useState<Record<string, unknown> | null>(null);
  const [serverEvidence, setServerEvidence] = useState<SmartEvidence[]>([]);
  const [verification, setVerification] = useState<Record<string, unknown> | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  /** Increments on each blocked submit so the rail reacts exactly once per attempt. */
  const [warningNonce, setWarningNonce] = useState(0);
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null);
  const { sweep, trigger: handshake } = useDigitalHandshake();

  const totals = useMemo(() => documentTotals(documents), [documents]);
  const busy = stage === "CAPTURING" || stage === "ENRICHING";
  const submitted = Boolean(result);
  const sourceSettling = debouncedNotes !== notes;
  const hasSource = Boolean(notes.trim() || documents.length);

  // The latest queue is mirrored for unmount cleanup, which runs after the last render.
  useEffect(() => { documentsRef.current = documents; }, [documents]);

  // Warm the OCR model after rendering, before a document is selected.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) void import("@/lib/browser-paddle-ocr")
        .then(({ prepareDocumentOcr }) => prepareDocumentOcr())
        .catch(() => undefined);
    }, 750);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  // Audio preference is read after mount, so the server render never depends on storage
  // and the button cannot hydrate with the wrong pressed state.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setAudioEnabled(window.localStorage.getItem(AUDIO_PREF_KEY) === "on"); } catch { /* storage unavailable */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!sessionStart.current) sessionStart.current = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - (sessionStart.current || Date.now())) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Local deterministic extraction runs on a 200 ms debounce: never per keystroke,
  // and never OCR or provider enrichment.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedNotes(notes), SOURCE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [notes]);

  // Ambient atmosphere is paused while the tab is hidden or the window is unfocused.
  // One listener per visibility change, never a render loop.
  useEffect(() => {
    const apply = () => {
      const paused = document.visibilityState !== "visible" || !document.hasFocus();
      ambientRef.current?.setAttribute("data-cg-ambient", paused ? "paused" : "running");
    };
    apply();
    document.addEventListener("visibilitychange", apply);
    window.addEventListener("blur", apply);
    window.addEventListener("focus", apply);
    return () => {
      document.removeEventListener("visibilitychange", apply);
      window.removeEventListener("blur", apply);
      window.removeEventListener("focus", apply);
    };
  }, []);

  // Release every object URL and the audio graph on unmount.
  useEffect(() => () => {
    releaseDocuments(documentsRef.current);
    void audioContextRef.current?.close().catch(() => undefined);
  }, []);

  const local = useMemo(() => extractDeterministicClient(debouncedNotes), [debouncedNotes]);
  const localReadings = useMemo(() => readLocalFields(local.row, local.evidence), [local]);

  const ensureAudioContext = useCallback(async () => {
    const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    try {
      if (!audioContextRef.current) audioContextRef.current = new AudioCtor();
      if (audioContextRef.current.state === "suspended") await audioContextRef.current.resume();
      return audioContextRef.current;
    } catch {
      // Audio is supplemental: a failed context never breaks intake.
      return null;
    }
  }, []);

  const playTone = useCallback(async (kind: "capture" | "detect" | "submit" | "error") => {
    if (!audioEnabled) return;
    const context = await ensureAudioContext();
    if (!context) return;
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      const frequencies = { capture: 620, detect: 760, submit: 520, error: 220 } as const;
      oscillator.frequency.setValueAtTime(frequencies[kind], now);
      oscillator.type = kind === "error" ? "triangle" : "sine";
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(kind === "error" ? 0.018 : 0.012, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.13);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    } catch { /* supplemental only */ }
  }, [audioEnabled, ensureAudioContext]);

  // A soft tone on any button press on this surface. It is attached once, listens on
  // the capture phase so it cannot swallow or delay a click, and does nothing while
  // audio is off. The tone carries no client data.
  useEffect(() => {
    if (!audioEnabled) return;
    const root = surfaceRef.current;
    if (!root) return;
    const onPress = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest("button,[role=\"button\"],a[href],summary")) void playTone("capture");
    };
    root.addEventListener("click", onPress, { capture: true, passive: true });
    return () => root.removeEventListener("click", onPress, { capture: true });
  }, [audioEnabled, playTone]);

  // The toggle acknowledges immediately; the audio graph warms up afterwards.
  function toggleAudio() {
    const next = !audioEnabled;
    setAudioEnabled(next);
    try { window.localStorage.setItem(AUDIO_PREF_KEY, next ? "on" : "off"); } catch { /* storage unavailable */ }
    if (next) void ensureAudioContext();
  }

  const readField = useCallback((field: SmartField) => {
    if (serverDraft) return serverDraft[field.key] ?? null;
    const reading = localReadings.find((item) => item.field.key === field.key);
    return reading ? localDisplayValue(reading) : null;
  }, [localReadings, serverDraft]);

  const readiness = useMemo(() => smartRequiredReadiness(readField), [readField]);

  /** Required contract fields still empty in a given reading of the source. */
  const missingIn = useCallback((readings: readonly LocalFieldReading[]) => {
    if (serverDraft) return SMART_REQUIRED_FIELDS.filter((field) => !smartFieldText(serverDraft[field.key]).trim());
    return SMART_REQUIRED_FIELDS.filter((field) => {
      const reading = readings.find((item) => item.field.key === field.key);
      return !smartFieldText(reading ? localDisplayValue(reading) : null).trim();
    });
  }, [serverDraft]);

  /** What the debounced reading says — this is what the surface displays. */
  const missingRequired = useMemo(() => missingIn(localReadings), [localReadings, missingIn]);

  /**
   * What the source says right now. The debounce exists to keep typing smooth, not
   * to decide whether a submission may proceed, so the gate re-reads the live text
   * once at the moment of the press rather than trusting a stale snapshot.
   */
  const missingRequiredNow = useCallback(() => {
    if (!sourceSettling) return missingRequired;
    const live = extractDeterministicClient(notes);
    return missingIn(readLocalFields(live.row, live.evidence));
  }, [missingIn, missingRequired, notes, sourceSettling]);

  /** Contract keys that currently hold a value. The rail reads this, never derives it. */
  const filledKeys = useMemo(
    () => SMART_FIELDS.filter((field) => smartFieldText(readField(field)).trim()).map((field) => field.key),
    [readField],
  );

  /** The rail's state, read entirely from state the surface already holds. */
  const railState: RailState = submitted
    ? "SUBMITTED"
    : warningNonce > 0 && readiness.complete < readiness.total
      ? "WARNING"
      : readiness.complete === readiness.total && hasSource
        ? "READY"
        : hasSource
          ? "CAPTURING"
          : "AWAITING";

  /** True only when the shift actually crosses midnight, read off the two times. */
  const overnight = useMemo(
    () => isOvernightShift(
      smartFieldText(readField(SHIFT_START_FIELD)),
      smartFieldText(readField(SHIFT_END_FIELD)),
    ),
    [readField],
  );

  /** Appends reviewed text to the source, preserving whatever is already there. */
  const appendSource = useCallback((text: string) => {
    const addition = text.trim();
    if (!addition) return;
    setNotes((current) => {
      const joined = current.trim() ? `${current.replace(/\s+$/, "")}\n${addition}` : addition;
      return joined.slice(0, MAX_SOURCE_LENGTH);
    });
  }, []);

  // Extraction starts immediately on selection, independently of final case submission.
  // Each candidate is only a suggestion; existing source fields retain authority.
  const [preExtracting, setPreExtracting] = useState(false);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const extractSelected = useCallback(async (selected: QueuedDocument[]) => {
    if (!selected.length) return;
    setPreExtracting(true);
    setPreviewMessage("Reading document locally with free OCR…");
    setDocuments((current) => current.map((d) =>
      selected.some((item) => item.id === d.id) ? { ...d, uploadState: "READY_TO_UPLOAD", processingState: "PROCESSING" } : d,
    ));
    try {
      // Run local OCR directly in this browser without quota-dependent providers.
      // Preview stays on-device. On submission the saved documents are processed by server-side Gemini Vision.
      const { recognizeDocumentInBrowser } = await import("@/lib/browser-paddle-ocr");
      const extracted = [];
      for (const item of selected) {
        const result = await recognizeDocumentInBrowser(item.file);
        extracted.push({ candidates: result.candidates });
      }
      const keyLabels: Record<string, string> = {
        full_name: "Full Name", phone: "Phone", email: "Email",
        date_of_birth: "DOB", street: "Street", city: "City",
        state: "State", zip: "ZIP", preferred_language: "Preferred Language",
        site_code: "Preferred Location", alt_site_code: "Location Option 1",
        backup_site_code: "Backup Site", shift_code: "Shift",
        shift_days: "Shift Days", shift_start_time: "Shift Start",
        shift_end_time: "Shift End",
      };
      const suggestions = extracted.flatMap((document) => document.candidates).map((candidate) => candidate.row);
      setNotes((current) => {
        const existing = extractDeterministicClient(current).row as Record<string, unknown>;
        const additional: string[] = [];
        for (const [key, label] of Object.entries(keyLabels)) {
          if (String(existing[key] ?? "").trim()) continue;
          const value = suggestions.map((row) => row[key]).find((v) => typeof v === "string" && v.trim());
          if (typeof value === "string" && value.trim()) {
            additional.push(`${label}: ${value.trim()}`);
            existing[key] = value.trim();
          }
        }
        if (!additional.length) return current;
        const appended = [current.trim(), ...additional].filter(Boolean).join("\n");
        if (appended.length > MAX_SOURCE_LENGTH) {
          setPreviewMessage("Document extracted, but the source limit prevents automatic insertion. No existing text was replaced.");
          return current;
        }
        return appended;
      });
      setDocuments((current) => current.map((d) =>
        selected.some((item) => item.id === d.id) ? { ...d, uploadState: "READY_TO_UPLOAD", processingState: "COMPLETE" } : d,
      ));
      setPreviewMessage("On-device OCR preview complete. Review fields; after upload Gemini Vision checks the stored documents.");
    } catch (error) {
      setDocuments((current) => current.map((d) =>
        selected.some((item) => item.id === d.id) ? { ...d, uploadState: "READY_TO_UPLOAD", processingState: "FAILED" } : d,
      ));
      setPreviewMessage(error instanceof Error && error.message ? `Local OCR failed: ${error.message}` : "Local OCR failed unexpectedly. Retry or check the browser console.");
    } finally {
      setPreExtracting(false);
    }
  }, []);

  function addFiles(list: FileList | null) {
    if (!list?.length || busy || submitted || preExtracting) return;
    const outcome = admitDocuments(documents, Array.from(list));
    const previous = new Set(documents.map((item) => item.id));
    const fresh = outcome.documents.filter((item) => !previous.has(item.id));
    setDocuments(outcome.documents);
    setRejected(outcome.rejected);
    if (outcome.rejected.length) void playTone("error");
    if (inputRef.current) inputRef.current.value = "";
    if (fresh.length) void extractSelected(fresh);
  }

  const dropFile = useCallback((id: string) => {
    if (busy || submitted) return;
    setDocuments((current) => removeDocument(current, id));
    setRejected([]);
  }, [busy, submitted]);

  function combineDraft(mapped?: SubmitResult["mapped_draft"]) {
    return { ...(mapped?.profile ?? {}), ...(mapped?.review_fields ?? {}) };
  }

  const enrich = useCallback(async (captured: SubmitResult, uploaded: QueuedDocument[]) => {
    if (!captured.enrichment_url || uploaded.length === 0) {
      setStage("READY");
      return;
    }
    setStage("ENRICHING");
    setDocuments((current) => advanceDocuments(current, { processingState: "PROCESSING" }));
    try {
      const res = await fetch(captured.enrichment_url, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Document processing failed (${res.status})`);
      setServerDraft(combineDraft(data.mapped_draft));
      setServerEvidence(Array.isArray(data.field_evidence) ? data.field_evidence : []);
      setVerification(data.verification_result ?? null);
      const reviewRequired = data.verification_result?.processing_state === "REVIEW_REQUIRED";
      setDocuments((current) => advanceDocuments(current, { processingState: reviewRequired ? "REVIEW_REQUIRED" : "COMPLETE" }));
      setStage(reviewRequired ? "REVIEW_REQUIRED" : "READY");
      handshake(reviewRequired ? "cyan" : "emerald");
      void playTone("detect");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Document processing is unavailable; the captured source remains staged.");
      setDocuments((current) => advanceDocuments(current, { processingState: "FAILED" }));
      setStage("REVIEW_REQUIRED");
      void playTone("error");
    }
  }, [handshake, playTone]);

  const submit = useCallback(async () => {
    if (busy || submitted) return;
    const missingNow = missingRequiredNow();
    if (!hasSource || missingNow.length) {
      // Nothing is sent, and the rail reports exactly which field is still needed.
      setWarningNonce((current) => current + 1);
      const target = missingNow[0];
      if (target) {
        setActiveFieldKey(target.key);
        document.querySelector<HTMLElement>(`[data-field="${target.key}"]`)
          ?.scrollIntoView({ block: "center", behavior: prefersReducedMotionNow() ? "auto" : "smooth" });
      }
      void playTone("error");
      return;
    }
    const uploading = documents;
    setStage("CAPTURING");
    setError(null);
    setDocuments((current) => advanceDocuments(current, { uploadState: "UPLOADING" }));
    try {
      const form = new FormData();
      form.set("notes", notes.trim());
      for (const entry of uploading) form.append("files", entry.file, entry.name);
      const res = await fetch("/api/staff/smart-client-import/mobile", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Submission failed (${res.status})`);
      const captured: SubmitResult = {
        case_id: data.case_id,
        created_at: data.created_at,
        uploaded_by_name: data.uploaded_by_name ?? staff.display_name,
        mapped_draft: data.mapped_draft,
        verification_result: data.verification_result,
        field_evidence: Array.isArray(data.field_evidence) ? data.field_evidence : [],
        enrichment_url: data.enrichment_url,
        enrichment_error: data.enrichment_error ?? null,
      };
      setResult(captured);
      setServerDraft(combineDraft(data.mapped_draft));
      setServerEvidence(Array.isArray(data.field_evidence) ? data.field_evidence : []);
      setVerification(data.verification_result ?? null);
      if (data.enrichment_error) setError(String(data.enrichment_error));
      setDocuments((current) => advanceDocuments(current, { uploadState: "STORED", processingState: "WAITING" }));
      setStage("CAPTURED");
      handshake("cyan");
      void playTone("capture");
      void enrich(captured, uploading);
    } catch (e) {
      setStage("DRAFT");
      setDocuments((current) => advanceDocuments(current, { uploadState: "FAILED" }));
      setError(e instanceof Error ? e.message : "Submission failed");
      void playTone("error");
    }
  }, [busy, documents, enrich, handshake, hasSource, missingRequiredNow, notes, playTone, staff.display_name, submitted]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
      event.preventDefault();
      void submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit]);

  function reset() {
    releaseDocuments(documents);
    sessionStart.current = Date.now();
    setDocuments([]); setRejected([]); setNotes(""); setDebouncedNotes("");
    setError(null); setResult(null); setServerDraft(null); setServerEvidence([]); setVerification(null);
    setStage("DRAFT"); setElapsed(0); setWarningNonce(0); setActiveFieldKey(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function runIssueAction(kind: IssueAction) {
    if (kind === "ADD_FILES") { inputRef.current?.click(); return; }
    if (result) void enrich(result, documents);
  }
  const detectedCount = localReadings.filter((reading) => smartFieldText(localDisplayValue(reading)).trim()).length;
  const status = telemetryStatus(stage, hasSource);
  const extractionErrors = Array.isArray(verification?.extraction_errors) ? (verification.extraction_errors as Record<string, unknown>[]) : [];
  const match = sourceMatchState({ hasText: Boolean(notes.trim()), documentCount: documents.length, detectedFields: serverDraft ? readiness.complete : detectedCount });

  const issues: Issue[] = [];
  for (const entry of rejected) {
    issues.push({ id: `file:${entry.name}`, scope: "SOURCE CAPTURE", problem: `${entry.name} — ${entry.reason}`, action: "Remove or replace the file, then add it again.", actionLabel: "REVIEW SOURCE", actionKind: "ADD_FILES" });
  }
  if (!serverDraft) {
    for (const reading of localReadings) {
      if (!reading.invalid) continue;
      issues.push({ id: `invalid:${reading.field.key}`, scope: reading.field.label.toUpperCase(), problem: `Source value "${reading.raw}" is not a valid ${reading.field.label.toLowerCase()}.`, action: "Correct the value in the source text, or leave it for manual review." });
    }
    for (const label of readiness.missing) {
      issues.push({ id: `missing:${label}`, scope: label.toUpperCase(), problem: `${label} is required and was not found in the source.`, action: "Add it to the source text before submitting." });
    }
  }
  const capturedNotes = smartFieldText(readField(NOTES_FIELD)).trim();
  if (capturedNotes) {
    issues.push({
      id: "notes",
      scope: "ADDITIONAL NOTES",
      // The note is shown as the client wrote it. It is content to read, never an
      // instruction to the system, however it is phrased.
      problem: capturedNotes.length > 400 ? `${capturedNotes.slice(0, 400)}…` : capturedNotes,
      action: "Source detail with no field of its own. Confirm it in Smart Review; the full text is kept with the case.",
    });
  }
  for (const [index, entry] of extractionErrors.entries()) {
    issues.push({
      id: `extraction:${index}`,
      scope: "DOCUMENT PROCESSING",
      problem: `${smartFieldText(entry.source) || "Document"} — ${smartFieldText(entry.message) || smartFieldText(entry.code) || "extraction did not complete"}.`,
      action: "Retry extraction, or continue to review with the captured source.",
      actionLabel: result ? "RETRY EXTRACTION" : undefined,
      actionKind: result ? "RETRY_EXTRACTION" : undefined,
    });
  }
  if (error) {
    issues.push({ id: "error", scope: submitted ? "DOCUMENT PROCESSING" : "SUBMISSION", problem: error, action: "The captured source, files and staff context are preserved.", actionLabel: result ? "RETRY EXTRACTION" : undefined, actionKind: result ? "RETRY_EXTRACTION" : undefined });
  }

  return (
    <main ref={surfaceRef} data-smart-responsive-root className="relative min-h-screen w-full min-w-0 overflow-x-clip bg-[#03101f] px-3 py-4 text-slate-200 sm:px-5 sm:py-5 lg:px-7 2xl:px-10">
      {/* Level 0: page backplane. */}
      <div ref={ambientRef} data-cg-ambient="running" className="pointer-events-none fixed inset-0" aria-hidden="true">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_-8%,rgba(26,124,183,.22),transparent_30%),radial-gradient(circle_at_84%_9%,rgba(184,147,74,.10),transparent_24%),linear-gradient(180deg,#061a31_0%,#041226_52%,#020b18_100%)]" />
        <div className="absolute -left-20 top-24 h-80 w-80 rounded-full bg-cyan-300/[.035] blur-3xl" />
        <div className="absolute -right-24 top-1/3 h-96 w-96 rounded-full bg-[#b8934a]/[.03] blur-3xl" />
        <div className="absolute inset-0 opacity-[.10] [background-image:radial-gradient(circle_at_1px_1px,rgba(214,225,238,.16)_1px,transparent_0)] [background-size:31px_31px]" />
        <div className="cg-ambient absolute left-[14%] top-[17%] h-1 w-1 rounded-full bg-cyan-200/30 motion-safe:animate-pulse" />
        <div className="cg-ambient absolute right-[18%] top-[42%] h-1 w-1 rounded-full bg-[#e3c884]/30 motion-safe:animate-pulse" />
      </div>

      {/* Level 1: structural frame. */}
      <section className="relative mx-auto w-full min-w-0 max-w-[1760px] space-y-3 sm:space-y-4">
        <header data-smart-header className={`${PANEL} min-w-0 p-3 sm:p-5 2xl:p-6`}>
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#e3c884]/60 to-transparent" />
          <DigitalHandshake sweep={sweep} />
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 lg:gap-5">
            <div className="min-w-0 max-w-2xl">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[#e3c884] shadow-[0_0_10px_rgba(227,200,132,.42)]" />
                <p className="text-[11px] font-bold tracking-[.22em] text-[#e3c884]">CAREER GATE · EXECUTIVE INTAKE</p>
              </div>
              <h1 className="mt-2 break-words text-[clamp(21px,3vw,27px)] font-semibold leading-tight tracking-[-.02em] text-white">SMART CLIENT IMPORT</h1>
              <p className="mt-1.5 font-mono text-xs text-slate-400">Secure Internal Intake · Local Intelligence · Server Authoritative</p>
            </div>
            <div data-smart-telemetry role="group" aria-label="Smart Client Import live telemetry" className="grid w-full min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:w-auto lg:max-w-[63%] 2xl:max-w-[68%] 2xl:grid-cols-6">
              <Telemetry label="STAFF" value={result?.uploaded_by_name ?? staff.display_name} />
              <Telemetry label="FILES" value={String(totals.count)} mono />
              <Telemetry label="SESSION" value={submitted ? "SUBMITTED" : "ACTIVE"} />
              <Telemetry label="TIME" value={formatElapsed(elapsed)} mono tone="cyan" />
              <div className="flex min-h-[52px] min-w-0 flex-col justify-between rounded-xl border border-[#b8934a]/25 bg-[#03101f]/60 px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,.045)] sm:px-3">
                <span className="text-[11px] font-semibold tracking-[.14em] text-slate-400">STATUS</span>
                <span role="status" className={`mt-1 inline-flex max-w-full flex-wrap break-words rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold leading-4 sm:text-[12px] ${STATUS_TONE[status]}`}>{status.replace(/_/g, " ")}</span>
              </div>
              <div className="flex min-h-[52px] min-w-0 flex-col justify-between rounded-xl border border-[#b8934a]/25 bg-[#03101f]/60 px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,.045)] sm:px-3">
                <span className="text-[11px] font-semibold tracking-[.14em] text-slate-400">AUDIO</span>
                <button
                  type="button"
                  aria-pressed={audioEnabled}
                  aria-label={audioEnabled ? "Audio cues on. Turn audio off" : "Audio cues off. Turn audio on"}
                  onClick={toggleAudio}
                  className="mt-1 inline-flex min-h-11 min-w-11 items-center gap-2 rounded-md border border-[#b8934a]/30 px-2 text-[13px] font-semibold text-[#e3c884] transition hover:bg-[#b8934a]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e3c884]"
                >
                  {audioEnabled ? <VolumeOnIcon /> : <VolumeOffIcon />}
                  <span>{audioEnabled ? "ON" : "OFF"}</span>
                </button>
              </div>
            </div>
          </div>
          {result && (
            <div aria-live="polite" className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/[.06] pt-3 text-xs text-slate-400">
              <span>CASE <b className="ml-1 font-mono font-medium text-slate-200">{result.case_id}</b></span>
              <span>UPLOADED <b className="ml-1 font-mono font-medium text-slate-200">{formatDate(result.created_at)}</b></span>
              <span className="inline-flex items-center gap-1.5 text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />SOURCE CAPTURED</span>
            </div>
          )}
        </header>

        <SmartProgressRail
          fields={SMART_FIELDS}
          filledKeys={filledKeys}
          requiredComplete={readiness.complete}
          requiredTotal={readiness.total}
          state={railState}
          activeFieldKey={activeFieldKey}
          warningNonce={warningNonce}
          audioEnabled={audioEnabled}
          onTone={(kind) => void playTone(kind)}
        />

        <div data-smart-operational-grid className="grid min-w-0 grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {/* Left primary column: SOURCE. Mobile order places capture and source first. */}
          <div data-smart-capture-column className="order-1 min-w-0 space-y-3 sm:space-y-4 2xl:col-span-2">
            <section className={`${PANEL} ${documents.length ? PANEL_ACTIVE : ""} p-4 sm:p-5`} aria-labelledby="smart-source-capture">
              <PanelTitle id="smart-source-capture" number="01" title="SOURCE CAPTURE" meta={`${totals.count} of ${SMART_DOCUMENT_POLICY.maxFiles} files · ${totals.label} · ${submitted ? "STORED" : documents.length ? "READY TO UPLOAD" : "AWAITING FILES"}`} />
              <input ref={inputRef} id="smart-files" className="sr-only" type="file" accept={SMART_DOCUMENT_ACCEPT} multiple disabled={busy || submitted || preExtracting} onChange={(e) => addFiles(e.target.files)} />
              <button
                type="button"
                disabled={busy || submitted || preExtracting}
                onClick={() => inputRef.current?.click()}
                className="group relative mt-3 flex min-h-24 w-full items-center justify-between gap-4 overflow-hidden rounded-2xl border border-dashed border-[#b8934a]/30 bg-[linear-gradient(135deg,rgba(255,255,255,.05),rgba(8,27,52,.2))] px-4 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,.055)] transition-all duration-200 motion-reduce:transition-none hover:-translate-y-0.5 hover:border-[#e3c884]/55 hover:bg-white/[.065] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e3c884] active:translate-y-px active:scale-[.985] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span>
                  <strong className="block text-[15px] font-semibold text-white">TAKE PHOTO / ADD FILES</strong>
                  <span className="mt-1 block text-xs text-slate-400">PDF · JPG · PNG · WebP · max {SMART_DOCUMENT_POLICY.maxFiles} files · {formatDocumentSize(SMART_DOCUMENT_POLICY.maxFileBytes)} each · {formatDocumentSize(SMART_DOCUMENT_POLICY.maxTotalBytes)} total</span>
                  <span className="mt-1 block text-xs text-slate-500">Checked in this browser before anything is uploaded.</span>
                </span>
                <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#d4b06a]/40 bg-[#b8934a]/[.09] text-xl text-[#f0d99d]">＋</span>
              </button>

              {/* Reserved geometry: the file list area keeps its shape so adding a file does not jump the layout. */}
              <DocumentCards documents={documents} submitted={submitted} onRemove={dropFile} />
              {previewMessage && (
                <div role="status" aria-live="polite" className="mt-2 rounded-xl border border-cyan-300/25 bg-cyan-300/[.07] px-3 py-2 text-xs text-cyan-100">
                  {previewMessage}
                  {!preExtracting && documents.some((item) => item.processingState === "FAILED") && (
                    <button type="button" onClick={() => void extractSelected(documents.filter((item) => item.processingState === "FAILED"))}
                      className="ml-3 min-h-11 rounded-lg border border-cyan-300/35 px-3 font-semibold">RETRY EXTRACTION</button>
                  )}
                </div>
              )}

              {rejected.length > 0 && (
                <ul aria-live="polite" className="mt-3 space-y-1.5 rounded-xl border border-amber-300/25 bg-amber-300/[.05] p-3">
                  {rejected.map((entry) => (
                    <li key={entry.name} className="text-xs leading-5 text-amber-100"><b className="font-medium">{entry.name}</b> — {entry.reason}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className={`${PANEL} ${notes.trim() ? PANEL_ACTIVE : ""} p-4 sm:p-5`} aria-labelledby="smart-source-data">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <PanelTitle id="smart-source-data" number="02" title="CLIENT SOURCE DATA" meta="Visible source truth" />
                <span className={`rounded-md border px-2 py-1 font-mono text-[11px] ${match === "FULL SOURCE CAPTURED" ? "border-emerald-300/25 text-emerald-200" : match === "PARTIAL SOURCE" ? "border-amber-300/25 text-amber-200" : "border-white/12 text-slate-400"}`}>{match}</span>
              </div>
              <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
                <div className="flex gap-1.5"><dt>UPLOADED BY</dt><dd className="font-medium text-slate-200">{result?.uploaded_by_name ?? staff.display_name}</dd></div>
                <div className="flex gap-1.5"><dt>UPLOADED AT</dt><dd className="font-mono font-medium text-slate-200">{result ? formatDate(result.created_at) : "pending"}</dd></div>
                <div className="flex gap-1.5"><dt>SOURCE TYPE</dt><dd className="font-mono font-medium text-slate-200">{documents.length && notes.trim() ? "TEXT + DOCUMENT" : documents.length ? "DOCUMENT" : notes.trim() ? "TEXT" : "—"}</dd></div>
              </dl>
              <div className="relative mt-3 overflow-hidden rounded-2xl border border-[#b8934a]/20 bg-[#010918]/88 shadow-[inset_0_1px_14px_rgba(0,0,0,.4)] transition-colors focus-within:border-cyan-300/40">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/30 to-transparent" />
                <label className="sr-only" htmlFor="smart-source-text">Client source data</label>
                <textarea
                  id="smart-source-text"
                  className="min-h-56 w-full min-w-0 resize-y bg-transparent p-3 font-mono text-[14px] leading-[1.65] text-slate-100 outline-none placeholder:text-slate-500 disabled:opacity-70 sm:min-h-64 sm:p-4"
                  maxLength={MAX_SOURCE_LENGTH}
                  value={notes}
                  disabled={submitted}
                  aria-describedby="smart-source-meta"
                  onChange={(e) => setNotes(e.target.value)}
                  onFocus={() => setActiveFieldKey(missingRequired[0]?.key ?? null)}
                  onBlur={() => setActiveFieldKey(null)}
                  placeholder="Paste client information here. The source stays visible while Career Gate extracts and structures supported facts."
                />
              </div>
              <div id="smart-source-meta" className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                <span className="font-mono tabular-nums">{notes.length.toLocaleString()} / {MAX_SOURCE_LENGTH.toLocaleString()}</span>
                <span className="inline-flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${sourceSettling ? "bg-cyan-300" : notes.trim() ? "bg-emerald-300" : "bg-slate-600"}`} />
                  {sourceSettling ? "Reading source…" : notes.trim() ? "Source scanned locally" : "Awaiting source"}
                </span>
              </div>
              <VoiceDictation disabled={busy || submitted} onInsert={appendSource} />
            </section>

            {/* Job preferences: the reviewed job-preference group, shown here as captured.
                Manual authority for these fields is set in Smart Review, which is the only
                path that persists a reviewed value, so nothing here is UI-only. */}
            <section className={`${PANEL} p-4 sm:p-5 xl:order-none`} aria-labelledby="smart-job-preferences">
              <PanelTitle id="smart-job-preferences" number="03" title="JOB PREFERENCES" meta={serverDraft ? "SERVER AUTHORITATIVE" : "AS CAPTURED"} />
              <p className="mt-2 text-xs leading-5 text-slate-400">Captured job preferences and English proficiency. Edit them with manual authority in Smart Review after the file is staged.</p>
              {overnight !== null && (
                <p data-smart-overnight={overnight ? "true" : "false"} className="mt-2 inline-flex items-center gap-2 rounded-lg border border-white/[.08] bg-black/25 px-2.5 py-1.5 text-[12px] text-slate-300">
                  <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${overnight ? "bg-[#e3c884]" : "bg-cyan-300"}`} />
                  <span className="font-mono text-[11px] tracking-[.1em] text-slate-400">OVERNIGHT</span>
                  <b className={`font-mono text-[12px] font-semibold ${overnight ? "text-[#f0d99d]" : "text-cyan-200"}`}>{overnight ? "YES" : "NO"}</b>
                  <span className="text-slate-500">· read from the captured start and end times</span>
                </p>
              )}
              <div className="mt-3">
                <IntelligenceList fields={JOB_PREFERENCE_FIELDS} readField={readField} serverDraft={serverDraft} serverEvidence={serverEvidence} readings={localReadings} verification={verification} hasSource={hasSource} />
              </div>
            </section>
          </div>

          {/* Right operational column: INTELLIGENCE, pipeline, resolution. */}
          <aside data-smart-intelligence-column className="order-2 min-w-0 space-y-3 sm:space-y-4 2xl:col-span-1">
            <section className={`${PANEL} ${detectedCount ? PANEL_ACTIVE : ""} p-4 sm:p-5`} aria-labelledby="smart-live-intelligence">
              <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/45 to-transparent" />
              <PanelTitle id="smart-live-intelligence" number="04" title="LIVE INTELLIGENCE" meta={serverDraft ? "SERVER AUTHORITATIVE" : sourceSettling ? "READING SOURCE" : "LOCAL INTERPRETATION"} tone="cyan" />
              <div className="mt-3 space-y-4">
                {CORE_INTELLIGENCE_GROUPS.map((group) => (
                  <div key={group.title}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <h3 className="text-[12px] font-semibold tracking-[.16em] text-[#e3c884]">{group.title}</h3>
                      <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-[#b8934a]/20 to-transparent" />
                    </div>
                    <IntelligenceList fields={group.fields} readField={readField} serverDraft={serverDraft} serverEvidence={serverEvidence} readings={localReadings} verification={verification} hasSource={hasSource} />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/[.06] pt-3 text-xs text-slate-400">
                <span>REQUIRED FIELDS</span>
                <span className={`rounded-md border px-2 py-1 font-mono text-[13px] ${readiness.complete === readiness.total ? "border-emerald-300/25 text-emerald-200" : "border-amber-300/25 text-amber-200"}`}>{readiness.complete} / {readiness.total} REQUIRED FIELDS</span>
              </div>
            </section>

            <section className={`${PANEL} p-4 sm:p-5`} aria-labelledby="smart-pipeline">
              <PanelTitle id="smart-pipeline" number="05" title="PROCESSING PIPELINE" meta="Actual operational state" />
              <ol className="mt-3 space-y-2">
                <PipelineStage label="SOURCE CAPTURE" state={submitted ? "COMPLETE" : stage === "CAPTURING" ? "RUNNING" : hasSource ? "COMPLETE" : "WAITING"} />
                <PipelineStage label="LOCAL EXTRACTION" state={sourceSettling ? "RUNNING" : notes.trim() ? "COMPLETE" : "WAITING"} />
                <PipelineStage label="DOCUMENT PROCESSING" state={!documents.length ? "WAITING" : stage === "ENRICHING" ? "RUNNING" : stage === "REVIEW_REQUIRED" ? "REVIEW REQUIRED" : stage === "READY" ? "COMPLETE" : "WAITING"} />
                <PipelineStage label="ENRICHMENT" state={!documents.length ? "WAITING" : stage === "ENRICHING" ? "RUNNING" : stage === "REVIEW_REQUIRED" ? "REVIEW REQUIRED" : stage === "READY" ? "COMPLETE" : "WAITING"} />
                <PipelineStage label="STAGING" state={submitted ? "COMPLETE" : stage === "CAPTURING" ? "RUNNING" : "WAITING"} />
                <PipelineStage label="REVIEW READINESS" state={stage === "READY" ? "COMPLETE" : stage === "REVIEW_REQUIRED" ? "REVIEW REQUIRED" : "WAITING"} />
              </ol>
            </section>

            <section
              className={`relative overflow-hidden rounded-[22px] border p-4 shadow-[0_20px_55px_-30px_rgba(0,0,0,.8)] backdrop-blur-2xl sm:p-5 ${issues.length ? "border-amber-300/25 bg-[linear-gradient(145deg,rgba(77,54,10,.18),rgba(8,18,34,.76))]" : "border-white/[.08] bg-[linear-gradient(145deg,rgba(12,35,68,.5),rgba(4,11,25,.6))]"}`}
              aria-labelledby="smart-issues"
            >
              <PanelTitle id="smart-issues" number="06" title="ISSUES & RESOLUTION" meta={issues.length ? `${issues.length} item${issues.length === 1 ? "" : "s"} require attention` : "No outstanding issue"} tone={issues.length ? "amber" : "gold"} />
              {issues.length === 0
                ? <p className="mt-3 text-xs leading-5 text-slate-400">Nothing requires correction. Source, staged data and staff context stay preserved through every retry.</p>
                : <ul aria-live="polite" className="mt-3 space-y-2">
                    {issues.map((issue) => (
                      <li key={issue.id} className={`${INNER} p-3`}>
                        <p className="text-[11px] font-semibold tracking-[.14em] text-amber-200">{issue.scope}</p>
                        <p className="mt-1 text-[14px] leading-6 text-slate-100">{issue.problem}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-400">{issue.action}</p>
                        {issue.actionLabel && issue.actionKind && (
                          <button
                            type="button"
                            onClick={() => runIssueAction(issue.actionKind!)}
                            disabled={stage === "ENRICHING"}
                            className="mt-2 inline-flex min-h-11 items-center rounded-xl border border-amber-300/35 bg-amber-300/[.06] px-3 text-[13px] font-semibold tracking-[.06em] text-amber-100 transition hover:bg-amber-300/[.12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 active:translate-y-px active:scale-[.985] disabled:opacity-40"
                          >{stage === "ENRICHING" ? "RETRYING…" : issue.actionLabel}</button>
                        )}
                      </li>
                    ))}
                  </ul>}
            </section>
          </aside>
        </div>

        <section className={`${PANEL} sticky bottom-2 z-20 order-3 min-w-0 p-3 sm:bottom-3 sm:p-4`} aria-label="Smart Client Import actions">
          <DigitalHandshake sweep={sweep} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-400">
              <span className="rounded-md border border-white/[.08] bg-black/25 px-2 py-1 font-mono text-[11px]">⌘/Ctrl + Enter</span>
              <span>Submit</span>
              <span aria-hidden="true" className="text-slate-600">|</span>
              <span className={hasSource ? "text-emerald-300" : ""}>{submitted ? "Source captured and staged" : hasSource ? "Source captured, not yet submitted" : "Source-first capture"}</span>
              <span aria-hidden="true" className="text-slate-600">|</span>
              <span className="font-mono text-[11px]">{readiness.complete} / {readiness.total} REQUIRED</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {submitted ? (
                <>
                  <button type="button" onClick={reset} className="min-h-11 rounded-xl border border-white/12 bg-white/[.03] px-4 text-[13px] font-semibold tracking-[.1em] text-slate-200 transition hover:bg-white/[.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300 active:translate-y-px active:scale-[.985]">START ANOTHER</button>
                  <Link className="inline-flex min-h-11 items-center rounded-xl border border-[#d4b06a]/55 bg-[linear-gradient(180deg,rgba(184,147,74,.22),rgba(184,147,74,.1))] px-4 text-[13px] font-semibold tracking-[.1em] text-[#f0d99d] shadow-[0_10px_26px_-16px_rgba(184,147,74,.6)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e3c884]" href="/staff/import">OPEN SMART CAREER COLLECT CLIENT</Link>
                </>
              ) : (
                <>
                  <button type="button" onClick={reset} disabled={busy || !hasSource} className="min-h-11 rounded-xl border border-white/12 bg-white/[.02] px-4 text-[13px] font-semibold tracking-[.1em] text-slate-300 transition hover:bg-white/[.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300 active:translate-y-px active:scale-[.985] disabled:opacity-40">CLEAR</button>
                  <button
                    type="button"
                    onClick={() => void submit()}
                    aria-describedby={missingRequired.length ? "smart-submit-gate" : undefined}
                    disabled={busy}
                    className="inline-flex min-h-11 min-w-[9.5rem] items-center justify-center gap-2 rounded-xl border border-[#d4b06a]/65 bg-[linear-gradient(180deg,rgba(184,147,74,.26),rgba(184,147,74,.12))] px-5 text-[14px] font-semibold tracking-[.12em] text-[#f3dda4] shadow-[0_12px_30px_-18px_rgba(184,147,74,.75)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e3c884] active:translate-y-px active:scale-[.985] disabled:opacity-40"
                  >
                    {stage === "CAPTURING" && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#f3dda4] motion-safe:animate-pulse" />}
                    {stage === "CAPTURING" ? "SUBMITTING" : "SUBMIT"}
                  </button>
                  {(missingRequired.length > 0 || !hasSource) && (
                    <p id="smart-submit-gate" className="w-full text-[12px] leading-5 text-amber-200">
                      {!hasSource
                        ? "Add client information or at least one document before submitting."
                        : `Still required before submitting: ${missingRequired.map((field) => field.label).join(", ")}.`}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}


/**
 * Captured-file cards. Memoized so typing in the source textarea never re-renders the
 * previews, and so an object URL is never re-created by an unrelated state change.
 */
const DocumentCards = memo(function DocumentCards({ documents, submitted, onRemove }: {
  documents: readonly QueuedDocument[];
  submitted: boolean;
  onRemove: (id: string) => void;
}) {
  return (
    <ul className="mt-3 space-y-2 empty:mt-0" aria-label="Captured files">
      {documents.map((entry) => (
                  <li key={entry.id} className={`${INNER} grid min-w-0 grid-cols-[48px_minmax(0,1fr)] items-center gap-2 p-2.5 sm:grid-cols-[56px_minmax(0,1fr)_auto] sm:gap-3 sm:p-3`}>
                    <span className="grid h-12 w-12 place-items-center overflow-hidden rounded-xl border border-white/10 bg-black/40 text-slate-500 sm:h-14 sm:w-14">
                      {entry.previewUrl
                        ? <img src={entry.previewUrl} alt={`Preview of ${entry.name}`} className="h-full w-full object-cover" />
                        : <DocumentIcon />}
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate text-[14px] font-medium text-slate-100">{entry.name}</strong>
                      <span className="mt-0.5 block font-mono text-[11px] text-slate-400">{entry.mime} · {formatDocumentSize(entry.size)}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Chip tone="emerald">{entry.localState}</Chip>
                        <Chip tone={entry.uploadState === "FAILED" ? "red" : entry.uploadState === "STORED" ? "emerald" : entry.uploadState === "UPLOADING" ? "cyan" : "neutral"}>{entry.uploadState.replace(/_/g, " ")}</Chip>
                        <Chip tone={entry.processingState === "COMPLETE" ? "emerald" : entry.processingState === "PROCESSING" ? "cyan" : entry.processingState === "REVIEW_REQUIRED" ? "amber" : entry.processingState === "FAILED" ? "red" : "neutral"}>{entry.processingState.replace(/_/g, " ")}</Chip>
                        <span className="font-mono text-[11px] text-slate-500">{documentStatusLabel(entry)}</span>
                      </span>
                    </span>
                    <span className="col-span-2 flex min-w-0 items-center justify-end gap-1.5 sm:col-span-1 sm:justify-start">
                      {entry.previewUrl && (
                        <a
                          href={entry.previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open preview of ${entry.name}`}
                          className="grid h-11 w-11 place-items-center rounded-lg border border-cyan-300/25 text-cyan-200 transition hover:bg-cyan-300/[.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
                        ><PreviewIcon /></a>
                      )}
                      {!submitted && (
                        <button
                          type="button"
                          aria-label={`Remove ${entry.name}`}
                          onClick={() => onRemove(entry.id)}
                          className="grid h-11 w-11 place-items-center rounded-lg border border-red-300/20 text-red-300 transition hover:bg-red-300/[.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300"
                        ><RemoveIcon /></button>
                      )}
                    </span>
                  </li>
      ))}
    </ul>
  );
});

/**
 * One group of reviewed fields. Memoized because its inputs come from the debounced
 * extraction and from server state, not from the keystroke in the source textarea.
 */
const IntelligenceList = memo(function IntelligenceList({ fields, readField, serverDraft, serverEvidence, readings, verification, hasSource }: {
  fields: readonly SmartField[];
  readField: (field: SmartField) => unknown;
  serverDraft: Record<string, unknown> | null;
  serverEvidence: readonly SmartEvidence[];
  readings: readonly LocalFieldReading[];
  verification: Record<string, unknown> | null;
  hasSource: boolean;
}) {
  return (
    <dl className="space-y-1">
      {fields.map((field) => (
        <IntelligenceRow
          key={field.key}
          field={field}
          value={readField(field)}
          serverDraft={serverDraft}
          serverEvidence={serverEvidence}
          readings={readings}
          verification={verification}
          hasSource={hasSource}
        />
      ))}
    </dl>
  );
});

function Telemetry({ label, value, mono = false, tone = "neutral" }: { label: string; value: string; mono?: boolean; tone?: "neutral" | "cyan" }) {
  return (
    <div className="flex min-h-[52px] min-w-0 flex-col justify-between rounded-xl border border-[#b8934a]/25 bg-[#03101f]/60 px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,.045)] sm:px-3">
      <span className="text-[11px] font-semibold tracking-[.14em] text-slate-400">{label}</span>
      <strong className={`mt-1 block min-w-0 break-all text-[12px] font-medium leading-4 sm:text-[13px] ${mono ? "font-mono tabular-nums" : ""} ${tone === "cyan" ? "text-cyan-200" : "text-slate-100"}`}>{value}</strong>
    </div>
  );
}

function PanelTitle({ id, number, title, meta, tone = "gold" }: { id?: string; number: string; title: string; meta?: string; tone?: "gold" | "cyan" | "amber" }) {
  const color = tone === "cyan" ? "text-cyan-200" : tone === "amber" ? "text-amber-200" : "text-[#e3c884]";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span aria-hidden="true" className={`font-mono text-[11px] font-bold ${color}`}>{number}</span>
      <h2 id={id} className="text-[14px] font-semibold tracking-[.12em] text-slate-100">{title}</h2>
      {meta && <><span aria-hidden="true" className="text-slate-600">·</span><span className="text-[11px] text-slate-400">{meta}</span></>}
    </div>
  );
}

function Chip({ tone, children }: { tone: "emerald" | "cyan" | "amber" | "red" | "neutral"; children: React.ReactNode }) {
  const map = {
    emerald: "border-emerald-300/25 text-emerald-200",
    cyan: "border-cyan-300/25 text-cyan-200",
    amber: "border-amber-300/25 text-amber-200",
    red: "border-red-300/25 text-red-200",
    neutral: "border-white/12 text-slate-400",
  } as const;
  return <span className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${map[tone]}`}>{children}</span>;
}

function PipelineStage({ label, state }: { label: string; state: "WAITING" | "RUNNING" | "COMPLETE" | "REVIEW REQUIRED" | "FAILED" }) {
  const tone =
    state === "COMPLETE" ? { dot: "bg-emerald-300", text: "text-emerald-200" }
    : state === "RUNNING" ? { dot: "bg-cyan-300", text: "text-cyan-200" }
    : state === "REVIEW REQUIRED" ? { dot: "bg-amber-300", text: "text-amber-200" }
    : state === "FAILED" ? { dot: "bg-red-300", text: "text-red-200" }
    : { dot: "bg-slate-600", text: "text-slate-400" };
  return (
    <li className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-transparent px-2 py-2 hover:border-white/[.05] hover:bg-white/[.02]">
      <span className="flex items-center gap-2 text-[13px] text-slate-200">
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tone.dot} ${state === "RUNNING" ? "motion-safe:animate-pulse" : ""}`} />
        {label}
      </span>
      <span className={`max-w-full break-words font-mono text-[12px] font-semibold ${tone.text}`}>{state}</span>
    </li>
  );
}

/**
 * One Live Intelligence row. Missing supported fields stay visible, and the value is
 * always shown with its validation state, provenance and authority — never a score.
 */
function IntelligenceRow({ field, value, serverDraft, serverEvidence, readings, verification, hasSource }: {
  field: SmartField;
  value: unknown;
  serverDraft: Record<string, unknown> | null;
  serverEvidence: readonly SmartEvidence[];
  readings: readonly LocalFieldReading[];
  verification: Record<string, unknown> | null;
  hasSource: boolean;
}) {
  const reading = readings.find((item) => item.field.key === field.key);
  const text = smartFieldText(value).trim();
  const serverEntry = serverDraft ? serverEvidence.find((item) => item.field_key === field.key) : undefined;
  const missingFields = Array.isArray(verification?.missing_fields) ? (verification.missing_fields as unknown[]) : [];

  let state: SmartFieldState;
  if (reading?.invalid && !serverDraft) state = "CONFLICT";
  // Before there is any source to interpret, nothing is missing yet — it is awaited.
  else if (!text && !hasSource && !serverDraft) state = "AWAITING";
  else if (!text) state = "MISSING";
  else if (serverEntry) state = String(serverEntry.authority).toUpperCase() === "MANUAL" ? "MANUAL" : "VERIFIED";
  else if (serverDraft) state = "VERIFIED";
  else state = reading?.evidence?.verification_state === "MATCHED" ? "DETECTED" : "REVIEW";
  if (missingFields.some((item) => String(item) === field.key)) state = "MISSING";

  const authority = serverEntry && String(serverEntry.authority).toUpperCase() === "MANUAL" ? "MANUAL" : "SOURCE";
  const provenance = serverDraft
    ? (serverEntry?.source_type ?? "server")
    : reading ? localProvenance(reading) : null;

  return (
    <div
      data-field={field.key}
      className="grid min-w-0 grid-cols-[minmax(0,.72fr)_minmax(0,1.2fr)] items-start gap-x-2 gap-y-1 rounded-xl border border-transparent px-2 py-2 hover:border-cyan-200/[.10] hover:bg-cyan-200/[.03] 2xl:gap-x-3"
    >
      <dt className="text-[12px] leading-5 text-slate-400">
        {field.label}
        {field.required && <span className="ml-1 text-amber-300" title="Required">*</span>}
      </dt>
      <dd
        key={text}
        data-value="1"
        className={`min-w-0 break-words font-mono text-[15px] leading-6 motion-safe:animate-[cg-field-resolve_180ms_ease-out] ${field.editor === "notes" ? "whitespace-pre-line" : ""} ${text ? "text-slate-50" : "text-slate-500"}`}
      >{text || "—"}</dd>
      <dd className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span data-state="1" className={`font-mono text-[11px] font-semibold ${smartStateClass(state)}`}>{state}</span>
        <span aria-hidden="true" className="text-slate-700">·</span>
        <span data-provenance="1" className="min-w-0 break-all font-mono text-[11px] text-slate-400" title="Provenance">{provenance ?? "—"}</span>
        <span aria-hidden="true" className="text-slate-700">·</span>
        <span data-authority="1" className={`font-mono text-[11px] font-semibold ${smartAuthorityClass(authority)}`} title="Authority">{authority}</span>
      </dd>
    </div>
  );
}
