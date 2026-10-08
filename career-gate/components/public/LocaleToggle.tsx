"use client";

import type { IntakeLocale } from "@/components/public/intake-copy";

/** Arabic / English, one control, Arabic first because it is the default. */
export function LocaleToggle({ locale, onChange }: { locale: IntakeLocale; onChange: (next: IntakeLocale) => void }) {
  return (
    <div
      dir="ltr"
      role="group"
      aria-label="Language / اللغة"
      className="flex items-center gap-1 rounded-full border border-white/[.08] bg-white/[.03] p-1 backdrop-blur"
    >
      {(["ar", "en"] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={locale === value}
          data-testid={`locale-${value}`}
          className={`min-h-[36px] min-w-[72px] rounded-full px-3 text-[12px] font-semibold transition ${
            locale === value
              ? "bg-[#e3c884]/15 text-[#f3dda4] shadow-[0_0_18px_-6px_rgba(227,200,132,.5)]"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {value === "ar" ? "العربية" : "English"}
        </button>
      ))}
    </div>
  );
}
