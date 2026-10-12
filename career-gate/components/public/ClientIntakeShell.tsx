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
      className={`cg-client-link relative min-h-screen w-full min-w-0 overflow-x-clip bg-[radial-gradient(ellipse_at_12%_0%,#173b6a_0%,#0a122c_45%,#040914_100%)] text-slate-100 ${
        dir === "rtl" ? "font-[family-name:var(--font-plex-arabic)]" : "font-[family-name:var(--font-inter)]"
      }`}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-24 h-[22rem] w-[22rem] rounded-full bg-[#5188ce]/[.12] blur-3xl" />
        <div className="absolute -right-28 top-1/4 h-[26rem] w-[26rem] rounded-full bg-[#c5a059]/[.11] blur-3xl" />
        <div className="absolute bottom-[-8rem] left-1/4 h-[20rem] w-[20rem] rounded-full bg-[#2f6fd0]/[.06] blur-3xl" />
      </div>
      <main className="relative mx-auto w-full min-w-0 max-w-[1440px] px-3 pb-20 pt-4 sm:px-6 sm:pt-6 lg:px-8 xl:px-10">{children}</main>
      <style>{`
        .cg-client-link { color-scheme: dark; }
        .cg-client-link .cg-glass-card {
          position:relative;
          isolation:isolate;
          border-color:rgba(197,160,89,.52);
          background:linear-gradient(135deg,rgba(20,43,78,.79) 0%,rgba(9,23,49,.86) 45%,rgba(6,16,35,.88) 100%);
          box-shadow:0 19px 46px rgba(1,6,19,.32),inset 0 1px 0 rgba(255,255,255,.13);
          backdrop-filter:blur(30px) saturate(130%);
          -webkit-backdrop-filter:blur(30px) saturate(130%);
        }
        .cg-client-link .cg-glass-card[data-tone="accent"] {
          background:radial-gradient(ellipse at 0 0,rgba(197,160,89,.12),transparent 54%),linear-gradient(125deg,rgba(24,53,92,.85),rgba(6,17,38,.89));
        }
        .cg-client-link .cg-glass-card[data-tone="success"] {
          background:radial-gradient(ellipse at 50% 0,rgba(32,187,146,.15),transparent 56%),linear-gradient(125deg,rgba(14,47,67,.89),rgba(6,19,38,.93));
        }
        .cg-client-link .cg-glass-card:hover,.cg-client-link .cg-glass-card:focus-within {
          border-color:rgba(227,194,120,.74);
          box-shadow:0 20px 49px rgba(1,6,19,.34),0 0 20px rgba(197,160,89,.10),inset 0 1px 0 rgba(255,255,255,.13);
        }
        .cg-client-link .cg-glass-card h1,.cg-client-link .cg-glass-card h2,.cg-client-link .cg-glass-card legend {
          color:#f6deb0;
          overflow-wrap:anywhere;
        }
        .cg-client-link .cg-glass-card > p,
        .cg-client-link .cg-glass-card > div > p.text-slate-500,
        .cg-client-link .cg-glass-card > div > p.text-slate-600,
        .cg-client-link .cg-glass-card > div > p.text-slate-700,
        .cg-client-link .cg-glass-card > label > span,
        .cg-client-link .cg-glass-card [data-field] > span:first-child > span:first-child,
        .cg-client-link .cg-glass-card p.text-slate-600,
        .cg-client-link .cg-glass-card p.text-slate-500,
        .cg-client-link .cg-glass-card span.text-slate-500 {
          color:#dbe5f1;
        }
        .cg-client-link .cg-glass-card fieldset {
          min-width:0;
          padding:clamp(10px,1.4vw,16px);
          border:1px solid rgba(197,160,89,.18);
          border-radius:15px;
          background:rgba(4,13,29,.25);
        }
        .cg-client-link .cg-glass-card :is(input:not([type="file"]),textarea) {
          min-width:0;
          max-width:100%;
          background:rgba(252,253,255,.96);
          color:#12243f;
          border-color:rgba(197,160,89,.34);
          color-scheme:light;
        }
        .cg-client-link .cg-glass-card :is(input:not([type="file"]),textarea):focus-visible {
          border-color:#c5a059;
          box-shadow:0 0 0 3px rgba(197,160,89,.18);
        }
        .cg-client-link .cg-glass-card input[readonly] { background:#e8ecf1;color:#4b5d71; }
        .cg-client-link .cg-glass-card [data-testid="intake-file"] {
          background:linear-gradient(140deg,rgba(255,255,255,.10),rgba(255,255,255,.045));
          border-color:rgba(197,160,89,.32);
          min-width:0;
        }
        .cg-client-link .cg-glass-card [data-testid="intake-file"] .text-slate-800,
        .cg-client-link .cg-glass-card [data-testid="intake-file"] .text-slate-500 {color:#f0f5fb;}
        .cg-client-link .cg-glass-card [data-testid="intake-file-replace"],
        .cg-client-link .cg-glass-card [data-testid="intake-file-remove"] {
          color:#f2f5fa;
          border-color:rgba(197,160,89,.37);
          background:rgba(255,255,255,.06);
        }
        .cg-client-link .cg-glass-card [data-testid="intake-file-replace"]:hover,
        .cg-client-link .cg-glass-card [data-testid="intake-file-remove"]:hover {
          background:rgba(197,160,89,.16);
        }
        .cg-client-link .cg-glass-card [data-testid="intake-detected-empty"] {
          background:rgba(255,255,255,.055);
          border-color:rgba(197,160,89,.23);
          color:#dce6f1;
        }
        .cg-client-link [data-testid="smart-guide"] {
          border-color:rgba(197,160,89,.52);
          background:linear-gradient(130deg,rgba(22,50,84,.90),rgba(5,17,37,.91));
          color:#f2f5fb;
          box-shadow:0 15px 37px rgba(0,0,0,.31),inset 0 1px 0 rgba(255,255,255,.09);
          backdrop-filter:blur(26px);
          -webkit-backdrop-filter:blur(26px);
        }
        .cg-client-link [data-testid="smart-guide"] p.text-slate-700 { color:#dce7f3; }
        .cg-client-link [data-testid="smart-guide"] .text-slate-400 {color:#ecd29d;}
        .cg-client-link [data-testid="smart-guide-open"] {
          background:rgba(9,26,54,.91);
          border-color:rgba(197,160,89,.57);
          color:#f4e5bd;
          box-shadow:0 12px 29px rgba(0,0,0,.26);
        }
        .cg-client-link [data-testid="intake-case-number"] {
          background:linear-gradient(125deg,rgba(15,43,81,.96),rgba(6,21,47,.96));
          border-color:#c5a059;
        }
        .cg-client-link [data-testid="intake-case-number"] p {color:#f1dfb6;}
        .cg-client-link [data-testid="intake-file-view"],
        .cg-client-link [data-testid="intake-submit"],
        .cg-client-link [data-testid="intake-choose-files"] {
          transition:transform .2s ease,box-shadow .2s ease,filter .2s ease;
        }
        .cg-client-link [data-testid="intake-file-view"]:hover,
        .cg-client-link [data-testid="intake-submit"]:hover:not(:disabled),
        .cg-client-link [data-testid="intake-choose-files"]:hover {
          transform:translateY(-1px);
          box-shadow:0 12px 28px rgba(197,160,89,.16);
        }
        .cg-client-link [data-testid="intake-submit"] {
          background:linear-gradient(120deg,#163a70,#0b1e41);
          border-color:rgba(197,160,89,.75);
          box-shadow:0 12px 31px rgba(1,8,25,.26);
        }
        .cg-client-link [data-testid="intake-whatsapp-help"]{color:#a8f3d7;}
        .cg-client-link [data-testid="intake-case-status"]{border-color:rgba(197,160,89,.67);background:#122f59;}
        .cg-client-link [data-testid="intake-whatsapp"] {background:rgba(255,255,255,.92);}
        .cg-client-link [data-testid="intake-closed-note"] {background:rgba(255,255,255,.09);border-color:rgba(197,160,89,.25);color:#dce6f1;}
        @media (min-width:700px) and (max-width:1100px) {
          .cg-client-link [data-testid="intake-entry-grid"]{grid-template-columns:repeat(2,minmax(0,1fr));}
        }
        @media (max-width:699px) {
          .cg-client-link [data-testid="intake-entry-grid"]{grid-template-columns:minmax(0,1fr);}
          .cg-client-link .cg-glass-card{border-radius:16px;}
          .cg-client-link .cg-glass-card fieldset{padding:10px;}
        }
        @media (prefers-reduced-motion:reduce) {
          .cg-client-link * {animation-duration:0.01ms!important;transition-duration:0.01ms!important;}
        }
      `}</style>
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
    plain: "border-[#c5a059]/45 bg-[#0b1b37]/[.85] shadow-[0_20px_48px_-28px_rgba(0,0,0,.48)]",
    accent: "border-[#c5a059]/65 bg-[#0c2345]/[.85] shadow-[0_20px_50px_-28px_rgba(197,160,89,.25)]",
    success: "border-emerald-300/40 bg-[#0a2637]/[.91] shadow-[0_22px_52px_-26px_rgba(16,122,87,.22)]",
  } as const;
  return (
    <section {...rest} data-tone={tone} className={`cg-glass-card min-w-0 rounded-2xl border p-4 backdrop-blur-3xl transition-[border-color,box-shadow] duration-200 hover:border-[#c5a059]/65 focus-within:border-[#c5a059] motion-reduce:transition-none sm:p-5 lg:p-6 ${tones[tone]} ${className}`}>
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
