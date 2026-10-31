"use client";

import { StaffText } from "@/components/staff/StaffLanguage";


import { useEffect, useState } from "react";
import Link from "next/link";
import { PageSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  const [delayed, setDelayed] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDelayed(true), 8000);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <div className="space-y-4">
      <PageSkeleton cards={5} rows={8} />
      {delayed && (
        <div role="alert" data-testid="dashboard-loading-recovery" className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/35 bg-amber-300/10 p-4 text-sm text-amber-50">
          <p className="min-w-0 flex-1"><StaffText en="The dashboard is taking longer than expected. Your work has not been changed." ar="يستغرق تحميل لوحة القيادة وقتاً أطول من المعتاد. لم يتغير عملك."/></p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="min-h-11 rounded-xl border border-amber-300/50 bg-amber-300/15 px-4 font-semibold hover:bg-amber-300/25" onClick={() => window.location.reload()}><StaffText en="Reload dashboard" ar="إعادة تحميل لوحة القيادة"/></button>
            <Link href="/staff/clients" className="inline-flex min-h-11 items-center rounded-xl border border-white/20 px-4 font-semibold hover:bg-white/10"><StaffText en="Open clients" ar="فتح العملاء"/></Link>
          </div>
        </div>
      )}
    </div>
  );
}
