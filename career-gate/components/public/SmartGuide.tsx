"use client";

import { useEffect, useRef, useState } from "react";
import type { IntakeStrings } from "@/components/public/intake-copy";

/**
 * The Smart Guide.
 *
 * It is a deterministic, step-aware hint: a lookup from the client's current
 * context to one short sentence. There is no conversation, no model, no runtime
 * and no network call — the message changes the instant the context does.
 *
 * It is inline and never blocks: it can be minimized and reopened, and it never
 * covers the control the client is using.
 */

export type GuideContext = "welcome" | "start" | "documents" | "review" | "ready" | "issue" | "success";

function message(t: IntakeStrings, context: GuideContext) {
  switch (context) {
    case "start": return t.guideStart;
    case "documents": return t.guideDocuments;
    case "review": return t.guideReview;
    case "ready": return t.guideReady;
    case "issue": return t.guideIssue;
    case "success": return t.guideSuccess;
    default: return t.guideWelcome;
  }
}

export function SmartGuide({ t, context }: { t: IntakeStrings; context: GuideContext }) {
  const [open, setOpen] = useState(true);
  // Announce only when the message actually changes, not on every render.
  const [announced, setAnnounced] = useState(() => message(t, context));
  const last = useRef(context);

  useEffect(() => {
    if (last.current === context) return;
    last.current = context;
    setAnnounced(message(t, context));
  }, [context, t]);

  const text = message(t, context);

  if (!open) {
    return (
      <div className="sticky bottom-4 z-20 mt-6 flex justify-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="smart-guide-open"
          className="flex min-h-[44px] items-center gap-2 rounded-full border border-[#d8b96a]/50 bg-white/95 px-4 text-[13px] font-semibold text-slate-700 shadow-[0_12px_30px_-16px_rgba(23,42,77,.4)] backdrop-blur transition-[background-color,box-shadow] duration-200 hover:bg-white motion-reduce:transition-none"
        >
          <GuideMark />
          {t.guideOpen}
        </button>
      </div>
    );
  }

  return (
    <aside
      className="sticky bottom-4 z-20 mt-6 rounded-2xl border border-[#d8b96a]/45 bg-white/92 p-4 shadow-[0_18px_44px_-24px_rgba(23,42,77,.38)] backdrop-blur-xl"
      data-testid="smart-guide"
      aria-label={t.guideTitle}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 shrink-0"><GuideMark /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold uppercase tracking-[.1em] text-[#8a6b26]">{t.guideTitle}</p>
          <p className="mt-1.5 text-[14px] leading-relaxed text-slate-700" data-testid="smart-guide-message">{text}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          data-testid="smart-guide-minimize"
          aria-label={t.guideMinimize}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-700 motion-reduce:transition-none"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 12h12" /></svg>
        </button>
      </div>
      {/* The guidance is read out when it changes, without stealing focus. */}
      <p className="sr-only" role="status" aria-live="polite">{announced}</p>
    </aside>
  );
}

function GuideMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-[#b8934a]" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M12 3.5 13.9 9l5.6 1.4-4.2 3.6 1 5.5-4.3-2.6-4.3 2.6 1-5.5L4.5 10.4 10.1 9Z" />
    </svg>
  );
}
