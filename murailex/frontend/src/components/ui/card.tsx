import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const cardVariants = cva("rounded-2xl border p-5 sm:p-6", {
  variants: {
    tone: {
      default: "glass",
      warn: "glass !border-warn/35",
      danger: "glass !border-danger/35",
    },
  },
  defaultVariants: { tone: "default" },
});

export function Card({ className, tone, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardVariants>) {
  return <div className={cn(cardVariants({ tone }), className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-[15px] font-semibold text-fg", className)} {...props} />;
}

/** Interactive list row used for recordings and review queue entries. */
export const rowClass =
  "glass lift flex items-center gap-4 rounded-2xl p-4 hover:!border-white/15 hover:!bg-surface-2/80 focus-visible:!border-primary-text";

/** Bordered inner block inside a card. */
export const insetClass = "rounded-lg border border-line bg-surface-2/60";

export function Stat({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[11.5px] text-fg-subtle">{label}</div>
      <div className="mt-0.5 truncate text-[13px] text-fg">{children}</div>
    </div>
  );
}
