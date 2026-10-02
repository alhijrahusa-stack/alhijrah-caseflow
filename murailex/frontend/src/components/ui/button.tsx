import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-transparent text-sm font-medium transition-[background,border-color,box-shadow,transform,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:pointer-events-none disabled:opacity-45 active:scale-[0.98] [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-accent-600 text-white shadow-[0_10px_28px_-12px_rgba(105,56,239,0.72)] hover:bg-accent-700 hover:shadow-[0_12px_30px_-14px_rgba(105,56,239,0.82)]",
        secondary: "glass text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-white/75 dark:hover:bg-white/10",
        outline: "border-[var(--border)] bg-transparent hover:border-[var(--border-strong)] hover:bg-black/[0.03] dark:hover:bg-white/[0.06]",
        ghost: "hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
        destructive: "bg-danger-600 text-white shadow-[0_10px_28px_-12px_rgba(220,38,38,0.5)] hover:bg-rose-700",
        subtle: "bg-accent-50 text-accent-700 hover:bg-accent-100 dark:bg-accent-500/15 dark:text-accent-200 dark:hover:bg-accent-500/25",
      },
      size: {
        default: "h-11 px-5",
        sm: "h-9 rounded-xl px-3 text-[13px]",
        lg: "h-14 px-7 text-base",
        icon: "size-10 rounded-full",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = "Button";

export { Button, buttonVariants };