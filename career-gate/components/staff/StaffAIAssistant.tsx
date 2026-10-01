"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Reference = { key: string; title: string; category: string };
type AssistantReply = {
  answer: string;
  recommended_actions: string[];
  source_keys: string[];
  references: Reference[];
  model: string;
};
type Message = { id: string; role: "user" | "assistant"; text: string; reply?: AssistantReply };

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  const scope = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function StaffAIAssistant() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  async function ask() {
    const q = question.trim();
    if (q.length < 2 || pending) return;
    setQuestion("");
    setError(null);
    setPending(true);
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text: q }]);
    try {
      const response = await fetch("/api/staff/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({ question: q, route: pathname }),
      });
      const body = await response.json().catch(() => null) as ({ ok?: boolean; error?: { code?: string; message?: string } } & Partial<AssistantReply>) | null;
      if (!response.ok || !body?.ok || !body.answer) {
        const message = body?.error?.code === "NOT_CONFIGURED"
          ? "AI assistant is NOT_CONFIGURED in this environment."
          : body?.error?.message ?? `Assistant request failed (${response.status}).`;
        setError(message);
        return;
      }
      const reply: AssistantReply = {
        answer: body.answer,
        recommended_actions: Array.isArray(body.recommended_actions) ? body.recommended_actions : [],
        source_keys: Array.isArray(body.source_keys) ? body.source_keys : [],
        references: Array.isArray(body.references) ? body.references : [],
        model: typeof body.model === "string" ? body.model : "configured model",
      };
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: reply.answer, reply }]);
    } catch {
      setError("Assistant is temporarily unavailable.");
    } finally {
      setPending(false);
    }
  }

  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError("Voice input is not supported by this browser.");
      return;
    }
    setError(null);
    const recognition = new Ctor();
    recognition.lang = document.documentElement.lang?.startsWith("ar") ? "ar" : "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) setQuestion((current) => current ? `${current} ${transcript}` : transcript);
    };
    recognition.onerror = () => setError("Voice input could not access the microphone.");
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      setListening(false);
      recognitionRef.current = null;
      setError("Voice input could not start.");
    }
  }

  function speak(text: string) {
    if (!("speechSynthesis" in window)) {
      setError("Voice playback is not supported by this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = /[\u0600-\u06ff]/.test(text) ? "ar-SA" : "en-US";
    utterance.rate = 0.96;
    window.speechSynthesis.speak(utterance);
  }

  return (
    <>
      <button type="button" className="cg-assistant-launcher" aria-expanded={open} aria-controls="career-gate-ai-assistant" onClick={() => setOpen((value) => !value)}>
        AI
      </button>
      {open && (
        <section id="career-gate-ai-assistant" className="cg-assistant-panel" aria-label="Career Gate staff AI assistant">
          <header className="flex items-start justify-between gap-3 border-b border-white/[.07] p-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/80">Career Gate Intelligence</p>
              <h2 className="mt-1 text-base font-semibold text-slate-100">Staff Assistant</h2>
              <p className="mt-1 text-xs text-slate-500">Grounded guidance. No record changes.</p>
            </div>
            <button type="button" className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5" onClick={() => setOpen(false)}>Close</button>
          </header>

          <div ref={scrollRef} className="cg-assistant-scroll min-h-48 flex-1 space-y-3 p-4">
            {messages.length === 0 && (
              <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-4 text-sm text-slate-400">
                Ask how to use Career Gate or ask for guidance grounded in the office reference materials.
              </div>
            )}
            {messages.map((message) => {
              const used = message.reply?.references.filter((reference) => message.reply?.source_keys.includes(reference.key)) ?? [];
              return (
                <div key={message.id} className="cg-assistant-message" data-role={message.role}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-slate-200">{message.text}</p>
                    {message.role === "assistant" && <button type="button" className="shrink-0 text-[11px] text-cyan-200" onClick={() => speak(message.text)}>Listen</button>}
                  </div>
                  {message.reply?.recommended_actions.length ? (
                    <ul className="mt-3 space-y-1 text-xs text-slate-400">
                      {message.reply.recommended_actions.map((action) => <li key={action}>• {action}</li>)}
                    </ul>
                  ) : null}
                  {used.length ? <p className="mt-3 text-[10px] text-slate-500">Sources: {used.map((reference) => reference.title).join(" · ")}</p> : null}
                </div>
              );
            })}
            {pending && <div className="cg-assistant-message text-sm text-slate-400">Analyzing verified context…</div>}
            {error && <p role="alert" className="rounded-xl border border-amber-400/20 bg-amber-400/[.06] p-3 text-xs text-amber-200">{error}</p>}
          </div>

          <footer className="border-t border-white/[.07] p-3">
            <div className="flex gap-2">
              <textarea className="input min-h-[46px] flex-1 resize-none" rows={2} value={question} maxLength={1200} placeholder="Ask Career Gate…" onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask();
                }
              }} />
              <div className="flex flex-col gap-2">
                <button type="button" className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/5" aria-pressed={listening} onClick={toggleListening}>{listening ? "Stop" : "Voice"}</button>
                <button type="button" className="ops-primary-button px-3 py-2" disabled={pending || question.trim().length < 2} onClick={() => void ask()}>Ask</button>
              </div>
            </div>
          </footer>
        </section>
      )}
    </>
  );
}
