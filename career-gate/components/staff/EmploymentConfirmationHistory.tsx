"use client";

import { dateOnly, dateTime } from "@/lib/format";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";

export function EmploymentConfirmationHistory({ rows }: { rows: Record<string, unknown>[] }) {
  const { t } = useStaffLanguage();
  if (!rows.length) return null;
  return <section className="staff-glass rounded-2xl p-4" data-testid="employment-confirmation-history">
    <h2 className="text-sm font-semibold text-amber-100">{t("Recorded employment confirmations", "سجل تأكيدات المباشرة")}</h2>
    <p className="mt-1 text-xs text-slate-300">{t("Historical confirmations stay with the original file through every worksite or workflow change.", "تظل التأكيدات التاريخية مرتبطة بالملف الأصلي عند تغيير الموقع أو مسار العمل.")}</p>
    <ol className="mt-3 grid gap-3 sm:grid-cols-2">{rows.map(row => <li key={String(row.id)} className="rounded-xl border border-amber-200/15 bg-slate-900/25 p-3 text-sm">
      <strong className="block text-slate-100">{String(row.site_name ?? row.site_code ?? "—")}</strong>
      <span className="mt-1 block">{t("Actual start", "المباشرة الفعلية")}: <bdi>{dateOnly(String(row.actual_start_date))}</bdi></span>
      <span className="mt-1 block text-xs text-slate-300"><bdi>{String(row.confirmed_by_name ?? "—")}</bdi> · <bdi>{dateTime(String(row.confirmed_at))}</bdi></span>
    </li>)}</ol>
  </section>;
}
