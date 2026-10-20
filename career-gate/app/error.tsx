"use client";

import { useEffect } from "react";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      event: "route_render_failed",
      digest: error.digest ?? null,
    }));
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#08090D] px-4 text-white">
      <div className="w-full max-w-md space-y-4 rounded-3xl border border-[#c9a27e]/35 bg-white/[.04] p-8 text-center shadow-[0_24px_60px_rgba(0,0,0,.35)] backdrop-blur-2xl">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-slate-300" dir="rtl">حدث خطأ مؤقت. يرجى المحاولة مرة أخرى.</p>
        {error.digest && <p className="font-mono text-xs text-slate-500">Reference: {error.digest}</p>}
        <button type="button" onClick={reset} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#c9a27e]/50 px-5 text-sm font-semibold text-[#f3d9c4]">Try again</button>
      </div>
    </main>
  );
}
