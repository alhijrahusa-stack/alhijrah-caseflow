"use client";

import Image from "next/image";
import type { ReactNode } from "react";

/**
 * Shared Career Gate public intake shell.
 *
 * The public portal uses the same deep-blue / orange-gold institutional identity
 * as the staff system, with controlled glass depth and high-contrast foregrounds.
 */
export function ClientIntakeShell({ dir, children }: { dir: "rtl" | "ltr"; children: ReactNode }) {
  return (
    <div
      dir={dir}
      data-career-gate-intake="true"
      className={`relative min-h-screen overflow-hidden bg-[#03101f] text-slate-100 ${
        dir === "rtl" ? "font-[family-name:var(--font-plex-arabic)]" : "font-[family-name:var(--font-inter)]"
      }`}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_8%,rgba(47,111,208,.20),transparent_34%),radial-gradient(circle_at_88%_22%,rgba(255,132,0,.14),transparent_28%),linear-gradient(145deg,#03101f_0%,#071b34_48%,#03101f_100%)]" />
        <div className="absolute -left-32 top-[18%] h-[28rem] w-[28rem] rounded-full border border-cyan-300/[.06] bg-[#2f6fd0]/[.06] blur-3xl" />
        <div className="absolute -right-36 bottom-[8%] h-[30rem] w-[30rem] rounded-full border border-[#ff9f1a]/[.08] bg-[#ff8a00]/[.05] blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#ff9f1a]/45 to-transparent" />
      </div>
      <main className="relative mx-auto w-full max-w-[820px] px-4 pb-28 pt-6 sm:px-6 sm:pt-10">{children}</main>
    </div>
  );
}

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
    plain:
      "border-white/[.11] bg-[linear-gradient(145deg,rgba(10,35,66,.82),rgba(4,17,34,.72))] shadow-[0_28px_72px_-34px_rgba(0,0,0,.85),inset_0_1px_0_rgba(255,255,255,.07)]",
    accent:
      "border-[#ff9f1a]/30 bg-[linear-gradient(145deg,rgba(13,43,80,.90),rgba(6,22,42,.78))] shadow-[0_30px_76px_-34px_rgba(255,132,0,.34),inset_0_1px_0_rgba(255,255,255,.08)]",
    success:
      "border-emerald-300/25 bg-[linear-gradient(145deg,rgba(8,48,62,.90),rgba(5,25,42,.82))] shadow-[0_30px_76px_-34px_rgba(16,185,129,.30),inset_0_1px_0_rgba(255,255,255,.08)]",
  } as const;
  return (
    <section
      {...rest}
      className={`relative overflow-hidden rounded-[26px] border p-5 backdrop-blur-2xl sm:p-7 ${tones[tone]} ${className}`}
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      {children}
    </section>
  );
}

export function ClientIntakeBrand({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3.5">
      <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl border border-[#ff9f1a]/30 bg-[#06182d]/85 shadow-[0_14px_32px_-20px_rgba(255,132,0,.65),inset_0_1px_0_rgba(255,255,255,.08)]">
        <Image src="/brand/career-gate.webp" alt="" width={56} height={56} className="h-full w-full object-cover" priority />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[18px] font-semibold tracking-[-.015em] text-white">{title}</p>
        <p className="mt-0.5 truncate text-[12px] font-medium text-slate-300">{subtitle}</p>
        <span className="mt-2 block h-[2px] w-16 rounded-full bg-gradient-to-r from-[#ff8a00] via-[#ffb347] to-transparent" aria-hidden="true" />
      </div>
    </div>
  );
}
