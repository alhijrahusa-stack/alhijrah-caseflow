"use client";

import type { ReactNode } from "react";

/**
 * The shared surface for every client-facing intake state.
 *
 * Premium light institutional glass: a soft blue-white field, architectural
 * glass cards with controlled translucency, precision shadows and a restrained
 * gold accent. The ambient washes are decorative only and sit behind the
 * content, so they never interfere with reading or tapping.
 */
export function ClientIntakeShell({ dir, children }: { dir: "rtl" | "ltr"; children: ReactNode }) {
  return (
    <div
      dir={dir}
      className={`relative min-h-screen overflow-hidden bg-[#f4f7fc] text-slate-800 ${
        dir === "rtl" ? "font-[family-name:var(--font-plex-arabic)]" : "font-[family-name:var(--font-inter)]"
      }`}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-24 h-[22rem] w-[22rem] rounded-full bg-[#2f6fd0]/[.09] blur-3xl" />
        <div className="absolute -right-28 top-1/4 h-[26rem] w-[26rem] rounded-full bg-[#b8934a]/[.09] blur-3xl" />
        <div className="absolute bottom-[-8rem] left-1/4 h-[20rem] w-[20rem] rounded-full bg-[#2f6fd0]/[.06] blur-3xl" />
      </div>
      <main className="relative mx-auto w-full max-w-[760px] px-4 pb-28 pt-6 sm:px-6 sm:pt-10">{children}</main>
    </div>
  );
}

/** A glass card. `tone` lifts the one surface that should draw the eye. */
export function GlassCard({
  tone = "plain",
  className = "",
  children,
  ...rest
}: {
  tone?: "plain" | "accent" | "success";
  className?: string;
  children: ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  const tones = {
    plain: "border-white/70 bg-white/80 shadow-[0_18px_44px_-28px_rgba(23,42,77,.28)]",
    accent: "border-[#d8b96a]/45 bg-gradient-to-b from-[#fdf6e6]/95 to-white/85 shadow-[0_22px_52px_-26px_rgba(184,147,74,.42)]",
    success: "border-emerald-300/50 bg-gradient-to-b from-emerald-50/95 to-white/90 shadow-[0_22px_52px_-26px_rgba(16,122,87,.3)]",
  } as const;
  return (
    <section {...rest} className={`rounded-3xl border p-5 backdrop-blur-xl sm:p-7 ${tones[tone]} ${className}`}>
      {children}
    </section>
  );
}

/** The office wordmark, the only branding the client page carries. */
export function ClientIntakeBrand({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="h-10 w-[3px] rounded-full bg-gradient-to-b from-[#c79f4f] via-[#b8934a] to-[#b8934a]/0" />
      <div className="min-w-0">
        <p className="truncate text-[16px] font-semibold tracking-tight text-slate-900">{title}</p>
        <p className="truncate text-[12px] text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}
