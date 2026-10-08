"use client";

import { useState } from "react";
import { ClientIntakeBrand, ClientIntakeShell } from "@/components/public/ClientIntakeShell";
import { INTAKE_COPY, type IntakeLocale } from "@/components/public/intake-copy";
import { LocaleToggle } from "@/components/public/LocaleToggle";

/**
 * What the client sees for a link that cannot be opened — used, revoked,
 * expired or unknown. It states only that, and never whether some other link
 * exists or what became of this one internally.
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
      <section
        className="mt-10 rounded-3xl border border-white/[.07] bg-white/[.025] p-7 text-center shadow-[0_28px_70px_-40px_rgba(0,0,0,.9)] backdrop-blur-xl sm:p-10"
        data-testid="intake-closed"
      >
        <div aria-hidden="true" className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-[#e3c884]/25 bg-[#e3c884]/[.07] text-[#e3c884]">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" />
            <path d="M8.5 10.5V8a3.5 3.5 0 1 1 7 0v2.5" />
          </svg>
        </div>
        <h1 className="mt-5 text-[20px] font-semibold tracking-tight text-white sm:text-[23px]">
          {closed ? t.closedHeading : t.invalidHeading}
        </h1>
        <p className="mx-auto mt-3 max-w-[46ch] text-[14px] leading-relaxed text-slate-300">
          {closed ? t.closedBody : t.invalidBody}
        </p>
      </section>
    </ClientIntakeShell>
  );
}
