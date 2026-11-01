"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { useStaff } from "@/components/staff/StaffContext";
import { RECOVERY_EVENT, subscribeResources } from "@/components/staff/realtime/update-bus";
import type { OperationalAnswer } from "@/lib/operational-assistant";
import "./operational-assistant.css";

const QUESTIONS = [
  { en: "Who passed this month and has not paid?", ar: "كم عميلاً نجح هذا الشهر ولم يدفع؟" },
  { en: "Where is the workflow bottleneck?", ar: "أين اختناق مسار العمل؟" },
  { en: "Show current team load", ar: "اعرض حمل الفريق الحالي" },
  { en: "Which documents need attention?", ar: "ما الوثائق التي تحتاج مراجعة؟" },
];

export function OperationalAssistant({ enabled }: { enabled: boolean }) {
  const { me } = useStaff();
  return <OperationalAssistantSession key={me.id} enabled={enabled}/>;
}

function OperationalAssistantSession({ enabled }: { enabled: boolean }) {
  const { t, language, dir } = useStaffLanguage();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<OperationalAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef<AbortController | null>(null);
  const activeQuestion = useRef("");
  const cache = useRef(new Map<string, { at: number; value: OperationalAnswer }>());

  const ask = useCallback(async (text: string, force = false) => {
    if (!enabled) return;
    const q = text.trim().slice(0, 500);
    activeQuestion.current = q;
    setQuestion(q); setError(""); setStale(false);
    inFlight.current?.abort();
    const cached = cache.current.get(q);
    if (!force && cached && Date.now() - cached.at < 15000) { setAnswer(cached.value); setLoading(false); return; }
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    try {
      const response = await fetch(`/api/staff/operational-assistant?q=${encodeURIComponent(q)}`, { cache: "no-store", signal: controller.signal });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data.answer) throw new Error(data?.error?.message ?? "Operational data is unavailable. Try again.");
      if (controller.signal.aborted) return;
      setAnswer(data.answer);
      cache.current.set(q, { at: Date.now(), value: data.answer });
      if (cache.current.size > 8) cache.current.delete(cache.current.keys().next().value!);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Operational data is unavailable.");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [enabled]);

  useEffect(() => {
    const onOpen = () => { if (enabled) setOpen(true); };
    const signOut = () => { cache.current.clear(); setAnswer(null); setOpen(false); inFlight.current?.abort(); };
    window.addEventListener("career-gate:open-assistant", onOpen);
    window.addEventListener("career-gate:sign-out", signOut);
    return () => { window.removeEventListener("career-gate:open-assistant", onOpen); window.removeEventListener("career-gate:sign-out", signOut); inFlight.current?.abort(); };
  }, [enabled]);

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
    const invalidate = () => { cache.current.clear(); setStale(true); };
    const unsubscribe = subscribeResources({ clientId: null, resources: ["client_identity", "pipeline", "appointments", "finance", "documents", "tasks", "followups"], onUpdate: invalidate });
    window.addEventListener(RECOVERY_EVENT, invalidate);
    return () => { unsubscribe(); window.removeEventListener(RECOVERY_EVENT, invalidate); };
  }, [open, enabled]);

  if (!enabled) return null;
  const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
  return <dialog ref={dialog} className="operational-assistant" dir={dir} aria-labelledby="operational-assistant-title" onClose={() => setOpen(false)} onCancel={() => setOpen(false)} onClick={(event) => { if (event.target === dialog.current) setOpen(false); }}>
    <section className="operational-assistant-panel">
      <header className="operational-assistant-header"><div><p>CAREER GATE · INTELLIGENCE</p><h2 id="operational-assistant-title">{t("Operations assistant", "مساعد العمليات")}</h2><span>{t("Answers from your live operational records", "إجابات من سجلات التشغيل الحقيقية")}</span></div><button type="button" className="assistant-icon" aria-label={t("Close assistant", "إغلاق المساعد")} onClick={() => setOpen(false)}>×</button></header>
      <form className="operational-assistant-query" onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
        <label htmlFor="operations-question">{t("Ask in English or Arabic", "اكتب سؤالك بالعربية أو الإنجليزية")}</label>
        <div><input ref={input} id="operations-question" value={question} maxLength={500} onChange={(event) => setQuestion(event.target.value)} placeholder={t("Who passed this month and has not paid?", "كم عميلاً نجح هذا الشهر ولم يدفع؟")} autoComplete="off"/><button type="submit" disabled={loading} className="assistant-ask">{loading ? t("Checking…", "جارٍ المراجعة…") : t("Ask", "اسأل")} ↗</button></div>
      </form>
      <div className="operational-assistant-suggestions" aria-label={t("Suggested questions", "أسئلة مقترحة")}>{QUESTIONS.map((item) => <button key={item.en} type="button" disabled={loading} onClick={() => void ask(language === "ar" ? item.ar : item.en)}>{t(item.en, item.ar)}</button>)}</div>
      <div className="operational-assistant-results" aria-live="polite" aria-busy={loading}>
        {error && <p className="assistant-error" role="alert">{error} <button type="button" onClick={() => void ask(activeQuestion.current, true)}>{t("Retry", "إعادة المحاولة")}</button></p>}
        {stale && answer && <p className="assistant-stale">{t("Operational records changed.", "تغيرت سجلات التشغيل.")} <button type="button" onClick={() => void ask(activeQuestion.current, true)}>{t("Refresh answer", "تحديث الإجابة")}</button></p>}
        {!answer && !error && <div className="assistant-welcome"><span aria-hidden="true">✧</span><h3>{t("Turn a question into your next action", "حوّل السؤال إلى خطوتك التالية")}</h3><p>{t("Check payments, staff workload, document review and workflow capacity without leaving this page.", "راجع السداد وحمل الفريق والوثائق وطاقة المسار دون مغادرة الصفحة.")}</p></div>}
        {answer && <article className="assistant-answer"><h3>{t(answer.title, answer.titleAr)}</h3><p>{t(answer.answer, answer.answerAr)}</p>
          {answer.facts.length > 0 && <dl className="assistant-facts">{answer.facts.map((fact) => <div key={fact.label}><dt>{t(fact.label, fact.labelAr)}</dt><dd dir="ltr">{fact.unit === "USD" ? money(fact.value) : fact.value}</dd></div>)}</dl>}
          {answer.forecast && <div className="assistant-forecast"><div className="assistant-forecast-head"><span>{t("Stage", "القسم")}</span><span>{t("Queue", "انتظار")}</span><span>{t("28d exits", "خروج / 28 يوماً")}</span><span>{t("Clearance", "مدة التفريغ")}</span></div>{answer.forecast.map((row) => <Link href={row.href} key={row.stage} onClick={() => setOpen(false)} className="assistant-forecast-row"><span>{t(row.label, row.labelAr)}</span><b dir="ltr">{row.queued}</b><span dir="ltr">{row.exits_28d}</span><span>{row.estimated_clearance_days == null ? t("Low sample", "عينة قليلة") : `${row.estimated_clearance_days} ${t("days", "يوماً")}`}</span></Link>)}</div>}
          {answer.links.length > 0 && <nav className="assistant-links" aria-label={t("Related records", "الملفات المرتبطة")}>{answer.links.map((link) => <Link key={link.href} href={link.href} onClick={() => setOpen(false)}><span>{t(link.label, link.labelAr)}</span>{link.amount != null && <strong dir="ltr">{money(link.amount)}</strong>}<span aria-hidden="true">↗</span></Link>)}</nav>}
          <footer><span>{t(answer.method, answer.methodAr)}</span><time dateTime={answer.generated_at} dir="ltr">{new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/Detroit" }).format(new Date(answer.generated_at))}</time></footer>
        </article>}
      </div>
    </section>
  </dialog>;
}
