"use client";

import { useEffect, useRef, useState } from "react";
import { GlassReviewDialog } from "@/components/staff/smart/GlassReviewDialog";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { publishMutation } from "@/components/staff/realtime/update-bus";
import styles from "@/components/staff/ManagerTaskCenter.module.css";
import "@/components/staff/smart/royal-intake.css";

export function SendToManagerButton({ clientId, reportPeriod }: { clientId?: string; reportPeriod?: 7 | 30 | 90 }) {
  const { t } = useStaffLanguage();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestKey = useRef("");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5500);
    return () => clearTimeout(timer);
  }, [notice]);
  async function send() {
    if (pending) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/staff/manager-inbox", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(clientId ? { kind: "client", client_id: clientId } : { kind: "report", period: reportPeriod ?? 30 }), note, request_key: requestKey.current }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message ?? t("The review could not be sent", "تعذر إرسال المراجعة"));
      setOpen(false); setNote("");
      setNotice(result.created ? t("Sent to the manager's inbox", "تم الإرسال إلى صندوق وارد المدير") : t("This item is already waiting for manager review", "هذا الملف موجود بالفعل في انتظار مراجعة المدير"));
      publishMutation("manager_review_requested", clientId ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Connection failed. Retry when online.", "تعذر الاتصال. أعد المحاولة عند عودة الشبكة.")); }
    finally { setPending(false); }
  }
  return <>
    <button type="button" className="ops-secondary-button" onClick={() => { requestKey.current = crypto.randomUUID(); setError(""); setOpen(true); }}>
      <span aria-hidden="true">↗</span> {t("Send to manager", "إرسال للمدير")}
    </button>
    {open && <GlassReviewDialog title={t("Send for manager review", "إرسال لمراجعة المدير")} onClose={() => { if (!pending) setOpen(false); }}>
      <form className={styles.sendForm} onSubmit={event => { event.preventDefault(); void send(); }}>
        <p>{clientId ? t("The manager can review this client and route the existing file to its next eligible stage.", "يمكن للمدير مراجعة العميل وتوجيه ملفه الحالي إلى المرحلة التالية المسموحة.") : t("Send a snapshot of this report. The manager can approve it or create a follow-up for the selected workflow section.", "أرسل نسخة من هذا التقرير. يمكن للمدير اعتماده أو إنشاء متابعة للقسم المختار.")}</p>
        <label>{t("Review note (optional)", "ملاحظة المراجعة (اختياري)")}<textarea autoFocus className="input" value={note} onChange={event => setNote(event.target.value)} maxLength={4000} rows={5} dir="auto" /></label>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.buttons}><button type="button" className="ops-secondary-button" disabled={pending} onClick={() => setOpen(false)}>{t("Cancel", "إلغاء")}</button>
          <button className="ops-primary-button" disabled={pending}>{pending ? t("Sending…", "جارٍ الإرسال…") : t("Send review", "إرسال المراجعة")}</button></div>
      </form>
    </GlassReviewDialog>}
    {notice && <p className={styles.toast} role="status">{notice}</p>}
  </>;
}
