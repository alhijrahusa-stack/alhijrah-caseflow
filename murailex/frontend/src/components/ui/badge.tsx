import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex min-h-6 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide", {
  variants: {
    tone: {
      neutral: "border border-[var(--border)] bg-black/[0.05] text-[var(--muted)] dark:bg-white/[0.07]",
      accent: "border border-accent-200 bg-accent-100 text-accent-700 dark:border-accent-500/25 dark:bg-accent-500/20 dark:text-accent-200",
      warn: "border border-amber-200 bg-amber-100 text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/15 dark:text-amber-100",
      danger: "border border-rose-200 bg-rose-100 text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/15 dark:text-rose-100",
      ok: "border border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-100",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}