import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide", {
  variants: {
    tone: {
      neutral: "bg-black/[0.05] text-[var(--muted)] dark:bg-white/[0.07]",
      accent: "bg-accent-100 text-accent-700 dark:bg-accent-500/20 dark:text-accent-200",
      warn: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200",
      danger: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200",
      ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
