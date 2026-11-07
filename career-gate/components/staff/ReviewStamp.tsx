"use client";

import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { dateTime } from "@/lib/format";

export type ReviewStampData = {
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  review_id?: string | null;
  review_pending?: boolean;
};

/** This stamp is display-only; its identity and time come from the immutable server audit. */
export function ReviewStamp({ stamp, pending = false }: { stamp?: ReviewStampData | null; pending?: boolean }) {
  const { t } = useStaffLanguage();
  const reviewed = typeof stamp?.reviewed_by_name === "string" && !!stamp.reviewed_by_name.trim()
    && typeof stamp.reviewed_at === "string" && Number.isFinite(Date.parse(stamp.reviewed_at));
  const waiting = pending || stamp?.review_pending === true;
  if (!reviewed && !waiting) return null;
  return <div className="cg-review-stamps mt-2 flex flex-wrap gap-2 text-xs" aria-live="polite">
    {waiting && <span className="cg-review-pending inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 px-2.5 py-1.5 font-medium text-amber-200"><span aria-hidden="true">◷</span>{t("In manager review", "قيد مراجعة المدير")}</span>}
    {reviewed && <span className="cg-review-stamp inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-emerald-400/35 bg-emerald-400/10 px-2.5 py-1.5 text-emerald-200" data-review-id={stamp?.review_id ?? undefined}>
      <span aria-hidden="true">✓</span>{t("Reviewed by manager", "تمت المراجعة من قبل المدير")} — <bdi>{stamp!.reviewed_by_name}</bdi> — <time dateTime={stamp!.reviewed_at!}>{dateTime(stamp!.reviewed_at!)}</time>
    </span>}
  </div>;
}
