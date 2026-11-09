"use client";

import { ActionButton } from "@/components/ui/ActionButton";

import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, getToolName } from "ai";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { useStaff } from "@/components/staff/StaffContext";
import { RECOVERY_EVENT, subscribeResources } from "@/components/staff/realtime/update-bus";
import type { AssistantUIMessage } from "@/lib/assistant-chat";
import type { OperationalAnswer } from "@/lib/operational-assistant";
import "./operational-assistant.css";

const MAX_CHARS = 2000;
const HISTORY_SENT = 24;
/** The server reads only user and assistant text from the latest turns; send just that. */
const transport = new DefaultChatTransport<AssistantUIMessage>({
  api: "/api/assistant",
  prepareSendMessagesRequest: ({ messages }) => ({
    body: { messages: messages.slice(-HISTORY_SENT).map(({ id, role, parts }) => ({ id, role, parts: parts.filter((part) => part.type === "text") })) },
  }),
});

const CHECK_LABELS: Record<string, [string, string]> = {
  unpaid_interviews: ["Successful interviews awaiting payment", "المقابلات الناجحة بانتظار السداد"],
  team_load: ["Team load", "حمل الفريق"],
  document_blockers: ["Document review blockers", "عوائق مراجعة الوثائق"],
  flow_forecast: ["Workflow capacity", "طاقة مسار العمل"],
};

/** One line to start; grows with the text up to the CSS max-height, then scrolls. */
function grow(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  element.style.height = `${Math.max(48, element.scrollHeight + 2)}px`;
}

/** The route answers errors as JSON ({ ok:false, error:{ message } }); the transport passes the body as the message. */
function errorText(error: Error | undefined, fallback: string) {
  if (!error) return fallback;
  try {
    const body = JSON.parse(error.message) as { error?: { message?: string } };
    if (body?.error?.message) return body.error.message;
  } catch { /* plain text */ }
  return error.message && error.message.length < 300 ? error.message : fallback;
}

export function OperationalAssistant({ enabled, initialOpen = false }: { enabled: boolean; initialOpen?: boolean }) {
  const { me } = useStaff();
  return <OperationalAssistantSession key={me.id} enabled={enabled} initialOpen={initialOpen}/>;
}

function OperationalAssistantSession({ enabled, initialOpen }: { enabled: boolean; initialOpen: boolean }) {
  const { t, dir } = useStaffLanguage();
  const [open, setOpen] = useState(initialOpen);
  const [draft, setDraft] = useState("");
  const [stale, setStale] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const { messages, sendMessage, status, error, stop, setMessages, clearError, regenerate } = useChat<AssistantUIMessage>({ transport });
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const onOpen = () => { if (enabled) setOpen(true); };
    const signOut = () => { void stop(); setMessages([]); setOpen(false); };
    window.addEventListener("career-gate:open-assistant", onOpen);
    window.addEventListener("career-gate:sign-out", signOut);
    return () => { window.removeEventListener("career-gate:open-assistant", onOpen); window.removeEventListener("career-gate:sign-out", signOut); };
  }, [enabled, setMessages, stop]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && enabled) {
      if (!element.open) element.showModal();
      const frame = requestAnimationFrame(() => input.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
    if (element.open) element.close();
  }, [open, enabled]);

  useEffect(() => {
    if (!open || !enabled) return;
    const invalidate = () => setStale(true);
    const unsubscribe = subscribeResources({ clientId: null, resources: ["client_identity", "pipeline", "appointments", "finance", "documents", "tasks", "followups"], onUpdate: invalidate });
    window.addEventListener(RECOVERY_EVENT, invalidate);
    return () => { unsubscribe(); window.removeEventListener(RECOVERY_EVENT, invalidate); };
  }, [open, enabled]);

  // Follow new output while the reader is at the bottom; leave them where they are if they scrolled up.
  useLayoutEffect(() => {
    const element = history.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [messages, status]);

  function send() {
    const text = draft.trim().slice(0, MAX_CHARS);
    if (!text || busy) return;
    clearError();
    setStale(false);
    pinned.current = true;
    setDraft("");
    if (input.current) input.current.style.height = "";
    void sendMessage({ text });
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
  }

  if (!enabled) return null;
  return <dialog ref={dialog} className="operational-assistant" dir={dir} aria-labelledby="operational-assistant-title" onClose={() => setOpen(false)} onCancel={() => setOpen(false)} onClick={(event) => { if (event.target === dialog.current) setOpen(false); }}>
    <section className="operational-assistant-panel assistant-chat">
      <header className="operational-assistant-header">
        <div><p>CAREER GATE · INTELLIGENCE</p><h2 id="operational-assistant-title">{t("Operations assistant", "مساعد العمليات")}</h2><span>{t("Ask about payments, team load, documents or workflow capacity. Figures come from your live records.", "اسأل عن السداد وحمل الفريق والوثائق وطاقة المسار. الأرقام من سجلاتك الحية.")}</span></div>
        <div className="assistant-header-actions">
          {messages.length > 0 && <ActionButton type="button" className="assistant-new" disabled={busy} onClick={() => { setMessages([]); clearError(); setStale(false); input.current?.focus(); }}>{t("New chat", "محادثة جديدة")}</ActionButton>}
          <ActionButton type="button" className="assistant-icon" aria-label={t("Close assistant", "إغلاق المساعد")} onClick={() => setOpen(false)}>×</ActionButton>
        </div>
      </header>

      <div ref={history} className="assistant-history" role="log" aria-live="polite" aria-relevant="additions" aria-busy={busy} aria-label={t("Conversation", "المحادثة")} tabIndex={0}
        onScroll={(event) => { const el = event.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}>
        {messages.length === 0 && <div className="assistant-welcome"><span aria-hidden="true">✧</span><h3>{t("Turn a question into your next action", "حوّل السؤال إلى خطوتك التالية")}</h3><p>{t("Write your question in English or Arabic. The assistant reads payments after successful interviews, staff workload, document review and workflow capacity, and links the records it used.", "اكتب سؤالك بالعربية أو الإنجليزية. يقرأ المساعد السداد بعد المقابلات الناجحة وحمل الفريق ومراجعة الوثائق وطاقة المسار، ويربط السجلات التي استخدمها.")}</p></div>}
        {messages.map((message) => message.role === "user"
          ? <div key={message.id} className="assistant-msg is-user" data-testid="assistant-user-message"><p dir="auto">{message.parts.map((part) => part.type === "text" ? part.text : "").join("")}</p></div>
          : <div key={message.id} className="assistant-msg is-assistant" data-testid="assistant-reply">
              {message.parts.map((part, index) => {
                if (part.type === "text") return part.text.trim() ? <p key={index} dir="auto" className="assistant-text">{part.text}</p> : null;
                if (!isToolUIPart(part)) return null;
                const [labelEn, labelAr] = CHECK_LABELS[getToolName(part)] ?? ["Operational check", "فحص تشغيلي"];
                if (part.state === "output-available") {
                  const output = part.output as { status: "ok"; answer: OperationalAnswer } | { status: "unavailable" };
                  return output.status === "ok"
                    ? <AnswerCard key={index} answer={output.answer} onNavigate={() => setOpen(false)} />
                    : <p key={index} className="assistant-error" role="alert">{t(`${labelEn}: data is unavailable right now.`, `${labelAr}: البيانات غير متاحة الآن.`)}</p>;
                }
                if (part.state === "output-error") return <p key={index} className="assistant-error" role="alert">{t(`${labelEn}: the check failed.`, `${labelAr}: تعذر الفحص.`)}</p>;
                return <p key={index} className="assistant-checking"><span aria-hidden="true" className="assistant-pulse" />{t(`Checking ${labelEn.toLowerCase()}…`, `جارٍ فحص ${labelAr}…`)}</p>;
              })}
            </div>)}
        {status === "submitted" && <p className="assistant-checking"><span aria-hidden="true" className="assistant-pulse" />{t("Thinking…", "جارٍ التفكير…")}</p>}
        {error && <p className="assistant-error" role="alert">{errorText(error, t("The assistant could not answer right now.", "تعذر على المساعد الإجابة الآن."))} <ActionButton type="button" onClick={() => { clearError(); return regenerate(); }}>{t("Retry", "إعادة المحاولة")}</ActionButton></p>}
        {stale && messages.length > 0 && !busy && <p className="assistant-stale">{t("Records changed since the last answer. Ask again for current figures.", "تغيرت السجلات منذ آخر إجابة. اسأل مجدداً للحصول على الأرقام الحالية.")}</p>}
      </div>

      <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
        <label htmlFor="operations-question" className="sr-only">{t("Ask in English or Arabic", "اكتب سؤالك بالعربية أو الإنجليزية")}</label>
        <textarea ref={input} id="operations-question" dir="auto" rows={1} value={draft} maxLength={MAX_CHARS} autoComplete="off"
          placeholder={t("Ask in English or Arabic…", "اكتب سؤالك بالعربية أو الإنجليزية…")}
          onChange={(event) => { setDraft(event.target.value); grow(event.currentTarget); }} onKeyDown={onComposerKey} />
        {busy
          ? <ActionButton type="button" className="assistant-ask is-stop" onClick={() => stop()}>{t("Stop", "إيقاف")} ■</ActionButton>
          : <ActionButton type="submit" className="assistant-ask" disabled={!draft.trim()}>{t("Send", "إرسال")} ↗</ActionButton>}
      </form>
    </section>
  </dialog>;
}

function AnswerCard({ answer, onNavigate }: { answer: OperationalAnswer; onNavigate: () => void }) {
  const { t } = useStaffLanguage();
  const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
  return <article className="assistant-answer">
    <h3>{t(answer.title, answer.titleAr)}</h3>
    {answer.facts.length > 0 && <dl className="assistant-facts">{answer.facts.map((fact) => <div key={fact.label}><dt>{t(fact.label, fact.labelAr)}</dt><dd dir="ltr">{fact.unit === "USD" ? money(fact.value) : fact.value}</dd></div>)}</dl>}
    {answer.forecast && <div className="assistant-forecast"><div className="assistant-forecast-head"><span>{t("Stage", "القسم")}</span><span>{t("Queue", "انتظار")}</span><span>{t("28d exits", "خروج / 28 يوماً")}</span><span>{t("Clearance", "مدة التفريغ")}</span></div>{answer.forecast.map((row) => <Link href={row.href} key={row.stage} onClick={onNavigate} className="assistant-forecast-row"><span>{t(row.label, row.labelAr)}</span><b dir="ltr">{row.queued}</b><span dir="ltr">{row.exits_28d}</span><span>{row.estimated_clearance_days == null ? t("Low sample", "عينة قليلة") : `${row.estimated_clearance_days} ${t("days", "يوماً")}`}</span></Link>)}</div>}
    {answer.links.length > 0 && <nav className="assistant-links" aria-label={t("Related records", "الملفات المرتبطة")}>{answer.links.map((link) => <Link key={link.href} href={link.href} onClick={onNavigate}><span>{t(link.label, link.labelAr)}</span>{link.amount != null && <strong dir="ltr">{money(link.amount)}</strong>}<span aria-hidden="true">↗</span></Link>)}</nav>}
    <footer><span>{t(answer.method, answer.methodAr)}</span><time dateTime={answer.generated_at} dir="ltr">{new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/Detroit" }).format(new Date(answer.generated_at))}</time></footer>
  </article>;
}
