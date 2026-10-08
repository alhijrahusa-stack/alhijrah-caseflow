"use client";

import { useState } from "react";
import { ClientIntakeBrand, ClientIntakeShell, GlassCard } from "@/components/public/ClientIntakeShell";
import { INTAKE_COPY, OFFICE_WHATSAPP_URL, type IntakeLocale } from "@/components/public/intake-copy";
import { LocaleToggle } from "@/components/public/LocaleToggle";

/**
 * What the client sees for a link that cannot be opened — used, revoked,
 * expired or unknown. It states only that, and never whether some other link
 * exists or what became of this one internally. The office contact is offered,
 * because a client who lands here needs a way forward.
 */
export function ClientIntakeClosed({ reason }: { reason: "not_found" | "gone" }) {
  const [locale, setLocale] = useState<IntakeLocale>("ar");
  const t = INTAKE_COPY[locale];
  const closed = reason === "gone";

  return (
    <ClientIntakeShell dir={t.dir}>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <ClientIntakeBrand title={t.brand} subtitle={t.office} />
        <LocaleToggle locale={locale} onChange={setLocale} />
      </header>
      <GlassCard className="mt-10 text-center" data-testid="intake-closed">
        <div aria-hidden="true" className="mx-auto grid h-13 w-13 place-items-center rounded-2xl border border-[#d8b96a]/50 bg-[#fdf6e6] p-3 text-[#9c7a2e]">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7">
            <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" />
            <path d="M8.5 10.5V8a3.5 3.5 0 1 1 7 0v2.5" />
          </svg>
        </div>
        <h1 className="mt-5 text-[21px] font-semibold tracking-tight text-slate-900 sm:text-[24px]">
          {closed ? t.closedHeading : t.invalidHeading}
        </h1>
        <p className="mx-auto mt-3 max-w-[46ch] text-[15px] leading-relaxed text-slate-600">
          {closed ? t.closedBody : t.invalidBody}
        </p>
        <a
          href={OFFICE_WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="intake-whatsapp"
          className="mt-6 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-emerald-500/35 bg-white px-5 text-[15px] font-semibold text-emerald-800 shadow-[0_10px_28px_-18px_rgba(16,122,87,.5)] transition-colors duration-200 hover:bg-emerald-50 motion-reduce:transition-none"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 11.7a7.9 7.9 0 0 1-11.6 7l-4 1.2 1.2-3.9A7.9 7.9 0 1 1 20 11.7Z" /></svg>
          {t.whatsappOffice}
        </a>
      </GlassCard>
    </ClientIntakeShell>
  );
}
