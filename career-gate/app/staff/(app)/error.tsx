"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function StaffRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      event: "staff_route_render_failed",
      digest: error.digest ?? null,
      message: error.message,
    }));
  }, [error]);

  return (
    <section className="ops-page" data-testid="staff-route-error">
      <div className="ops-glass-card mx-auto max-w-xl space-y-4 text-center">
        <p className="ops-kicker">CAREER GATE · RECOVERY</p>
        <h1 className="text-xl font-bold text-white">This view could not load</h1>
        <p className="text-sm text-slate-300">No data was changed. Navigation and the rest of the workspace remain available.</p>
        <p className="text-sm text-slate-300" dir="rtl">تعذّر تحميل هذه الصفحة. لم يتغير أي بيان، وبقية النظام تعمل.</p>
        {error.digest && <p className="font-mono text-xs text-slate-500">Reference: {error.digest}</p>}
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className="ops-primary-button" onClick={reset}>Try again</button>
          <Link href="/staff" className="ops-secondary-button">Dashboard</Link>
        </div>
      </div>
    </section>
  );
}
