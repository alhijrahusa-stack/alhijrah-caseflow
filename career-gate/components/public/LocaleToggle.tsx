"use client";

import type { IntakeLocale } from "@/components/public/intake-copy";

/**
 * Arabic / English, one control, Arabic first because it is the default.
 * Switching is immediate and touches no form state.
 */
export function LocaleToggle({ locale, onChange }: { locale: IntakeLocale; onChange: (next: IntakeLocale) => void }) {
  return (
    <div
      dir="ltr"
      role="group"
      aria-label="Language / اللغة"
      className="flex items-center gap-1 rounded-full border border-slate-200 bg-white/85 p-1 shadow-[0_8px_22px_-18px_rgba(23,42,77,.4)] backdrop-blur"
    >
      {(["ar", "en"] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={locale === value}
          data-testid={`locale-${value}`}
          className={`min-h-[40px] min-w-[76px] rounded-full px-3 text-[13px] font-semibold transition-[background-color,color] duration-200 motion-reduce:transition-none ${
            locale === value
              ? "bg-[#2f6fd0] text-white shadow-[0_8px_20px_-12px_rgba(47,111,208,.8)]"
              : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          }`}
        >
          {value === "ar" ? "العربية" : "English"}
        </button>
      ))}
    </div>
  );
}
