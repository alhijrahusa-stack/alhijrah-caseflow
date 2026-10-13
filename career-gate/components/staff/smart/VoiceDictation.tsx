"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

/**
 * Optional voice capture for the Smart Client Import source box.
 *
 * Dictation is a convenience for typing, never a data path of its own: the
 * transcript is held locally and shown to the person who dictated it, and only an
 * explicit INSERT writes it into the source text. Nothing is sent anywhere, nothing
 * is stored, and no field is filled from speech directly — the inserted text goes
 * through exactly the same deterministic parsing as typed text, so a misheard word
 * is correctable the same way as a mistyped one.
 *
 * The browser's own recognition is used where it exists. Where it does not, the
 * control is simply absent: intake never depends on it.
 */

type RecognitionAlternative = { transcript: string };
type RecognitionResult = { 0: RecognitionAlternative; isFinal: boolean; length: number };
type RecognitionResultList = { length: number; [index: number]: RecognitionResult };
type RecognitionEvent = { resultIndex: number; results: RecognitionResultList };
type RecognitionErrorEvent = { error: string };

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type RecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
};

/** A capability never changes while the page is open, so there is nothing to subscribe to. */
const NO_SUBSCRIBE = () => () => {};

const LANGUAGES = [
  { code: "en-US", label: "EN" },
  { code: "ar-SA", label: "AR" },
] as const;

/** Exact, non-technical reasons; the provider's own error code is never shown. */
const ERROR_MESSAGE: Record<string, string> = {
  "not-allowed": "Microphone access was declined. Allow it in the browser, then start again.",
  "service-not-allowed": "Microphone access was declined. Allow it in the browser, then start again.",
  "audio-capture": "No microphone was found. Connect one, then start again.",
  "no-speech": "Nothing was heard. Start again and speak closer to the microphone.",
  network: "Speech recognition could not be reached. Type the details instead.",
  aborted: "Dictation stopped.",
};

export function VoiceDictation({ disabled, onInsert }: { disabled: boolean; onInsert: (text: string) => void }) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");

  const [listening, setListening] = useState(false);
  const [language, setLanguage] = useState<string>(LANGUAGES[0].code);
  const [finalText, setFinalText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);


  /**
   * Whether the browser can recognize speech at all. Read through the external-store
   * hook so the server render and the first client render agree (the server says no),
   * and the capability is never written into state from an effect.
   */
  const supported = useSyncExternalStore(
    NO_SUBSCRIBE,
    () => Boolean((window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition),
    () => false,
  );

  const teardown = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try { recognition.abort(); } catch { /* already stopped */ }
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    setListening(false);
    setInterimText("");
    if (!recognition) return;
    try { recognition.stop(); } catch { teardown(); }
  }, [teardown]);

  const start = useCallback(() => {
    const scope = window as SpeechWindow;
    const Recognition = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
    if (!Recognition || disabled) return;
    teardown();
    setError(null);
    let recognition: SpeechRecognitionLike;
    try {
      recognition = new Recognition();
    } catch {
      setError("Dictation could not be started in this browser. Type the details instead.");
      return;
    }
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalRef.current = `${finalRef.current} ${text}`.replace(/\s+/g, " ").trim();
        } else {
          interim = `${interim} ${text}`;
        }
      }
      setFinalText(finalRef.current);
      setInterimText(interim.replace(/\s+/g, " ").trim());
    };
    recognition.onerror = (event) => {
      setError(ERROR_MESSAGE[event.error] ?? "Dictation stopped before it finished. Start again or type the details.");
      setListening(false);
      setInterimText("");
    };
    recognition.onend = () => {
      setListening(false);
      setInterimText("");
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      teardown();
      setError("Dictation is already running in another tab. Close it, then start again.");
    }
  }, [disabled, language, teardown]);

  const pending = useMemo(() => [finalText, interimText].filter(Boolean).join(" ").trim(), [finalText, interimText]);

  function insert() {
    const text = finalRef.current.trim();
    if (!text) return;
    onInsert(text);
    discard();
  }

  function discard() {
    finalRef.current = "";
    setFinalText("");
    setInterimText("");
    setError(null);
  }

  if (!supported) return null;

  return (
    <div className="mt-3 rounded-2xl border border-white/[.08] bg-black/25 p-3" data-smart-voice>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${listening ? "bg-red-300 motion-safe:animate-pulse" : "bg-slate-600"}`} />
          <span className="text-[12px] font-semibold tracking-[.14em] text-slate-400">VOICE CAPTURE</span>
          <span className="font-mono text-[11px] text-slate-500">{listening ? "LISTENING" : pending ? "AWAITING REVIEW" : "OPTIONAL"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span role="group" aria-label="Dictation language" className="flex gap-1">
            {LANGUAGES.map((option) => (
              <button
                key={option.code}
                type="button"
                aria-pressed={language === option.code}
                disabled={listening}
                onClick={() => setLanguage(option.code)}
                className={`min-h-11 min-w-11 rounded-lg border px-2 font-mono text-[12px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e3c884] disabled:opacity-40 ${
                  language === option.code ? "border-[#d4b06a]/55 bg-[#b8934a]/[.14] text-[#f3dda4]" : "border-white/12 text-slate-400 hover:bg-white/[.05]"
                }`}
              >{option.label}</button>
            ))}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => (listening ? stop() : start())}
            className="min-h-11 rounded-xl border border-cyan-300/35 bg-cyan-300/[.06] px-3 text-[13px] font-semibold tracking-[.06em] text-cyan-100 transition hover:bg-cyan-300/[.12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 active:translate-y-px active:scale-[.985] disabled:opacity-40"
          >{listening ? "STOP DICTATION" : "START DICTATION"}</button>
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-5 text-slate-500">
        Dictation only writes into the source text above, and only when you insert it. Review it first — nothing is read as a field until it is inserted.
      </p>

      {pending && (
        <>
          <p aria-live="polite" className="mt-2 rounded-xl border border-white/[.08] bg-[#010918]/70 p-2.5 text-[14px] leading-6 text-slate-100">
            {finalText}
            {interimText && <span className="text-slate-500"> {interimText}</span>}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled || !finalText.trim()}
              onClick={insert}
              className="min-h-11 rounded-xl border border-[#d4b06a]/55 bg-[linear-gradient(180deg,rgba(184,147,74,.22),rgba(184,147,74,.1))] px-3 text-[13px] font-semibold tracking-[.08em] text-[#f3dda4] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e3c884] active:translate-y-px active:scale-[.985] disabled:opacity-40"
            >INSERT INTO SOURCE</button>
            <button
              type="button"
              onClick={discard}
              className="min-h-11 rounded-xl border border-white/12 px-3 text-[13px] font-semibold tracking-[.08em] text-slate-300 transition hover:bg-white/[.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300 active:translate-y-px active:scale-[.985]"
            >DISCARD</button>
          </div>
        </>
      )}

      {error && <p role="alert" className="mt-2 text-[12px] leading-5 text-amber-200">{error}</p>}
    </div>
  );
}
