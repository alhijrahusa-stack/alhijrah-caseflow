"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useStaff } from "@/components/staff/StaffContext";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { RECOVERY_EVENT, subscribeResources } from "@/components/staff/realtime/update-bus";
import type { FlowForecast } from "@/lib/operational-assistant-core";
import "./operational-assistant.css";

/** A current-view capacity warning, derived from recorded throughput rather than invented deadline predictions. */
export function OperationalForecastNotice({ enabled }: { enabled: boolean }) {
  const { me } = useStaff();
  return enabled ? <ForecastSession key={me.id}/> : null;
}

function ForecastSession() {
  const { t } = useStaffLanguage();
  const [rows, setRows] = useState<FlowForecast[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = async () => {
      if (disposed || document.visibilityState !== "visible" || !navigator.onLine) return;
      controller.current?.abort();
      const request = new AbortController();
      controller.current = request;
      const timeout = window.setTimeout(() => request.abort(), 10000);
      try {
        const response = await fetch("/api/staff/operational-assistant?q=capacity%20forecast", { cache: "no-store", signal: request.signal });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.ok || !Array.isArray(result.answer?.forecast)) throw new Error("forecast_unavailable");
        if (!disposed && controller.current === request) { setRows(result.answer.forecast); setUnavailable(false); }
      } catch {
        if (!disposed && controller.current === request) setUnavailable(true);
      } finally { window.clearTimeout(timeout); }
    };
    const queue = () => {
      if (timer) clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = setTimeout(() => { timer = null; void refresh(); }, 650);
    };
    const unsubscribe = subscribeResources({ clientId: null, resources: ["pipeline", "client_identity", "tasks"], onUpdate: queue });
    window.addEventListener(RECOVERY_EVENT, queue);
    window.addEventListener("online", queue);
    document.addEventListener("visibilitychange", queue);
    queue();
    return () => {
      disposed = true; unsubscribe(); if (timer) clearTimeout(timer); controller.current?.abort(); controller.current = null;
      window.removeEventListener(RECOVERY_EVENT, queue); window.removeEventListener("online", queue); document.removeEventListener("visibilitychange", queue);
    };
  }, []);

  const warnings = (rows ?? []).filter((row) => row.queued > 0 && row.sample === "sufficient" && (row.estimated_clearance_days ?? 0) > 7)
    .sort((a, b) => (b.estimated_clearance_days ?? 0) - (a.estimated_clearance_days ?? 0)).slice(0, 3);
  const insufficient = (rows ?? []).filter((row) => row.queued > 0 && row.sample === "insufficient").length;
  return <section className={`operational-capacity ${warnings.length ? "has-warnings" : "is-quiet"}`} aria-labelledby="capacity-insight-title" data-testid="operational-capacity">
    <header><div><span className="capacity-symbol" aria-hidden="true">◷</span><div><p>CAPACITY INTELLIGENCE</p><h2 id="capacity-insight-title">{t("Workflow capacity watch", "مراقبة طاقة مسار العمل")}</h2></div></div>{warnings.length > 0 && <span className="capacity-count" dir="ltr">{warnings.length}</span>}</header>
    {unavailable ? <p className="capacity-quiet-copy">{t("Capacity data could not be refreshed. Open the operations assistant to retry.", "تعذر تحديث بيانات الطاقة. افتح مساعد العمليات لإعادة المحاولة.")}</p>
      : !rows ? <p className="capacity-quiet-copy" role="status">{t("Checking recorded workflow throughput…", "جارٍ مراجعة الوتيرة المسجلة للمسار…")}</p>
      : warnings.length ? <div className="capacity-warnings">{warnings.map((row) => <article key={row.stage}>
        <div><h3>{t(row.label, row.labelAr)}</h3><p>{t(`${row.queued} queued files · ${row.exits_28d} recorded exits / 28 days`, `${row.queued} ملفات بالانتظار · ${row.exits_28d} انتقالاً مسجلاً خلال 28 يوماً`)}</p></div>
        <div className="capacity-estimate"><strong dir="ltr">~{row.estimated_clearance_days}</strong><span>{t("days to clear current queue", "يوماً لتفريغ الانتظار الحالي")}</span></div>
        <Link href={row.href} prefetch={false}>{t("Review stage", "مراجعة القسم")} ↗</Link>
      </article>)}</div>
      : <p className="capacity-quiet-copy">{insufficient ? t(`${insufficient} active stages need more recorded history before a capacity warning can be estimated.`, `${insufficient} أقسام نشطة تحتاج سجلاً إضافياً قبل تقدير تحذير الطاقة.`) : t("No capacity warning is supported by the current queue and recorded throughput.", "لا تظهر بيانات الانتظار والوتيرة المسجلة تحذيراً مدعوماً لطاقة العمل حالياً.")}</p>}
    {rows && <details className="capacity-method"><summary>{t("Projection method & next step", "طريقة التقدير والخطوة التالية")}</summary><p>{t("Queue ÷ average daily stage exits over 28 days, with at least 5 exits. Assumes unchanged throughput and no new arrivals; it estimates workload capacity, not missed deadlines.", "الانتظار ÷ متوسط الانتقالات اليومية خلال 28 يوماً، بعينة لا تقل عن 5 انتقالات. يفترض ثبات الوتيرة وعدم ورود ملفات جديدة؛ يقدّر طاقة العمل ولا يحكم بتأخر المواعيد.")}</p>{insufficient > 0 && <p>{t(`${insufficient} active stages have insufficient data for a projection.`, `${insufficient} أقسام نشطة لا تملك عينة كافية للتقدير.`)}</p>}{warnings.length > 0 && <Link href="/staff/staff?tab=team" prefetch={false}>{t("Review team load before redistributing work", "راجع حمل الفريق قبل إعادة توزيع العمل")} ↗</Link>}</details>}
  </section>;
}
