"use client";

import type { ReactNode } from "react";

/**
 * The shared surface for every client-facing intake state.
 *
 * It carries the Career Gate visual identity — dark navy, glass, soft luminous
 * borders, gold and cyan accents — and nothing operational. The ambient glows
 * are purely decorative and sit behind the content, so they never interfere
 * with reading or tapping.
 */
export function ClientIntakeShell({ dir, children }: { dir: "rtl" | "ltr"; children: ReactNode }) {
  return (
    <div
      dir={dir}
      className={`relative min-h-screen overflow-hidden bg-[#070b14] text-slate-100 ${dir === "rtl" ? "font-[family-name:var(--font-plex-arabic)]" : "font-[family-name:var(--font-inter)]"}`}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 top-16 h-80 w-80 rounded-full bg-cyan-300/[.045] blur-3xl" />
        <div className="absolute -right-28 top-1/3 h-96 w-96 rounded-full bg-[#b8934a]/[.04] blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-cyan-400/[.025] blur-3xl" />
        <div className="cg-ambient absolute left-[16%] top-[20%] h-1 w-1 rounded-full bg-cyan-200/30 motion-safe:animate-pulse" />
        <div className="cg-ambient absolute right-[20%] top-[44%] h-1 w-1 rounded-full bg-[#e3c884]/30 motion-safe:animate-pulse" />
      </div>
      <main className="relative mx-auto w-full max-w-[760px] px-4 pb-16 pt-8 sm:px-6 sm:pt-12">{children}</main>
    </div>
  );
}

/** The office wordmark, the only branding the client page carries. */
export function ClientIntakeBrand({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-9 w-[3px] rounded-full bg-gradient-to-b from-[#e3c884] via-[#b8934a] to-transparent" />
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold tracking-tight text-white">{title}</p>
        <p className="truncate text-[11px] text-slate-400">{subtitle}</p>
      </div>
    </div>
  );
}
