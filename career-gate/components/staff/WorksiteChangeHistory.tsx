"use client";

import Link from "next/link";
import { dateOnly, dateTime } from "@/lib/format";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import type { Row } from "@/components/staff/sections/common";

export function WorksiteChangeHistory({ rows }: { rows: Row[] }) {
  const { t } = useStaffLanguage();
  if (!rows.length) return null;
  return <section className="rounded-2xl border border-emerald-300/40 bg-gradient-to-br from-[#0f1f45] to-[#060e24] p-5" data-testid="client-worksite-history">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-300/30 pb-3">
      <div><p className="text-[10px] font-bold tracking-widest text-amber-200">CAREER GATE · WORKSITE HISTORY</p><h2 className="mt-1 text-lg font-bold text-white">{t("Worksite Changes", "سجل تغيير موقع العمل")}</h2></div>
      <Link href="/staff/worksite-changes" prefetch={false} className="rounded-xl border border-amber-200/40 px-3 py-2 text-xs font-semibold text-amber-100">{t("Salah Almoraisy department ↗", "قسم صلاح المريسي ↗")}</Link>
    </div>
    <div className="mt-4 space-y-4">{rows.map(row => <article key={String(row.id)} className="rounded-xl border border-emerald-300/25 bg-white/[.04] p-4">
      <p className="text-sm font-semibold text-white"><bdi>{row.current_site_name ?? "—"}</bdi> <span className="px-2 text-amber-200">→</span> <bdi>{row.final_site_name ?? row.requested_site_name ?? "—"}</bdi></p>
      {row.final_site_address && <p className="mt-2 text-sm text-slate-200" dir="auto">{row.final_site_address}</p>}
      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
        <div><dt className="text-slate-400">{t("Status", "الحالة")}</dt><dd className="mt-1 font-semibold text-emerald-200">{row.status === "confirmed" ? t("Confirmed", "تم التأكيد") : t("Pending", "بانتظار تغيير الموقع")}</dd></div>
        {row.status === "confirmed" && <>
          <div><dt className="text-slate-400">{t("Shift days and time · Michigan", "أيام ووقت الشفت · ميشيغان")}</dt><dd className="mt-1 text-white">{row.shift_days} · <bdi>{String(row.shift_start).slice(0,5)} – {String(row.shift_end).slice(0,5)}</bdi></dd></div>
          <div><dt className="text-slate-400">{t("New start date", "تاريخ البداية الجديد")}</dt><dd className="mt-1 text-white">{dateOnly(String(row.new_start_date).slice(0,10))}</dd></div>
          <div><dt className="text-slate-400">{t("Confirmation time · Michigan", "وقت التأكيد · ميشيغان")}</dt><dd className="mt-1 text-white">{dateTime(row.confirmed_at)}</dd></div>
          <div><dt className="text-slate-400">{t("Recorded by", "سجّله")}</dt><dd className="mt-1 text-white">{row.confirmed_by_name} · {dateTime(row.recorded_at)}</dd></div>
          <div><dt className="text-slate-400">{t("Client email notification", "إشعار العميل بالبريد")}</dt><dd className="mt-1 text-white">{row.notification_status ?? t("Not queued", "لم يُدرج للإرسال")}{row.sent_at && <> · {dateTime(row.sent_at)}</>}</dd></div>
        </>}
      </dl>
    </article>)}</div>
  </section>;
}
