import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl text-sm font-medium transition-[background,box-shadow,transform,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:pointer-events-none disabled:opacity-45 active:scale-[0.98] [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-accent-600 text-white shadow-[0_8px_24px_-10px_rgba(105,56,239,0.7)] hover:bg-accent-700",
        secondary: "glass text-[var(--text)] hover:bg-white/70 dark:hover:bg-white/10",
        outline: "border hairline bg-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.06]",
        ghost: "hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
        destructive: "bg-rose-600 text-white hover:bg-rose-700",
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
