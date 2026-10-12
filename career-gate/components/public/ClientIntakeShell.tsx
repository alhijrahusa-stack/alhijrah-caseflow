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
      className={`relative min-h-screen w-full min-w-0 overflow-x-clip bg-[radial-gradient(ellipse_at_12%_0%,#173b6a_0%,#0a122c_45%,#040914_100%)] text-slate-800 ${
        dir === "rtl" ? "font-[family-name:var(--font-plex-arabic)]" : "font-[family-name:var(--font-inter)]"
      }`}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-24 h-[22rem] w-[22rem] rounded-full bg-[#5188ce]/[.12] blur-3xl" />
        <div className="absolute -right-28 top-1/4 h-[26rem] w-[26rem] rounded-full bg-[#c5a059]/[.11] blur-3xl" />
        <div className="absolute bottom-[-8rem] left-1/4 h-[20rem] w-[20rem] rounded-full bg-[#2f6fd0]/[.06] blur-3xl" />
      </div>
      <main className="relative mx-auto w-full min-w-0 max-w-[1440px] px-3 pb-20 pt-4 sm:px-6 sm:pt-6 lg:px-8 xl:px-10">{children}</main>
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
    plain: "border-[#c5a059]/35 bg-white/[.91] shadow-[0_20px_48px_-28px_rgba(0,0,0,.48)]",
    accent: "border-[#c5a059]/60 bg-gradient-to-br from-[#fffbf2]/[.97] to-[#eaf2ff]/[.91] shadow-[0_20px_50px_-28px_rgba(197,160,89,.42)]",
    success: "border-emerald-300/50 bg-gradient-to-b from-emerald-50/95 to-white/90 shadow-[0_22px_52px_-26px_rgba(16,122,87,.3)]",
  } as const;
  return (
    <section {...rest} className={`min-w-0 rounded-2xl border p-4 backdrop-blur-3xl transition-[border-color,box-shadow] duration-200 hover:border-[#c5a059]/65 focus-within:border-[#c5a059] motion-reduce:transition-none sm:p-5 lg:p-6 ${tones[tone]} ${className}`}>
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
        <p className="truncate break-words text-[16px] font-semibold tracking-tight text-[#f6e6b8]">{title}</p>
        <p className="break-words text-[12px] text-slate-300">{subtitle}</p>
      </div>
    </div>
  );
}
