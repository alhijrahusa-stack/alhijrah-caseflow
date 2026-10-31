"use client";

import { StaffText } from "@/components/staff/StaffLanguage";


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
        <p className="ops-kicker"><StaffText en="CAREER GATE · RECOVERY" ar="CAREER GATE · استعادة العرض"/></p>
        <h1 className="text-xl font-bold text-white"><StaffText en="This view could not load" ar="تعذّر تحميل هذا العرض"/></h1>
        <p className="text-sm text-slate-300"><StaffText en="No data was changed. Navigation and the rest of the workspace remain available." ar="لم تتغير أي بيانات. يمكنك متابعة التنقل والعمل في بقية الأقسام."/></p>
        {error.digest && <p className="font-mono text-xs text-slate-500"><StaffText en="Reference:" ar="المرجع:"/> {error.digest}</p>}
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className="ops-primary-button" onClick={reset}><StaffText en="Try again" ar="إعادة المحاولة"/></button>
          <Link href="/staff" className="ops-secondary-button"><StaffText en="Dashboard" ar="مركز القيادة"/></Link>
        </div>
      </div>
    </section>
  );
}
