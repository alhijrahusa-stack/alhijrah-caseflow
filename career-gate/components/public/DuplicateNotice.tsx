import { OFFICE_WHATSAPP_DISPLAY, OFFICE_WHATSAPP_URL } from "@/components/public/intake-copy";

/**
 * The one duplicate-application notice for every public form. It states why
 * the submission stopped without naming the existing file, and offers the
 * office WhatsApp line from the office configuration.
 */
export function DuplicateNotice({ heading, body, whatsappLabel, dir }: { heading: string; body: string; whatsappLabel: string; dir?: "rtl" | "ltr" }) {
  return (
    <div
      dir={dir}
      className="mt-3 rounded-2xl border border-[#b87975]/45 bg-[#fff3f1] px-4 py-4 text-center shadow-[0_14px_34px_-26px_rgba(158,91,83,.28)]"
      role="alert"
      data-testid="intake-duplicate-alert"
    >
      <p className="text-[16px] font-semibold text-[#0a2d63]">{heading}</p>
      <p className="mx-auto mt-1.5 max-w-[46ch] text-[13.5px] leading-relaxed text-slate-700">{body}</p>
      <a
        href={OFFICE_WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="intake-duplicate-whatsapp"
        className="mx-auto mt-3 inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-white px-4 text-[14px] font-semibold text-emerald-800 shadow-[0_10px_24px_-18px_rgba(16,122,87,.55)]"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 11.7a7.9 7.9 0 0 1-11.6 7l-4 1.2 1.2-3.9A7.9 7.9 0 1 1 20 11.7Z" /></svg>
        <span>{whatsappLabel} · {OFFICE_WHATSAPP_DISPLAY}</span>
      </a>
    </div>
  );
}
