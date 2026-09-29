import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-semibold " +
  "transform-gpu transition-[transform,filter,box-shadow,border-color,background-color,color] duration-150 ease-out " +
  "hover:-translate-y-px active:translate-y-0 active:scale-[.985] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40 " +
  "disabled:pointer-events-none disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none";

const styles: Record<Variant, string> = {
  primary:
    "border border-cyan-300/30 bg-gradient-to-b from-blue-500 to-blue-700 text-white " +
    "shadow-[0_10px_28px_rgba(37,99,235,.24),inset_0_1px_0_rgba(255,255,255,.18)] hover:brightness-105",
  secondary:
    "border border-white/10 bg-white/[.035] text-slate-200 " +
    "hover:border-cyan-300/20 hover:bg-cyan-300/[.045] hover:shadow-[0_8px_24px_rgba(34,211,238,.06)]",
  danger:
    "border border-red-300/25 bg-gradient-to-b from-red-500 to-red-700 text-white " +
    "shadow-[0_10px_28px_rgba(220,38,38,.18)] hover:brightness-105",
  ghost:
    "border border-transparent text-slate-300 hover:border-cyan-300/15 hover:bg-white/[.04] hover:text-white",
};

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={`${base} ${styles[variant]} ${className}`} {...props} />;
}
